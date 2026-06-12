// The engine dispatcher: routes a WorkerRequest to the right engine function and
// posts the response via `respond` (transferring typed-array payloads). Kept as a
// pure-ish function of (request, context, respond) so it is node-testable with a
// real reader + a fake respond — the worker entry (engine.worker.ts) is a thin
// self.onmessage/self.postMessage wrapper around it.
//
// Single open file per session: `open` replaces ctx.active. Cancellation here is the
// stale-drop model (the engine fns run to completion; the client suppresses stale
// results by requestId/selectId) — real cooperative abort is a later refinement.

import type { WorkerRequest, WorkerResponse, OpenSource } from "@mzpeak/contracts";
import { openEngineFile, type EngineFile } from "../engine/open";
import { readEngineSpectrum } from "../engine/spectrum";
import { engineScanBreakdown } from "../engine/scanBreakdown";
import { engineExtractChrom } from "../engine/chrom";
import { buffersOf, type Respond } from "./respond";

/** Mutable per-session context the worker entry owns one of. */
export type EngineContext = { active: EngineFile | null };

export function createContext(): EngineContext {
  return { active: null };
}

async function bytesOf(source: OpenSource): Promise<{ bytes: ArrayBuffer; name: string }> {
  if (source.kind === "file") return { bytes: source.bytes, name: source.name };
  // URL: fetch the bytes (forced range reads happen inside the reader on demand;
  // here we pull the archive bytes for the Blob path the engine uses).
  const res = await fetch(source.url);
  if (!res.ok) throw Object.assign(new Error(`fetch ${source.url}: ${res.status}`), { engineClass: "network" });
  return { bytes: await res.arrayBuffer(), name: source.url };
}

function errClassOf(e: unknown): WorkerResponse extends never ? never : "network" | "parse" | "internal" {
  const c = (e as { engineClass?: string })?.engineClass;
  return (c === "network" || c === "parse" ? c : "internal") as "network" | "parse" | "internal";
}

/** Route one request. Always posts exactly one terminal response (result or error). */
export async function dispatch(req: WorkerRequest, ctx: EngineContext, respond: Respond): Promise<void> {
  try {
    switch (req.type) {
      case "open": {
        const { bytes } = await bytesOf(req.source);
        const fileSize = bytes.byteLength;
        const ef = await openEngineFile(bytes, req.source.kind === "file" ? req.source.name : req.source.url);
        ctx.active = ef;
        const transfer = buffersOf(
          ef.tic,
          ef.grid?.coordKey,
          ef.grid?.spectrumIndex,
          ef.grid?.presenceMask,
        );
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
            fileSize,
            mixedRepresentationWarning: null,
          },
          transfer,
        );
        return;
      }

      case "close": {
        ctx.active = null;
        return; // close has no correlated response
      }

      case "selectSpectrum": {
        const reader = requireActive(ctx).reader;
        const spectrum = await readEngineSpectrum(reader, req.index);
        respond({ type: "spectrumResult", spectrum, selectId: req.selectId }, buffersOf(spectrum.mz, spectrum.intensity));
        return;
      }

      case "scanBreakdown": {
        const reader = requireActive(ctx).reader;
        const { stats, browse } = await engineScanBreakdown(reader);
        respond(
          { type: "scanBreakdownResult", requestId: req.requestId, stats, browse },
          buffersOf(browse.msLevel, browse.rt, browse.tic),
        );
        return;
      }

      case "extractChrom": {
        const reader = requireActive(ctx).reader;
        const series = await engineExtractChrom(reader, req.chrom);
        respond({ type: "chromResult", requestId: req.requestId, series }, buffersOf(series.time, series.intensity));
        return;
      }

      // Not yet implemented in this slice (archive/parquet are the Structure spike;
      // imaging render + optical are the next imaging slice). Fail loudly, not silently.
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
    respond({
      type: "error",
      ...(requestId !== undefined ? { requestId } : {}),
      ...(selectId !== undefined ? { selectId } : {}),
      class: errClassOf(e),
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

function requireActive(ctx: EngineContext): EngineFile {
  if (!ctx.active) throw Object.assign(new Error("no open file (call open first)"), { engineClass: "internal" });
  return ctx.active;
}
