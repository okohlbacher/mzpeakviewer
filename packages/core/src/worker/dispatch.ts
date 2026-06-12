// The engine dispatcher: routes a WorkerRequest to the right engine function and
// posts the response via `respond` (transferring fresh typed-array payloads). Kept
// node-testable: (request, context, respond) → at most one terminal response. The
// worker entry (engine.worker.ts) is a thin self.* wrapper that also SERIALIZES
// dispatches (the WASM reader is single-threaded).
//
// Single open file per session. A load GENERATION guards open/close races (review
// CRITICAL): open bumps the gen + clears active immediately, and only commits its
// result if the gen is still current — a slow older open can't clobber a newer one.
// Cancellation is the stale-drop model (the client suppresses stale results by
// requestId/selectId); `cancel` is acknowledged.

import type { WorkerRequest, ReaderErrorClass, UnsupportedFinding } from "@mzpeak/contracts";
import { openEngineFile, openEngineUrl, type EngineFile } from "../engine/open";
import { readEngineSpectrum } from "../engine/spectrum";
import { engineScanBreakdown } from "../engine/scanBreakdown";
import { engineExtractChrom, type ChromContext } from "../engine/chrom";
import { engineRenderIonImage, engineMeanSpectrum, engineRoiSpectrum } from "../engine/imaging";
import { UnsupportedEncodingError, CorruptFileError } from "../reader/errors";
import { buffersOf, type Respond } from "./respond";

/** Mutable per-session context the worker entry owns one of. */
export type EngineContext = {
  active: EngineFile | null;
  /** Bumped on every open/close; guards against a stale open committing. */
  gen: number;
  /** Cached scan context so extractChrom can reuse rows + representation counts. */
  scan: ChromContext | null;
};

export function createContext(): EngineContext {
  return { active: null, gen: 0, scan: null };
}

/** Map a thrown reader error to a wire error class (+ findings when present). */
function classifyError(e: unknown): { class: ReaderErrorClass; findings?: UnsupportedFinding[] } {
  if (e instanceof UnsupportedEncodingError) {
    return { class: "unsupported", findings: e.findings };
  }
  if (e instanceof CorruptFileError) return { class: "parse" };
  const c = (e as { engineClass?: string })?.engineClass;
  if (c === "network" || c === "cors" || c === "not-found" || c === "parse" || c === "format") {
    return { class: c };
  }
  return { class: "internal" };
}

/** Route one request. Always posts exactly one terminal response (result or error). */
export async function dispatch(req: WorkerRequest, ctx: EngineContext, respond: Respond): Promise<void> {
  try {
    switch (req.type) {
      case "open": {
        // New load generation: drop the old reader + scan cache immediately so any
        // in-flight read is abandoned, and only this open can commit (race guard).
        const g = ++ctx.gen;
        ctx.active = null;
        ctx.scan = null;
        const ef =
          req.source.kind === "file"
            ? await openEngineFile(req.source.bytes, req.source.name)
            : await openEngineUrl(req.source.url);
        if (ctx.gen !== g) return; // superseded by a newer open/close — drop silently
        ctx.active = ef;
        respond(
          {
            type: "opened",
            requestId: req.requestId,
            capabilities: ef.capabilities,
            manifest: ef.manifest,
            fileMeta: ef.fileMeta,
            stats: ef.stats,
            grid: ef.grid,
            tic: ef.tic,
            opticalImages: ef.opticalImages,
            fileSize: req.source.kind === "file" ? req.source.bytes.byteLength : null,
            mixedRepresentationWarning: null,
          },
          // Transfer ONLY the fresh TIC; the worker RETAINS the grid arrays (needed
          // for renders) so they are structured-cloned, never detached.
          buffersOf(ef.tic),
        );
        return;
      }

      case "close": {
        ctx.gen++;
        ctx.active = null;
        ctx.scan = null;
        return; // no correlated response
      }

      case "setCacheConfig":
        // Cache policy is advisory; the in-worker cache is not yet wired. No-op ack.
        return;

      case "cancel":
        // Stale-drop model: nothing to hard-abort yet. Acknowledge so the client can
        // reconcile (its Promise was already rejected locally).
        respond({ type: "cancelled", cancelId: req.cancelId });
        return;

      case "selectSpectrum": {
        const reader = requireActive(ctx).reader;
        const spectrum = await readEngineSpectrum(reader, req.index);
        respond({ type: "spectrumResult", spectrum, selectId: req.selectId }, buffersOf(spectrum.mz, spectrum.intensity));
        return;
      }

      case "scanBreakdown": {
        const reader = requireActive(ctx).reader;
        const { stats, browse, ticColumn, rows } = await engineScanBreakdown(reader);
        // Cache the scan context so extractChrom picks the right source + cheap TIC.
        ctx.scan = { rows, representationCounts: stats.representationCounts };
        respond(
          { type: "scanBreakdownResult", requestId: req.requestId, stats, browse, ticColumn },
          buffersOf(browse.msLevel, browse.rt, browse.tic),
        );
        return;
      }

      case "extractChrom": {
        const reader = requireActive(ctx).reader;
        const series = await engineExtractChrom(reader, req.chrom, ctx.scan ?? undefined);
        respond({ type: "chromResult", requestId: req.requestId, series }, buffersOf(series.time, series.intensity));
        return;
      }

      case "renderIonImage": {
        const active = requireActive(ctx);
        if (!active.grid) {
          respond({ type: "renderResult", requestId: req.requestId, ionImage: null, stats: null });
          return;
        }
        const { ionImage, stats } = await engineRenderIonImage(active.reader, active.grid, req.mz, req.tolDa);
        respond({ type: "renderResult", requestId: req.requestId, ionImage, stats }, buffersOf(ionImage));
        return;
      }

      case "meanSpectrum": {
        const spectrum = await engineMeanSpectrum(requireActive(ctx).reader);
        respond({ type: "meanSpectrumResult", requestId: req.requestId, spectrum }, buffersOf(spectrum.mz, spectrum.intensity));
        return;
      }

      case "roiSpectrum": {
        const spectrum = await engineRoiSpectrum(requireActive(ctx).reader, req.spectrumIndices);
        respond({ type: "meanSpectrumResult", requestId: req.requestId, spectrum }, buffersOf(spectrum.mz, spectrum.intensity));
        return;
      }

      // Not yet implemented (archive/parquet = Structure spike; imaging render/optical
      // = next imaging slice). Fail loudly, never silently.
      default: {
        const requestId = (req as { requestId?: number }).requestId;
        respond({
          type: "error",
          ...(requestId !== undefined ? { requestId } : {}),
          class: "unsupported",
          message: `engine: "${req.type}" not implemented in this slice`,
        });
        return;
      }
    }
  } catch (e) {
    const requestId = (req as { requestId?: number }).requestId;
    const selectId = (req as { selectId?: number }).selectId;
    const { class: cls, findings } = classifyError(e);
    respond({
      type: "error",
      ...(requestId !== undefined ? { requestId } : {}),
      ...(selectId !== undefined ? { selectId } : {}),
      class: cls,
      message: e instanceof Error ? e.message : String(e),
      ...(findings ? { findings } : {}),
    });
  }
}

function requireActive(ctx: EngineContext): EngineFile {
  if (!ctx.active) throw Object.assign(new Error("no open file (call open first)"), { engineClass: "internal" });
  return ctx.active;
}
