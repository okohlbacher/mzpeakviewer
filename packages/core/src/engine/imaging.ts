// Engine imaging-render: the ion-image + mean/ROI-spectrum compute primitives.
//
// engineRenderIonImage computes the per-pixel window-sum, writes it at the grid key,
// and computes image stats. engineMeanSpectrum / engineRoiSpectrum build a reference
// m/z axis and bin into it (±0.5 Da, mean per bin), with a per-pixel sampling cap.
//
// The live `reader` (mzpeakts MzPeakReader) is the only I/O. Per-spectrum arrays for
// the ion image and the mean/ROI traces are read DIRECTLY from the DATA-ARRAY source
// (spectra_data point intensities) via reader/arrays.ts `harvestDataArraysOrNull` —
// NOT through representation-routed reconstruction. The in-memory index is built from
// spectra_data and tries dataArrays first then centroids, so a file declared centroid
// that ALSO carries data arrays sums those data-array points. Nothing here imports
// mzpeakts.

import type { IonImageStats, ImagingGridWire, SpectrumArrays } from "@mzpeak/contracts";
import { rebuildCoordMap } from "../adapt/grid";
import { computeIonImageStats } from "../adapt/ionImage";
import { adaptSpectrum } from "../adapt/spectrum";
import { harvestDataArraysOrNull } from "../reader/arrays";
import { readMsLevels } from "../reader/columns";
import { streamSpectraDataArrays, type Reader } from "../reader/openUrl";
import { IonCacheBuilder, type SpectraArrayCache, type CompactSpectrum } from "./cache";
import { isGridFile } from "./spectrum";
import type { Mutex } from "./mutex";

/**
 * Fail loud on a SciEX/Agilent GRID-encoded file in any ion-image / mean / ROI path. These
 * paths read the BULK `spectra_data` stream, which surfaces the raw integer `tof_index` axis
 * (m/z requires per-spectrum reconstruction the bulk stream can't do — see resolveGridMz), so
 * an image built here would be on un-reconstructed axes. Grid files are LC-MS (non-imaging) in
 * practice, so this guard shouldn't trip; it exists so a hypothetical grid+imaging file errors
 * instead of rendering wrong m/z.
 */
function assertNotGrid(reader: Reader): void {
  if (isGridFile(reader))
    throw new Error("Grid-encoded (SciEX/Agilent tof_index) files are not supported for ion images / mean / ROI: m/z needs per-spectrum reconstruction unavailable in the bulk stream.");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
/** Background prefetch time-slice: hold the reader at most this long before yielding so a
 *  user read interleaves promptly (bounded soft-preempt). One in-memory slice; a single
 *  network row-group read inside it can run longer — same bound as one row-group fetch. */
const PREFETCH_SLICE_MS = 30;
/** Max time the background prefetch will defer to sustained user activity before forcing
 *  ONE slice — bounds starvation under steady navigation (which keeps refreshing the
 *  cooldown), so the warm cache still completes eventually. */
const MAX_PREFETCH_STARVE_MS = 4000;

/**
 * Build the "include this spectrum in the ion image?" predicate enforcing the MS1-ONLY
 * rule (never sum MS2 into an ion image / its cache). Filter to MS1 only when the grid
 * actually carries MS1 data; if NO mapped spectrum is MS1 (a misannotated / level-0
 * file) or the MS-level column is absent, include every mapped spectrum (so such files
 * still render rather than going blank).
 */
export function makeMs1Only(reader: Reader, mappedIndices: Iterable<number>): (i: number) => boolean {
  const levels = readMsLevels(reader);
  if (!levels) return () => true;
  let hasMs1 = false;
  for (const si of mappedIndices) {
    if (si >= 0 && si < levels.length && levels[si] === 1) { hasMs1 = true; break; }
  }
  if (!hasMs1) return () => true; // no MS1 at all → don't filter (fallback)
  return (i: number) => i >= 0 && i < levels.length && levels[i] === 1;
}

/**
 * Read one spectrum's plain (mz, intensity) arrays from the DATA-ARRAY source
 * (spectra_data), with a centroid (spectra_peaks) fallback ONLY when the spectrum
 * genuinely has no data arrays (see `harvestDataArraysOrNull`). Deliberately NOT
 * representation-routed: it must not read spectra_peaks for a centroid-declared file
 * that still carries data arrays. Returns null when the spectrum is absent or has no
 * decodable arrays (caller skips it).
 */
async function readSpectrumArrays(
  reader: Reader,
  index: number,
): Promise<{ mz: Float64Array; intensity: Float32Array } | null> {
  return harvestDataArraysOrNull(reader, index);
}

/**
 * Render an ion image: for each FILLED grid cell, sum the cell's spectrum intensity
 * within the m/z window `[mz - tolDa, mz + tolDa]` and write that sum at the cell's
 * `coordKey` (= y*width + x) into a dense `Float32Array(width*height)`.
 *
 * WINDOW-SUM SEMANTICS:
 *   - bounds are `mzStart = mz - tolDa`, `mzEnd = mz + tolDa`; a point is included
 *     iff `m >= mzStart && m <= mzEnd` — i.e. INCLUSIVE on BOTH ends.
 *   - the summed array is the spectrum's INTENSITY array read from the DATA-ARRAY
 *     source (spectra_data point intensities), NOT a representation-routed read. The
 *     ion index is built from spectra_data, so a centroid-declared file that still
 *     carries data arrays sums those data-array points (`harvestDataArraysOrNull`).
 *     Only a spectrum with NO data arrays falls back to its centroid peaks.
 *   - accumulation is per spectrum_index, then mapped onto the grid via the
 *     coord→spectrum map.
 *
 * Stats are computed via `computeIonImageStats(img, gridWire.presenceMask)` so a
 * present-with-zero pixel still counts toward min.
 *
 * CACHE: the FIRST render streams + decodes the whole spectra_data
 * (one row-group pass, ~tens of seconds over the CDN). The decoded per-pixel (mz,
 * intensity) arrays are retained in a `SpectraArrayCache` so EVERY subsequent ion image
 * — any m/z, any tolerance — re-sums from memory in ~a second, with NO network. The cache
 * is bounded by `limitBytes`; a file whose grid spectra exceed it is rendered uncached
 * (still correct, just re-streamed each time). The cache is owned by the worker session
 * and dropped on open/close (see dispatch.ts) so it never leaks across files.
 */
// The compact ion-cache types + the shared build/owner primitives live in cache.ts (the single
// shared cache module) so every imaging op and any future tab reuses them. Re-exported (below,
// from the local import) for existing importers (dispatch, tests).
export type { SpectraArrayCache, CompactSpectrum };

/** First index i with a[i] >= x (binary search over an ascending array). */
function lowerBound(a: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Window-sum over one spectrum's (mz, intensity): sum intensity where mz ∈ [lo, hi]
 *  INCLUSIVE on both ends, NaN/Inf skipped. Full scan — makes no ordering assumption. */
export function windowSumScan(
  mz: ArrayLike<number>,
  intensity: ArrayLike<number>,
  lo: number,
  hi: number,
): number {
  const n = Math.min(mz.length, intensity.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const m = mz[i]!;
    if (m < lo || m > hi) continue;
    const v = intensity[i]!;
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

/** Same inclusive [lo, hi] sum for an ASCENDING-m/z spectrum: binary-search the lower bound
 *  and stop at the first point past hi, so a cache-hit re-render scans only the window slice
 *  (not all points). Equivalent to {@link windowSumScan} when mz is ascending. */
export function windowSumSorted(
  mz: ArrayLike<number>,
  intensity: ArrayLike<number>,
  lo: number,
  hi: number,
): number {
  const n = Math.min(mz.length, intensity.length);
  let sum = 0;
  for (let i = lowerBound(mz, lo); i < n; i++) {
    const m = mz[i]!;
    if (m > hi) break;
    const v = intensity[i]!;
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

export type RenderIonImageOptions = {
  /** Reuse/populate this session cache of decoded grid-cell spectra. */
  cache?: SpectraArrayCache | null;
  /** Max bytes the cache may hold before this file is rendered uncached. */
  limitBytes?: number;
  /** Progress callback `(done, total)` over filled cells; throttled by the caller’s use. */
  onProgress?: (done: number, total: number) => void;
  /** Progressive PREVIEW: a COPY of the partially-built ion image + its stats, emitted
   *  periodically during a COLD build so the UI shows the image filling in. Not called on the
   *  instant cache-hit path. The copy is the caller's to transfer. */
  onPreview?: (ionImage: Float32Array, stats: IonImageStats) => void;
};

/** Default cache ceiling (~768 MB of decoded points) when the shell hasn’t set one. */
const DEFAULT_CACHE_LIMIT_BYTES = 768 * 1024 * 1024;
/** Min wall-clock gap between progress emissions (avoid flooding postMessage). */
const PROGRESS_INTERVAL_MS = 120;
/** Min wall-clock gap between progressive-preview image emissions (heavier than progress:
 *  a full-image copy + stats pass), so previews stay cheap over a ~tens-of-seconds build. */
const PREVIEW_INTERVAL_MS = 500;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export async function engineRenderIonImage(
  reader: Reader,
  gridWire: ImagingGridWire,
  mz: number,
  tolDa: number,
  opts?: RenderIonImageOptions,
): Promise<{ ionImage: Float32Array; stats: IonImageStats; cache: SpectraArrayCache | null }> {
  assertNotGrid(reader);
  const ionImage = new Float32Array(gridWire.width * gridWire.height);
  const mzStart = mz - tolDa;
  const mzEnd = mz + tolDa;
  const limitBytes = opts?.limitBytes ?? DEFAULT_CACHE_LIMIT_BYTES;
  const onProgress = opts?.onProgress;

  // coordKey → spectrumIndex for every filled cell (inverse of flattenGrid).
  const coordToSpectrum = rebuildCoordMap(gridWire);
  // MS1-only gate (never sum MS2 into an ion image); fallback includes all when the grid
  // carries no MS1 data. Excluded (MS2) pixels stay 0 in every path.
  const isMs1 = makeMs1Only(reader, coordToSpectrum.values());
  // Inverse: spectrumIndex → coordKey, so a stream keyed by spectrum index writes pixels
  // directly. Filled cells are 1:1 with spectra.
  const spectrumToCoord = new Map<number, number>();
  for (const [coordKey, spectrumIndex] of coordToSpectrum) {
    if (coordKey >= 0 && coordKey < ionImage.length && isMs1(spectrumIndex))
      spectrumToCoord.set(spectrumIndex, coordKey);
  }
  const total = spectrumToCoord.size;

  // Throttled progress emitter over filled cells.
  let done = 0;
  let lastEmit = 0;
  const tick = (force = false) => {
    if (!onProgress) return;
    const t = now();
    if (force || t - lastEmit >= PROGRESS_INTERVAL_MS) {
      lastEmit = t;
      onProgress(Math.min(done, total), total);
    }
  };

  // Throttled progressive-PREVIEW emitter (build path only): a COPY of the partial image +
  // its stats, so the UI shows pixels filling in as the build streams. Skipped when no
  // onPreview is given or on the instant cache-hit path (which returns before the build).
  const onPreview = opts?.onPreview;
  let lastPreview = 0;
  const previewTick = () => {
    if (!onPreview) return;
    const t = now();
    if (t - lastPreview >= PREVIEW_INTERVAL_MS) {
      lastPreview = t;
      onPreview(ionImage.slice(), computeIonImageStats(ionImage, gridWire.presenceMask));
    }
  };

  // Window-sum over one spectrum's (mz, intensity) — INCLUSIVE [mzStart, mzEnd],
  // NaN/Infinity skipped. Full scan for the streaming build path.
  const windowSum = (mzArr: ArrayLike<number>, inArr: ArrayLike<number>): number =>
    windowSumScan(mzArr, inArr, mzStart, mzEnd);

  // ── CACHE-HIT PATH: re-sum from the in-memory compact arrays (no network) ───────────
  if (opts?.cache?.complete) {
    const byIndex = opts.cache.byIndex;
    // Binary-search the window when the cache's m/z is ascending (the common case), else a
    // full scan — both give the identical inclusive [mzStart, mzEnd] sum.
    const sorted = opts.cache.sorted;
    for (const [spectrumIndex, coordKey] of spectrumToCoord) {
      const arrs = byIndex.get(spectrumIndex);
      // Absent ⇒ that cell contributed nothing on the build pass either → stays 0 (parity).
      if (arrs)
        ionImage[coordKey] = sorted
          ? windowSumSorted(arrs.mz, arrs.intensity, mzStart, mzEnd)
          : windowSumScan(arrs.mz, arrs.intensity, mzStart, mzEnd);
      done++;
      tick();
    }
    tick(true);
    const stats = computeIonImageStats(ionImage, gridWire.presenceMask);
    return { ionImage, stats, cache: opts.cache };
  }

  // ── BUILD PATH: ONE sequential pass over spectra_data row groups (each read once),
  // instead of a random-access getSpectrum per pixel (≈700 ms/pixel over the CDN ⇒ a
  // 34,840-pixel image never finishes). Reads the data-array source via
  // `harvestDataArraysOrNull`. Decoded grid-cell arrays are cached as we go (until the
  // budget is hit), so later renders take the cache-hit path above. ──────
  // Cache decoded grid-cell arrays as we go (shared IonCacheBuilder — f32 compaction + budget +
  // sortedness bookkeeping), so later renders take the cache-hit path above.
  const builder = new IonCacheBuilder(() => limitBytes);

  const filled = new Set<number>();
  for await (const { index, mz: mzArr, intensity: inArr } of streamSpectraDataArrays(reader, { mzFloat32: true })) {
    const coordKey = spectrumToCoord.get(index);
    if (coordKey === undefined) continue; // spectrum not mapped to a grid cell — not cached
    ionImage[coordKey] = windowSum(mzArr, inArr);
    filled.add(coordKey);
    builder.add(index, mzArr, inArr);
    done++;
    tick();
    previewTick();
  }

  // FALLBACK: any filled cell the data-array stream did NOT cover (a centroid-only spectrum
  // with no data arrays) is read individually — preserving the data-first→centroid source
  // selection of the per-pixel path. Rare; for a data-array imaging file this loop is empty.
  for (const [coordKey, spectrumIndex] of coordToSpectrum) {
    if (coordKey < 0 || coordKey >= ionImage.length || filled.has(coordKey)) continue;
    if (!isMs1(spectrumIndex)) continue; // MS2 cell — stays 0 (parity with the build pass)
    const arrs = await readSpectrumArrays(reader, spectrumIndex);
    done++;
    tick();
    if (!arrs) continue; // absent / undecodable spectrum contributes nothing
    ionImage[coordKey] = windowSum(arrs.mz, arrs.intensity);
    builder.add(spectrumIndex, arrs.mz, arrs.intensity);
  }
  tick(true);

  const stats = computeIonImageStats(ionImage, gridWire.presenceMask);
  // Commit the cache only if it held the whole grid within budget — else null (uncached).
  return { ionImage, stats, cache: builder.finish() };
}

// ── Multi-channel (RGB-overlay) render ────────────────────────────────────────

/** One channel of a multi-channel overlay (mirrors contracts' ChannelRequest core). */
export type MultiChannelSpec = { mz: number; tolDa: number };

export type RenderMultiChannelOptions = {
  /** Reuse/populate the shared session cache of decoded grid-cell spectra. */
  cache?: SpectraArrayCache | null;
  /** Max bytes the cache may hold before this file is rendered uncached. */
  limitBytes?: number;
  /** Progressive preview: COPIES of the partial channel images, emitted ~every 500ms during
   *  a cold build so the RGB composite fills in. Not called on the instant cache-hit path. */
  onPreview?: (channels: (Float32Array | null)[]) => void;
};

/**
 * Render an RGB-overlay's worth of ion images — one per channel SLOT, POSITION-ALIGNED with
 * `channels` (null slot → null result). Unlike a per-channel loop, this does ONE streamed
 * pass over spectra_data and computes EVERY active channel's window-sum per spectrum (so a
 * cold N-channel render streams once, not N times), building the SHARED compact ion cache as
 * it goes; a warm cache makes all channels an instant binary-search re-sum. Each channel's
 * pixel values are byte-identical to the single-channel `engineRenderIonImage` (same
 * data-array source, same inclusive `[mz−tolDa, mz+tolDa]` window, computed from the same f64
 * stream on the build path). Returns the channel images + the (built or reused) cache.
 */
export async function engineRenderMultiChannel(
  reader: Reader,
  gridWire: ImagingGridWire,
  channels: (MultiChannelSpec | null)[],
  opts?: RenderMultiChannelOptions,
): Promise<{ channels: (Float32Array | null)[]; cache: SpectraArrayCache | null }> {
  assertNotGrid(reader);
  const dense = gridWire.width * gridWire.height;
  const images: (Float32Array | null)[] = channels.map((ch) => (ch ? new Float32Array(dense) : null));
  const active: number[] = [];
  const lo = new Array<number>(channels.length).fill(0);
  const hi = new Array<number>(channels.length).fill(0);
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (ch) { active.push(i); lo[i] = ch.mz - ch.tolDa; hi[i] = ch.mz + ch.tolDa; }
  }
  if (active.length === 0) return { channels: images, cache: opts?.cache ?? null };

  const coordToSpectrum = rebuildCoordMap(gridWire);
  const isMs1 = makeMs1Only(reader, coordToSpectrum.values());
  const spectrumToCoord = new Map<number, number>();
  for (const [coordKey, si] of coordToSpectrum) {
    if (coordKey >= 0 && coordKey < dense && isMs1(si)) spectrumToCoord.set(si, coordKey);
  }

  // Progressive preview: snapshot all channel images (copies) periodically (build path only).
  const onPreview = opts?.onPreview;
  let lastPreview = 0;
  const previewTick = () => {
    if (!onPreview) return;
    const t = now();
    if (t - lastPreview >= PREVIEW_INTERVAL_MS) {
      lastPreview = t;
      onPreview(images.map((im) => (im ? im.slice() : null)));
    }
  };

  // Write every active channel's window-sum for one spectrum.
  const writeScan = (coordKey: number, mz: ArrayLike<number>, inten: ArrayLike<number>) => {
    for (const i of active) images[i]![coordKey] = windowSumScan(mz, inten, lo[i]!, hi[i]!);
  };

  // ── CACHE-HIT: every channel from the in-memory compact arrays (binary-search when sorted) ──
  const cache = opts?.cache;
  if (cache?.complete) {
    const byIndex = cache.byIndex;
    const sorted = cache.sorted;
    for (const [si, coordKey] of spectrumToCoord) {
      const arrs = byIndex.get(si);
      if (!arrs) continue;
      for (const i of active)
        images[i]![coordKey] = sorted
          ? windowSumSorted(arrs.mz, arrs.intensity, lo[i]!, hi[i]!)
          : windowSumScan(arrs.mz, arrs.intensity, lo[i]!, hi[i]!);
    }
    return { channels: images, cache };
  }

  // ── BUILD: ONE streamed pass — all channels per spectrum + build the shared compact cache ──
  const limitBytes = opts?.limitBytes ?? DEFAULT_CACHE_LIMIT_BYTES;
  const builder = new IonCacheBuilder(() => limitBytes);

  const filled = new Set<number>();
  for await (const { index, mz: mzArr, intensity: inArr } of streamSpectraDataArrays(reader, { mzFloat32: true })) {
    const coordKey = spectrumToCoord.get(index);
    if (coordKey === undefined) continue;
    writeScan(coordKey, mzArr, inArr);
    filled.add(coordKey);
    builder.add(index, mzArr, inArr);
    previewTick();
  }
  // Centroid-only fallback for any uncovered cell (rare for data-array imaging files).
  for (const [coordKey, si] of coordToSpectrum) {
    if (coordKey < 0 || coordKey >= dense || filled.has(coordKey)) continue;
    if (!isMs1(si)) continue;
    const arrs = await readSpectrumArrays(reader, si);
    if (!arrs) continue;
    writeScan(coordKey, arrs.mz, arrs.intensity);
    builder.add(si, arrs.mz, arrs.intensity);
  }

  return { channels: images, cache: builder.finish() };
}

/** Cooperative control for the interruptible background prefetch. */
export type PrefetchControl = {
  /** Serializes reader access against dispatched user reads (the non-reentrant reader). */
  mutex: Mutex;
  /** Stop and discard immediately (gen changed / aborted / cache already built). */
  shouldStop: () => boolean;
  /** Pause (don't start a new read) while the user is active. */
  isUserActive: () => boolean;
  /** Cooldown slice while paused, ms. A GETTER (not a fixed number) so the value tracks
   *  live read-latency — re-evaluated on every pause iteration (see dispatch.ts:adaptiveCooldown). */
  cooldownMs: () => number;
  /** Bytes still free in the shared cache budget. */
  budgetRemaining: () => number;
};

/**
 * Background-prefetch the ion-image cache: the SAME two-phase build as
 * `engineRenderIonImage` (bulk spectra_data stream + per-pixel centroid fallback) MINUS
 * the window-sum, so the resulting `SpectraArrayCache` is byte-for-byte what a cold
 * render would have produced — a later render takes the instant cache-hit path.
 *
 * Cooperative + interruptible: every reader touch runs under `control.mutex` (so it never
 * races a dispatched user read on the non-reentrant reader), it pauses while the user is
 * active, and it bails the moment `shouldStop()` is true (file changed, render took over,
 * or budget exhausted). Returns `{ cache }` (null when stopped or over budget).
 */
export async function prefetchIonCache(
  reader: Reader,
  gridWire: ImagingGridWire,
  control: PrefetchControl,
): Promise<{ cache: SpectraArrayCache | null; stopped: boolean }> {
  assertNotGrid(reader);
  const dense = gridWire.width * gridWire.height;
  const coordToSpectrum = rebuildCoordMap(gridWire);
  // MS1-only gate — the prefetch cache must be byte-identical to a render-built one, so it
  // applies the SAME filter (never caches MS2). See engineRenderIonImage / makeMs1Only.
  const isMs1 = makeMs1Only(reader, coordToSpectrum.values());
  const spectrumToCoord = new Map<number, number>();
  for (const [coordKey, spectrumIndex] of coordToSpectrum) {
    if (coordKey >= 0 && coordKey < dense && isMs1(spectrumIndex))
      spectrumToCoord.set(spectrumIndex, coordKey);
  }

  // Shared compact-cache accumulator (budget consulted live against the shared remaining).
  const builder = new IonCacheBuilder(control.budgetRemaining);

  // Pause loop: return false if we should stop while waiting. Bails after
  // MAX_PREFETCH_STARVE_MS of continuous activity so a steadily-navigating user can't
  // starve the warm-up forever (it then takes one slice, which still yields via the mutex).
  const waitWhileUserActive = async (): Promise<boolean> => {
    const waitStart = nowMs();
    while (control.isUserActive()) {
      if (control.shouldStop()) return false;
      if (nowMs() - waitStart > MAX_PREFETCH_STARVE_MS) break; // forced progress
      await sleep(control.cooldownMs()); // live adaptive value, re-read each slice
    }
    return !control.shouldStop();
  };

  const filled = new Set<number>();
  const it = streamSpectraDataArrays(reader, { mzFloat32: true })[Symbol.asyncIterator]();
  let streamDone = false;
  try {
    while (!streamDone) {
      if (!(await waitWhileUserActive())) return { cache: null, stopped: true };
      // Run a TIME-SLICED batch under the mutex: keep pulling decoded spectra (cheap,
      // in-memory between network row-group reads) until the slice elapses, then release
      // the reader and yield ONCE. Yielding per-spectrum would clamp to setTimeout's ~4ms
      // floor × 34,840 spectra ⇒ ~100s+; slicing keeps the whole pass near its ~35s I/O cost.
      await control.mutex.runExclusive(async () => {
        const start = nowMs();
        for (;;) {
          const res = await it.next();
          if (res.done) { streamDone = true; return; }
          const { index, mz, intensity } = res.value;
          const coordKey = spectrumToCoord.get(index);
          if (coordKey !== undefined) {
            builder.add(index, mz, intensity);
            if (builder.overBudget) return;
            filled.add(coordKey);
          }
          if (nowMs() - start > PREFETCH_SLICE_MS) return; // end the slice, yield below
        }
      });
      if (builder.overBudget) return { cache: null, stopped: false }; // too big to cache
      await sleep(0); // ONE yield per slice (lets a queued user read take the mutex)
    }
  } finally {
    if (it.return) await it.return(undefined);
  }

  // Centroid-only fallback for any grid cell the bulk stream didn't cover — keeps the
  // prefetch cache identical to a render-built one (rare for data-array imaging files).
  for (const [coordKey, spectrumIndex] of coordToSpectrum) {
    if (coordKey < 0 || coordKey >= dense || filled.has(coordKey)) continue;
    if (!isMs1(spectrumIndex)) continue; // MS2 cell — never cached (parity with the build pass)
    if (!(await waitWhileUserActive())) return { cache: null, stopped: true };
    const arrs = await control.mutex.runExclusive(() => harvestDataArraysOrNull(reader, spectrumIndex));
    if (!arrs) continue;
    builder.add(spectrumIndex, arrs.mz, arrs.intensity);
    if (builder.overBudget) return { cache: null, stopped: false };
  }

  return { cache: builder.finish(), stopped: false };
}

// ── Mean / ROI spectrum ──────────────────────────────────────────────────────
//
// A reference m/z axis is taken from the FIRST sampled spectrum (sorted ascending);
// every subsequent spectrum's points are binned into the nearest reference m/z within
// ±0.5 Da; the output is the MEAN intensity per reference bin across the contributing
// spectra.

/** Bin tolerance for accumulating a point onto the reference axis (±0.5 Da). */
const BIN_TOL_DA = 0.5;
/** Global-mean sampling cap (300 spectra) — keeps the full-file mean fast. */
const MAX_SAMPLES = 300;
/** ROI cap (100 spectra). */
const MAX_ROI = 100;

type MeanAccumulator = {
  // f32 reference axis CONSISTENTLY (the cold f64 source is downcast on capture), so a
  // mean/ROI spectrum is identical whether built from the f32 warm cache or a cold f64 read —
  // matching the f32 ion pipeline. (adaptSpectrum widens it to f64 for the wire; the VALUES
  // are f32-precision either way.) Intensity sum stays f64 for accumulation accuracy.
  refMz: Float32Array | null;
  intensitySum: Float64Array | null; // per-bin running sum (indexed by ref bin)
  countPerBin: Int32Array | null; // per-bin contributing-spectrum count
  contributed: number;
};

/** Nearest reference-bin index for `mzVal` via binary search. */
function nearestBin(refMz: Float32Array, mzVal: number): number {
  let lo = 0;
  let hi = refMz.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (refMz[mid]! < mzVal) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(refMz[lo - 1]! - mzVal) < Math.abs(refMz[lo]! - mzVal)
    ? lo - 1
    : lo;
}

/** Fold one spectrum's (mz, intensity) arrays into the running mean accumulator. */
function accumulate(
  acc: MeanAccumulator,
  mz: ArrayLike<number>,
  intensity: ArrayLike<number>,
): void {
  const n = Math.min(mz.length, intensity.length);
  if (n === 0) return;

  if (acc.refMz === null) {
    // First spectrum defines the reference axis (sorted ascending). f32 axis: an f64 source
    // is downcast here so the axis is f32-precision regardless of cache state (see type doc).
    const ref = new Float32Array(n);
    const sum = new Float64Array(n);
    const cnt = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      ref[i] = mz[i]!;
      sum[i] = intensity[i]!;
      cnt[i] = 1;
    }
    acc.refMz = ref;
    acc.intensitySum = sum;
    acc.countPerBin = cnt;
    acc.contributed = 1;
    return;
  }

  const ref = acc.refMz;
  const sum = acc.intensitySum!;
  const cnt = acc.countPerBin!;
  for (let j = 0; j < n; j++) {
    const mzVal = mz[j]!;
    const bi = nearestBin(ref, mzVal);
    if (Math.abs(ref[bi]! - mzVal) <= BIN_TOL_DA) {
      sum[bi] = sum[bi]! + intensity[j]!;
      cnt[bi] = cnt[bi]! + 1;
    }
  }
  acc.contributed++;
}

/** Finalize the accumulator into a wire SpectrumArrays (mean per bin), or null. */
function finalizeMean(
  acc: MeanAccumulator,
  id: string,
): SpectrumArrays | null {
  if (acc.refMz === null || acc.contributed === 0) return null;
  const ref = acc.refMz;
  const sum = acc.intensitySum!;
  const cnt = acc.countPerBin!;
  const outIntensity = new Float32Array(ref.length);
  for (let bi = 0; bi < ref.length; bi++) {
    const c = cnt[bi]!;
    outIntensity[bi] = c > 0 ? sum[bi]! / c : 0;
  }
  // representation null: a mean spectrum is a derived trace, not a file-declared one.
  return adaptSpectrum({
    index: -1,
    id,
    mz: ref,
    intensity: outIntensity,
    representation: null,
  });
}

/**
 * Mean spectrum across the given `indices` (already de-duped, sorted, and capped by
 * the caller). The result is a SAMPLED mean over N (= indices.length) of M total
 * spectra — see `engineMeanSpectrum` / `engineRoiSpectrum` for the honest `id` /
 * sampling contract. Indices are read in ascending order.
 */
async function meanSpectrumOver(
  reader: Reader,
  indices: number[],
  id: string,
  cache?: SpectraArrayCache | null,
): Promise<SpectrumArrays> {
  const acc: MeanAccumulator = {
    refMz: null,
    intensitySum: null,
    countPerBin: null,
    contributed: 0,
  };
  const cached = cache?.complete ? cache.byIndex : null;
  for (const idx of indices) {
    // Prefer the warm ion cache (same DATA-ARRAY source as readSpectrumArrays /
    // harvestDataArraysOrNull, so identical bytes) — avoids a random-access getSpectrum
    // per sample (each re-reads a whole row group: minutes over the CDN for data already
    // in memory). Falls back to the per-spectrum read for any uncached index.
    const arrs = cached?.get(idx) ?? (await readSpectrumArrays(reader, idx));
    if (!arrs) continue;
    accumulate(acc, arrs.mz, arrs.intensity);
  }
  const out = finalizeMean(acc, id);
  // Never return undecodable: an empty mean is an empty (but valid) spectrum.
  return (
    out ?? {
      index: -1,
      id,
      mz: new Float64Array(0),
      intensity: new Float32Array(0),
      representation: null,
    }
  );
}

/** Total spectrum count on the reader (mzpeakts `numSpectra`). */
function readerSpectrumCount(reader: Reader): number {
  const n = (reader as unknown as { numSpectra?: number }).numSpectra;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Uniformly subsample `sorted` down to at most `cap` entries, preserving order and
 * always including the first and last element when `cap >= 2`. When `sorted.length`
 * is already within the cap the input is returned as-is. Used so a >cap ROI/global
 * selection contributes a REPRESENTATIVE spread across the whole (sorted) set,
 * rather than only the first `cap` indices.
 */
function uniformSubsample(sorted: number[], cap: number): number[] {
  const n = sorted.length;
  if (n <= cap) return sorted;
  const out: number[] = [];
  // Even spacing across [0, n-1]; floor keeps indices in range, Set de-dups any
  // collisions at small caps so the result is <= cap and strictly increasing.
  const seen = new Set<number>();
  for (let i = 0; i < cap; i++) {
    const j = Math.floor((i * (n - 1)) / (cap - 1));
    if (!seen.has(j)) {
      seen.add(j);
      out.push(sorted[j]!);
    }
  }
  return out;
}

/**
 * Mean spectrum across ALL pixels.
 *
 * SAMPLED MEAN — HONEST CONTRACT: this is the SAMPLED mean over N of M spectra, not
 * an exact all-pixel mean. A true all-pixel mean reads every spectrum, which is slow
 * for large imaging files (each read is an individual `getSpectrum`). The global mean
 * SAMPLES uniformly down to `MAX_SAMPLES` (300) spectra — the result is a
 * representative mean, not an exact all-pixel sum. To signal this to consumers WITHOUT
 * a wire-type change (SpectrumArrays is fixed), the result `id` is `"mean-sampled"`.
 * The fixture has far fewer than 300 spectra, so the golden test averages every
 * spectrum.
 *
 * TODO(mean-ui): when the mean/ROI UI lands, report the actual sampled-count N and
 * the population M (e.g. via a separate side channel) so the UI can show "mean of
 * N / M spectra" — SpectrumArrays itself stays a fixed wire type.
 */
export async function engineMeanSpectrum(
  reader: Reader,
  cache?: SpectraArrayCache | null,
): Promise<SpectrumArrays> {
  assertNotGrid(reader);
  const total = readerSpectrumCount(reader);
  if (total <= 0) {
    return {
      index: -1,
      id: "mean-sampled",
      mz: new Float64Array(0),
      intensity: new Float32Array(0),
      representation: null,
    };
  }
  // Uniform subsample of [0, total) to at most MAX_SAMPLES indices.
  const all = Array.from({ length: total }, (_, i) => i);
  const indices = uniformSubsample(all, MAX_SAMPLES);
  return meanSpectrumOver(reader, indices, "mean-sampled", cache);
}

/**
 * Mean spectrum across a SUBSET of spectra (an ROI selection).
 *
 * SAMPLED MEAN — HONEST CONTRACT: when the ROI exceeds `MAX_ROI` (100) the selection
 * is SORTED then UNIFORMLY SUBSAMPLED across the whole sorted set (via
 * `uniformSubsample`), so the sampled mean is representative of the entire ROI — NOT
 * just the first 100 indices. The result `id` is `"roi-mean"` so a consumer can tell
 * this is a derived ROI mean (and, when over-cap, a sampled one).
 *
 * TODO(mean-ui): when the ROI UI lands, surface the sampled-count N vs the ROI size
 * M ("ROI mean of N / M") via a side channel — SpectrumArrays stays a fixed wire type.
 */
export async function engineRoiSpectrum(
  reader: Reader,
  spectrumIndices: number[],
  cache?: SpectraArrayCache | null,
): Promise<SpectrumArrays> {
  assertNotGrid(reader);
  const sorted = Array.from(new Set(spectrumIndices))
    .filter((i) => Number.isInteger(i) && i >= 0)
    .sort((a, b) => a - b);
  // Uniform spread across the SORTED ROI when over the cap (not a head slice).
  const selected = uniformSubsample(sorted, MAX_ROI);
  // ROI pixels are grid spectra → almost always in the warm ion cache (instant mean).
  return meanSpectrumOver(reader, selected, "roi-mean", cache);
}
