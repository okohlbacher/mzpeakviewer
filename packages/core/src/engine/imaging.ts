// Engine imaging-render: the ion-image + mean/ROI-spectrum compute primitives.
//
// HARVESTED from mzPeakIV's compute/worker layer (the read-only mzPeakIV tree):
//   - engineRenderIonImage  ← src/worker/mzPeakWorker.ts `ionImageFromCache` /
//       `computeIonImageFast` (the EXACT per-pixel window-sum) + src/compute/
//       ionImage.ts `buildIonImage` (the grid-key write) + `computeIonImageStats`.
//   - engineMeanSpectrum / engineRoiSpectrum ← mzPeakWorker.ts
//       `_computeMeanSpectrumFrom` (reference-axis binning, ±0.5 Da, mean per bin)
//       and `computeRoiMeanSpectrum` (100-index cap).
//
// The live `reader` (mzpeakts MzPeakReader) is the only I/O. Per-spectrum arrays for
// the ion image and the mean/ROI traces are harvested DIRECTLY from the DATA-ARRAY
// source (spectra_data point intensities) via reader/arrays.ts
// `harvestDataArraysOrNull` — NOT through representation-routed reconstruction. This
// is the source IV's ion-image path uses (its in-memory index is built from
// spectra_data, and its legacy getSpectrumArrays tries dataArrays first, then
// centroids), so a file declared centroid that ALSO carries data arrays produces the
// same ion image as IV. Nothing here imports mzpeakts.

import type { IonImageStats, ImagingGridWire, SpectrumArrays } from "@mzpeak/contracts";
import { rebuildCoordMap } from "../adapt/grid";
import { computeIonImageStats } from "../adapt/ionImage";
import { adaptSpectrum } from "../adapt/spectrum";
import { harvestDataArraysOrNull } from "../reader/arrays";
import { streamSpectraDataArrays, type Reader } from "../reader/openUrl";
import type { Mutex } from "./mutex";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
/** Background prefetch time-slice: hold the reader at most this long before yielding so a
 *  user read interleaves promptly (bounded soft-preempt). One in-memory slice; a single
 *  network row-group read inside it can run longer — same bound as one row-group fetch. */
const PREFETCH_SLICE_MS = 30;

/** Promoted per-spectrum MS-level column (mirrors open.ts buildTic / spectrum.ts). */
const MS_LEVEL_COL = "MS_1000511_ms_level";

/** Bulk-read the promoted MS-level column vectorized; null when the column is absent. */
function readMsLevels(reader: Reader): Int16Array | null {
  const sm = (reader as unknown as {
    spectrumMetadata?: {
      spectra?: { getChild?: (n: string) => { get(i: number): unknown } | null } | null;
      length?: number;
    } | null;
  }).spectrumMetadata;
  const spectra = sm?.spectra;
  if (!spectra || typeof spectra.getChild !== "function") return null;
  const col = spectra.getChild(MS_LEVEL_COL);
  if (!col) return null;
  const n = sm?.length ?? 0;
  const levels = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = col.get(i);
    levels[i] = typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  return levels;
}

/**
 * Build the "include this spectrum in the ion image?" predicate enforcing the MS1-ONLY
 * rule (design requirement: NEVER sum MS2 into an ion image / its cache). Mirrors
 * buildTic's fallback: filter to MS1 only when the grid actually carries MS1 data; if NO
 * mapped spectrum is MS1 (a misannotated / level-0 file) or the MS-level column is absent,
 * include every mapped spectrum (so such files still render rather than going blank).
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
 * genuinely has no data arrays — exactly IV's ion-image source selection (see
 * `harvestDataArraysOrNull`). Deliberately NOT representation-routed: it must not
 * read spectra_peaks for a centroid-declared file that still carries data arrays,
 * or the ion image would diverge from IV. Returns null when the spectrum is absent
 * or has no decodable arrays (caller skips it).
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
 * WINDOW-SUM SEMANTICS — matched to mzPeakIV (`ionImageFromCache` /
 * `computeIonImageFast`, src/worker/mzPeakWorker.ts:878-887 / 909-952):
 *   - bounds are `mzStart = mz - tolDa`, `mzEnd = mz + tolDa`; a point is included
 *     iff `m >= mzStart && m <= mzEnd` — i.e. INCLUSIVE on BOTH ends (IV's
 *     `if (m < mzStart || m > mzEnd) continue` ⇒ keep `[mzStart, mzEnd]`).
 *   - the summed array is the spectrum's INTENSITY array read from the DATA-ARRAY
 *     source (spectra_data point intensities), NOT a representation-routed read.
 *     IV builds its ion index from spectra_data (`forEachSpectraRowGroup` /
 *     `pointVecs`), so a centroid-declared file that still carries data arrays sums
 *     those data-array points — identical bytes to IV (`harvestDataArraysOrNull`).
 *     Only a spectrum with NO data arrays falls back to its centroid peaks.
 *   - accumulation is per spectrum_index, then mapped onto the grid via the
 *     coord→spectrum map — identical to IV mapping `coordToSpectrumIndex`.
 *
 * Stats are computed via `computeIonImageStats(img, gridWire.presenceMask)` so a
 * present-with-zero pixel still counts toward min (IV `computeIonImageStats`).
 *
 * CACHE (review follow-up): the FIRST render streams + decodes the whole spectra_data
 * (one row-group pass, ~tens of seconds over the CDN). The decoded per-pixel (mz,
 * intensity) arrays are retained in a `SpectraArrayCache` so EVERY subsequent ion image
 * — any m/z, any tolerance — re-sums from memory in ~a second, with NO network. The cache
 * is bounded by `limitBytes`; a file whose grid spectra exceed it is rendered uncached
 * (still correct, just re-streamed each time). The cache is owned by the worker session
 * and dropped on open/close (see dispatch.ts) so it never leaks across files.
 */
export type SpectraArrayCache = {
  /** spectrumIndex → decoded point arrays, for every filled grid cell with data. */
  byIndex: Map<number, { mz: Float64Array; intensity: Float32Array }>;
  /** True once a full pass populated every available filled-cell spectrum. */
  complete: boolean;
  /** Approximate bytes held (mz f64 + intensity f32), for the budget check. */
  bytes: number;
};

export type RenderIonImageOptions = {
  /** Reuse/populate this session cache of decoded grid-cell spectra. */
  cache?: SpectraArrayCache | null;
  /** Max bytes the cache may hold before this file is rendered uncached. */
  limitBytes?: number;
  /** Progress callback `(done, total)` over filled cells; throttled by the caller’s use. */
  onProgress?: (done: number, total: number) => void;
};

/** Default cache ceiling (~768 MB of decoded points) when the shell hasn’t set one. */
const DEFAULT_CACHE_LIMIT_BYTES = 768 * 1024 * 1024;
/** Min wall-clock gap between progress emissions (avoid flooding postMessage). */
const PROGRESS_INTERVAL_MS = 120;

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
  const ionImage = new Float32Array(gridWire.width * gridWire.height);
  const mzStart = mz - tolDa;
  const mzEnd = mz + tolDa;
  const limitBytes = opts?.limitBytes ?? DEFAULT_CACHE_LIMIT_BYTES;
  const onProgress = opts?.onProgress;

  // coordKey → spectrumIndex for every filled cell (inverse of flattenGrid).
  const coordToSpectrum = rebuildCoordMap(gridWire);
  // MS1-only gate (never sum MS2 into an ion image); fallback includes all when the grid
  // carries no MS1 data — mirrors buildTic. Excluded (MS2) pixels stay 0 in every path.
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

  // Window-sum over one spectrum's (mz, intensity) — INCLUSIVE [mzStart, mzEnd] (IV
  // `ionImageFromCache`), NaN/Infinity → 0 (IV buildIonImage T-04-02). Unchanged math.
  const windowSum = (mzArr: ArrayLike<number>, inArr: ArrayLike<number>): number => {
    const n = Math.min(mzArr.length, inArr.length);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const m = mzArr[i]!;
      if (m < mzStart || m > mzEnd) continue;
      const v = inArr[i]!;
      if (Number.isFinite(v)) sum += v;
    }
    return sum;
  };

  // ── CACHE-HIT PATH: re-sum from the in-memory decoded arrays (no network) ───────────
  if (opts?.cache?.complete) {
    const byIndex = opts.cache.byIndex;
    for (const [spectrumIndex, coordKey] of spectrumToCoord) {
      const arrs = byIndex.get(spectrumIndex);
      // Absent ⇒ that cell contributed nothing on the build pass either → stays 0 (parity).
      if (arrs) ionImage[coordKey] = windowSum(arrs.mz, arrs.intensity);
      done++;
      tick();
    }
    tick(true);
    const stats = computeIonImageStats(ionImage, gridWire.presenceMask);
    return { ionImage, stats, cache: opts.cache };
  }

  // ── BUILD PATH: ONE sequential pass over spectra_data row groups (each read once),
  // instead of a random-access getSpectrum per pixel (≈700 ms/pixel over the CDN ⇒ a
  // 34,840-pixel image never finishes). Same data-array source IV/`harvestDataArraysOrNull`
  // prefers, so the summed values are identical. Decoded grid-cell arrays are cached as we
  // go (until the budget is hit), so later renders take the cache-hit path above. ──────
  const building = new Map<number, { mz: Float64Array; intensity: Float32Array }>();
  let bytes = 0;
  let cacheable = true;
  const remember = (index: number, mzArr: Float64Array, inArr: Float32Array) => {
    if (!cacheable) return;
    bytes += mzArr.byteLength + inArr.byteLength;
    if (bytes > limitBytes) {
      cacheable = false; // too big for this session — render uncached from here on
      building.clear();
      return;
    }
    building.set(index, { mz: mzArr, intensity: inArr });
  };

  const filled = new Set<number>();
  for await (const { index, mz: mzArr, intensity: inArr } of streamSpectraDataArrays(reader)) {
    const coordKey = spectrumToCoord.get(index);
    if (coordKey === undefined) continue; // spectrum not mapped to a grid cell — not cached
    ionImage[coordKey] = windowSum(mzArr, inArr);
    filled.add(coordKey);
    remember(index, mzArr, inArr);
    done++;
    tick();
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
    remember(spectrumIndex, arrs.mz, arrs.intensity);
  }
  tick(true);

  const stats = computeIonImageStats(ionImage, gridWire.presenceMask);
  // Commit the cache only if it held the whole grid within budget — else null (uncached).
  const cache: SpectraArrayCache | null = cacheable ? { byIndex: building, complete: true, bytes } : null;
  return { ionImage, stats, cache };
}

/** Cooperative control for the interruptible background prefetch. */
export type PrefetchControl = {
  /** Serializes reader access against dispatched user reads (the non-reentrant reader). */
  mutex: Mutex;
  /** Stop and discard immediately (gen changed / aborted / cache already built). */
  shouldStop: () => boolean;
  /** Pause (don't start a new read) while the user is active. */
  isUserActive: () => boolean;
  /** Cooldown slice while paused, ms. */
  cooldownMs: number;
  /** Bytes still free in the shared cache budget. */
  budgetRemaining: () => number;
  /** Progress over filled cells (optional). */
  onProgress?: (done: number, total: number) => void;
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
  const total = spectrumToCoord.size;

  const building = new Map<number, { mz: Float64Array; intensity: Float32Array }>();
  let bytes = 0;
  let done = 0;

  // Pause loop: return false if we should stop while waiting.
  const waitWhileUserActive = async (): Promise<boolean> => {
    while (control.isUserActive()) {
      if (control.shouldStop()) return false;
      await sleep(control.cooldownMs);
    }
    return !control.shouldStop();
  };

  const filled = new Set<number>();
  const it = streamSpectraDataArrays(reader)[Symbol.asyncIterator]();
  let streamDone = false;
  let overBudget = false;
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
            bytes += mz.byteLength + intensity.byteLength;
            if (bytes > control.budgetRemaining()) { overBudget = true; return; }
            building.set(index, { mz, intensity });
            filled.add(coordKey);
            done++;
          }
          if (nowMs() - start > PREFETCH_SLICE_MS) return; // end the slice, yield below
        }
      });
      if (overBudget) return { cache: null, stopped: false }; // too big to cache
      control.onProgress?.(done, total);
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
    done++;
    control.onProgress?.(done, total);
    if (!arrs) continue;
    bytes += arrs.mz.byteLength + arrs.intensity.byteLength;
    if (bytes > control.budgetRemaining()) return { cache: null, stopped: false };
    building.set(spectrumIndex, { mz: arrs.mz, intensity: arrs.intensity });
  }

  return { cache: { byIndex: building, complete: true, bytes }, stopped: false };
}

// ── Mean / ROI spectrum ──────────────────────────────────────────────────────
//
// Harvested from mzPeakWorker.ts `_computeMeanSpectrumFrom`: a reference m/z axis is
// taken from the FIRST sampled spectrum (sorted ascending); every subsequent
// spectrum's points are binned into the nearest reference m/z within ±0.5 Da; the
// output is the MEAN intensity per reference bin across the contributing spectra.

/** Bin tolerance for accumulating a point onto the reference axis (IV ±0.5 Da). */
const BIN_TOL_DA = 0.5;
/** Global-mean sampling cap (IV MAX_SAMPLES = 300) — keeps the full-file mean fast. */
const MAX_SAMPLES = 300;
/** ROI cap (IV computeRoiMeanSpectrum slices to 100). */
const MAX_ROI = 100;

type MeanAccumulator = {
  refMz: Float64Array | null;
  intensitySum: Float64Array | null; // per-bin running sum (indexed by ref bin)
  countPerBin: Int32Array | null; // per-bin contributing-spectrum count
  contributed: number;
};

/** Nearest reference-bin index for `mzVal` via binary search (IV inner loop). */
function nearestBin(refMz: Float64Array, mzVal: number): number {
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
  mz: Float64Array,
  intensity: Float32Array,
): void {
  const n = Math.min(mz.length, intensity.length);
  if (n === 0) return;

  if (acc.refMz === null) {
    // First spectrum defines the reference axis (sorted ascending — IV sorts here;
    // engine/spectrum.ts already returns sorted, finite pairs, so this is stable).
    const ref = new Float64Array(n);
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
): Promise<SpectrumArrays> {
  const acc: MeanAccumulator = {
    refMz: null,
    intensitySum: null,
    countPerBin: null,
    contributed: 0,
  };
  for (const idx of indices) {
    const arrs = await readSpectrumArrays(reader, idx);
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
 * for large imaging files (IV's worker reads spectra_data.parquet by row group; here
 * each read is an individual `getSpectrum`). Mirroring IV's
 * `_computeMeanSpectrumFrom(null)`, the global mean SAMPLES uniformly down to
 * `MAX_SAMPLES` (300) spectra — the result is a representative mean, not an exact
 * all-pixel sum. To signal this to consumers WITHOUT a wire-type change (SpectrumArrays
 * is fixed), the result `id` is `"mean-sampled"`. The fixture has far fewer than 300
 * spectra, so the golden test averages every spectrum.
 *
 * TODO(mean-ui): when the mean/ROI UI lands, report the actual sampled-count N and
 * the population M (e.g. via a separate side channel) so the UI can show "mean of
 * N / M spectra" — SpectrumArrays itself stays a fixed wire type.
 */
export async function engineMeanSpectrum(reader: Reader): Promise<SpectrumArrays> {
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
  // Uniform subsample of [0, total) to at most MAX_SAMPLES indices (IV step subset).
  const all = Array.from({ length: total }, (_, i) => i);
  const indices = uniformSubsample(all, MAX_SAMPLES);
  return meanSpectrumOver(reader, indices, "mean-sampled");
}

/**
 * Mean spectrum across a SUBSET of spectra (an ROI selection).
 *
 * SAMPLED MEAN — HONEST CONTRACT: when the ROI exceeds `MAX_ROI` (100, IV) the
 * selection is SORTED then UNIFORMLY SUBSAMPLED across the whole sorted set (via
 * `uniformSubsample`), so the sampled mean is representative of the entire ROI —
 * NOT just the first 100 indices (the prior `.slice(0, 100)` dropped everything
 * after the 100th and was arbitrary). The result `id` is `"roi-mean"` so a consumer
 * can tell this is a derived ROI mean (and, when over-cap, a sampled one).
 *
 * TODO(mean-ui): when the ROI UI lands, surface the sampled-count N vs the ROI size
 * M ("ROI mean of N / M") via a side channel — SpectrumArrays stays a fixed wire type.
 */
export async function engineRoiSpectrum(
  reader: Reader,
  spectrumIndices: number[],
): Promise<SpectrumArrays> {
  const sorted = Array.from(new Set(spectrumIndices))
    .filter((i) => Number.isInteger(i) && i >= 0)
    .sort((a, b) => a - b);
  // Uniform spread across the SORTED ROI when over the cap (not a head slice).
  const selected = uniformSubsample(sorted, MAX_ROI);
  return meanSpectrumOver(reader, selected, "roi-mean");
}
