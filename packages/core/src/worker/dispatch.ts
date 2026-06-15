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
import { readEngineSpectrumCached } from "../engine/spectrum";
import { CacheBudget, SpectrumLruCache } from "../engine/cache";
import { engineScanBreakdown } from "../engine/scanBreakdown";
import { engineExtractChrom, type ChromContext } from "../engine/chrom";
import { engineRenderIonImage, engineMeanSpectrum, engineRoiSpectrum, prefetchIonCache, type SpectraArrayCache } from "../engine/imaging";
import { Mutex } from "../engine/mutex";
import { engineRenderMultiChannel } from "../engine/multichannel";
import { engineGetOpticalImage } from "../engine/optical";
import { engineArchiveList, engineArchiveMemberBytes, engineParquetFooter, engineSampleColumn, clearStructureCache } from "../engine/structure";
import { engineStudyMeta } from "../engine/studyMeta";
import { UnsupportedEncodingError, CorruptFileError } from "../reader/errors";
import { buffersOf, type Respond } from "./respond";

/** Mutable per-session context the worker entry owns one of. */
export type EngineContext = {
  active: EngineFile | null;
  /** Bumped on every open/close; guards against a stale open committing. */
  gen: number;
  /** Cached scan context so extractChrom can reuse rows + representation counts. */
  scan: ChromContext | null;
  /** Decoded grid-cell spectra from the first ion render, so later renders re-sum from
   *  memory (no re-stream). Dropped on every open/close — never leaks across files. */
  ionCache: SpectraArrayCache | null;
  /** ONE memory-sized byte budget shared by the ion cache + the spectrum LRU. */
  budget: CacheBudget;
  /** LRU of decoded per-spectrum (m/z, intensity, msLevel) — accelerates repeat
   *  selectSpectrum + (Stage 2) the background prefetch. Shares `budget`. */
  spectrumCache: SpectrumLruCache;
  /** Serializes ALL reader access (dispatched reads + the background prefetch) — the
   *  reader is single-threaded / non-reentrant. */
  mutex: Mutex;
  /** `performance.now()` of the last user-driven signal read; the prefetch pauses
   *  within `PREFETCH_COOLDOWN_MS` of it so user reads stay responsive. */
  lastUserActivity: number;
  /** Whether background prefetch on open is enabled (setCacheConfig.preloadEnabled). */
  preloadEnabled: boolean;
};

export function createContext(): EngineContext {
  const budget = new CacheBudget();
  return {
    active: null,
    gen: 0,
    scan: null,
    ionCache: null,
    budget,
    spectrumCache: new SpectrumLruCache(budget),
    mutex: new Mutex(),
    lastUserActivity: 0,
    preloadEnabled: true,
  };
}

/** Cooldown after user activity before the background prefetch resumes (Explorer's 350ms). */
const PREFETCH_COOLDOWN_MS = 350;

/**
 * Fire-and-forget background prefetch of the ion-image cache, started after an imaging
 * file opens. Warms `ctx.ionCache` via the interruptible `prefetchIonCache` so the FIRST
 * ion render is an instant cache hit instead of a ~35 s cold stream. Reads run under
 * `ctx.mutex` (never racing dispatched user reads), pause while the user is active, and
 * bail the moment the file changes or a render already built the cache. Commits to the
 * shared budget only on full success; a stopped/over-budget run leaves no trace.
 */
export function startIonPrefetch(ctx: EngineContext): void {
  const ef = ctx.active;
  const gen = ctx.gen;
  if (!ef || !ef.grid || !ctx.preloadEnabled) return;
  const grid = ef.grid;
  void prefetchIonCache(ef.reader, grid, {
    mutex: ctx.mutex,
    shouldStop: () => ctx.gen !== gen || (ctx.ionCache?.complete ?? false),
    isUserActive: () =>
      typeof performance !== "undefined"
        ? performance.now() - ctx.lastUserActivity < PREFETCH_COOLDOWN_MS
        : false,
    cooldownMs: PREFETCH_COOLDOWN_MS,
    budgetRemaining: () => ctx.budget.remaining(),
  })
    .then(({ cache }) => {
      // Commit only if still the current file and a render hasn't already built it.
      if (ctx.gen === gen && cache && !ctx.ionCache) {
        ctx.ionCache = cache;
        ctx.budget.add(cache.bytes);
      }
    })
    .catch(() => {
      // Background warming is best-effort; a failure just means the first render is cold.
    });
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
        ctx.ionCache = null; // decoded-spectra cache is per-file — drop it
        ctx.spectrumCache.clear(); // per-file spectrum LRU — drop it
        ctx.budget.resetUsage(); // both caches cleared → reset the shared usage
        clearStructureCache(); // path-keyed footer cache must not leak across files
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
        // NB: the background ion-cache prefetch is kicked off by the WORKER ENTRY after
        // this open dispatch resolves (not here) — so `dispatch` stays free of background
        // side-effects and the node dispatch-tests don't spawn an unsynchronized reader.
        return;
      }

      case "close": {
        ctx.gen++;
        ctx.active = null;
        ctx.scan = null;
        ctx.ionCache = null;
        ctx.spectrumCache.clear();
        ctx.budget.resetUsage();
        return; // no correlated response
      }

      case "setCacheConfig":
        // Override the shared (ion + spectrum) byte ceiling. `preloadEnabled` is reserved
        // for Stage 2's background prefetch. A positive limit overrides the memory-derived
        // default; the spectrum LRU evicts immediately if it now exceeds the new ceiling.
        if (Number.isFinite(req.cacheLimitBytes) && req.cacheLimitBytes > 0) {
          ctx.budget.limitBytes = req.cacheLimitBytes;
        }
        ctx.preloadEnabled = req.preloadEnabled;
        return;

      case "cancel":
        // Stale-drop model: nothing to hard-abort yet. Acknowledge so the client can
        // reconcile (its Promise was already rejected locally).
        respond({ type: "cancelled", cancelId: req.cancelId });
        return;

      case "selectSpectrum": {
        const reader = requireActive(ctx).reader;
        // Read-through the spectrum LRU: a repeat selection returns the cached arrays
        // (adaptSpectrum copies them for the transfer, so the cache stays intact).
        const spectrum = await readEngineSpectrumCached(reader, req.index, ctx.spectrumCache);
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
        const prev = ctx.ionCache;
        const { ionImage, stats, cache } = await engineRenderIonImage(
          active.reader,
          active.grid,
          req.mz,
          req.tolDa,
          {
            cache: ctx.ionCache,
            // Only the budget still free after the spectrum LRU's current usage.
            limitBytes: ctx.budget.remaining(),
            onProgress: (doneN, totalN) =>
              respond({ type: "renderProgress", requestId: req.requestId, done: doneN, total: totalN }),
          },
        );
        // Account the ion cache against the shared budget when it changes (a fresh build
        // commits a new cache; a cache-hit reuses the same ref and leaves usage unchanged).
        if (cache !== prev) {
          if (prev) ctx.budget.sub(prev.bytes);
          if (cache) ctx.budget.add(cache.bytes);
          ctx.ionCache = cache;
        }
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

      case "renderMultiChannel": {
        const active = requireActive(ctx);
        if (!active.grid) {
          respond({ type: "multiChannelResult", requestId: req.requestId, channels: req.channels.map(() => null) });
          return;
        }
        const channels = await engineRenderMultiChannel(active.reader, active.grid, req.channels);
        respond(
          { type: "multiChannelResult", requestId: req.requestId, channels },
          buffersOf(...channels.filter((c): c is Float32Array => c !== null)),
        );
        return;
      }

      case "archiveList": {
        const members = await engineArchiveList(requireActive(ctx).reader);
        respond({ type: "archiveListResult", requestId: req.requestId, members });
        return;
      }

      case "parquetFooter": {
        const footer = await engineParquetFooter(requireActive(ctx).reader, req.archivePath);
        respond({ type: "parquetFooterResult", requestId: req.requestId, footer });
        return;
      }

      case "archiveMemberBytes": {
        const { archivePath, bytes, truncated } = await engineArchiveMemberBytes(
          requireActive(ctx).reader,
          req.archivePath,
          req.maxBytes,
        );
        respond(
          { type: "archiveMemberBytesResult", requestId: req.requestId, archivePath, bytes, truncated },
          [bytes],
        );
        return;
      }

      case "sampleColumn": {
        const sample = await engineSampleColumn(requireActive(ctx).reader, req.archivePath, req.column, req.n);
        respond({ type: "sampleColumnResult", requestId: req.requestId, sample });
        return;
      }

      case "studyMeta": {
        const study = await engineStudyMeta(requireActive(ctx).reader);
        respond({ type: "studyMetaResult", requestId: req.requestId, study });
        return;
      }

      // gen-echoed (not requestId) — its own case before the requestId-keyed default.
      case "getOpticalImage": {
        const active = requireActive(ctx);
        try {
          const { width, height, rgba } = await engineGetOpticalImage(active.reader, req.archivePath);
          respond(
            { type: "opticalImageResult", archivePath: req.archivePath, gen: req.gen, width, height, rgba },
            [rgba.buffer],
          );
        } catch (err) {
          respond({
            type: "opticalImageError",
            archivePath: req.archivePath,
            gen: req.gen,
            message: err instanceof Error ? err.message : String(err),
          });
        }
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
