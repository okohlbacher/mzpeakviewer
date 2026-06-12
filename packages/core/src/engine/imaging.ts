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
import type { Reader } from "../reader/openUrl";

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
 */
export async function engineRenderIonImage(
  reader: Reader,
  gridWire: ImagingGridWire,
  mz: number,
  tolDa: number,
): Promise<{ ionImage: Float32Array; stats: IonImageStats }> {
  const ionImage = new Float32Array(gridWire.width * gridWire.height);
  const mzStart = mz - tolDa;
  const mzEnd = mz + tolDa;

  // coordKey → spectrumIndex for every filled cell (inverse of flattenGrid).
  const coordToSpectrum = rebuildCoordMap(gridWire);

  for (const [coordKey, spectrumIndex] of coordToSpectrum) {
    if (coordKey < 0 || coordKey >= ionImage.length) continue; // off-grid guard
    const arrs = await readSpectrumArrays(reader, spectrumIndex);
    if (!arrs) continue; // absent / undecodable spectrum contributes nothing
    const { mz: mzArr, intensity: inArr } = arrs;
    const n = Math.min(mzArr.length, inArr.length);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const m = mzArr[i]!;
      if (m < mzStart || m > mzEnd) continue; // inclusive [mzStart, mzEnd] (IV)
      const v = inArr[i]!;
      // Strict finite guard (mirrors IV buildIonImage T-04-02): NaN/Infinity → 0.
      if (Number.isFinite(v)) sum += v;
    }
    ionImage[coordKey] = sum;
  }

  const stats = computeIonImageStats(ionImage, gridWire.presenceMask);
  return { ionImage, stats };
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
