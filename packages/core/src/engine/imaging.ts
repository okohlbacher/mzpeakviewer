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
// The live `reader` (mzpeakts MzPeakReader) is the only I/O. Per-spectrum arrays are
// reconstructed through engine/spectrum.ts `reconstructSpectrum` (the same source-
// routing the golden spectrum test pins), so the value-parity of the ion image is
// anchored to the validated spectrum reconstruction. Nothing here imports mzpeakts.

import type { IonImageStats, ImagingGridWire, SpectrumArrays } from "@mzpeak/contracts";
import { rebuildCoordMap } from "../adapt/grid";
import { computeIonImageStats } from "../adapt/ionImage";
import { adaptSpectrum } from "../adapt/spectrum";
import { spectrumMeta } from "../reader/fileMeta";
import type { Reader } from "../reader/openUrl";
import type { SpectrumRepresentation } from "../reader/types";
import { reconstructSpectrum, type RawSpectrum } from "./spectrum";

/**
 * Read + reconstruct one spectrum's plain (mz, intensity) arrays via the validated
 * engine/spectrum.ts path. Resolves representation from MS:1000525 (null when
 * unknown) and routes the source exactly like `readEngineSpectrum`. Returns null when
 * the spectrum is absent or has no decodable arrays (caller skips it).
 */
async function readSpectrumArrays(
  reader: Reader,
  index: number,
): Promise<{ mz: Float64Array; intensity: Float32Array } | null> {
  let representation: SpectrumRepresentation = null;
  try {
    representation = spectrumMeta(reader, index).representation;
  } catch {
    representation = null;
  }
  let raw: RawSpectrum | null;
  try {
    raw = (await reader.getSpectrum(index)) as RawSpectrum | null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const recon = reconstructSpectrum(raw, index, representation);
    return { mz: recon.mz, intensity: recon.intensity };
  } catch {
    return null; // empty / undecodable spectrum — contributes nothing
  }
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
 *   - the summed array is the spectrum's INTENSITY array from the data source
 *     (`point.intensity` in IV; here the reconstructed `intensity`, same bytes).
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
 * Mean spectrum across pixels. `indices` selects the spectra to average; when
 * omitted, EVERY spectrum on the grid... (see perf note below). Indices are read in
 * ascending order; the global mean is uniformly SAMPLED to `MAX_SAMPLES` (IV) so the
 * full-file mean stays fast — see `engineMeanSpectrum` / `engineRoiSpectrum`.
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
 * Mean spectrum across ALL pixels.
 *
 * PERF NOTE: a true all-pixel mean reads every spectrum, which is slow for large
 * imaging files (IV's worker reads spectra_data.parquet by row group; here each read
 * is an individual `getSpectrum`). Mirroring IV's `_computeMeanSpectrumFrom(null)`,
 * the global mean SAMPLES uniformly down to `MAX_SAMPLES` (300) spectra — the result
 * is a representative mean, not an exact all-pixel sum. The fixture has far fewer than
 * 300 spectra, so the golden test averages every spectrum.
 */
export async function engineMeanSpectrum(reader: Reader): Promise<SpectrumArrays> {
  const total = readerSpectrumCount(reader);
  if (total <= 0) {
    return {
      index: -1,
      id: "mean",
      mz: new Float64Array(0),
      intensity: new Float32Array(0),
      representation: null,
    };
  }
  // Uniform subsample of [0, total) to at most MAX_SAMPLES indices (IV step subset).
  let indices: number[];
  if (total <= MAX_SAMPLES) {
    indices = Array.from({ length: total }, (_, i) => i);
  } else {
    const step = total / MAX_SAMPLES;
    indices = Array.from({ length: MAX_SAMPLES }, (_, i) => Math.floor(i * step));
  }
  return meanSpectrumOver(reader, indices, "mean");
}

/**
 * Mean spectrum across a SUBSET of spectra (an ROI selection). Caps at `MAX_ROI`
 * (100, IV) and reads in ascending index order. Out-of-range / negative indices are
 * dropped defensively.
 */
export async function engineRoiSpectrum(
  reader: Reader,
  spectrumIndices: number[],
): Promise<SpectrumArrays> {
  const capped = Array.from(new Set(spectrumIndices))
    .filter((i) => Number.isInteger(i) && i >= 0)
    .slice(0, MAX_ROI)
    .sort((a, b) => a - b);
  return meanSpectrumOver(reader, capped, `roi-mean(${capped.length})`);
}
