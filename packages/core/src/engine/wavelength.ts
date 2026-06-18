// Engine wavelength (UV/VIS / PDA / DAD optical) spectrum read + browse.
//
// SEPARATE from the MS spectrum path on purpose (adversarial review, P0): wavelength
// is in nanometers (not m/z), intensity may be SIGNED (baseline-subtracted) and is NOT
// absorbance unless the unit CURIE says so. This module never touches `spectrum.ts` /
// `SpectrumArrays`; the MS code paths are left byte-for-byte unchanged.
//
// The reconstruction (extracting + sanitizing the wavelength/intensity arrays and
// resolving the unit / λmax / observed-range metadata) is split into PURE helpers that
// operate on an already-fetched raw record — testable without WASM — mirroring how
// `spectrum.ts` factors `reconstructSpectrum` / `sanitizePairs` out of the live read.
//
// Selection is by ZERO-BASED ARRAY POSITION (the file `wavelength_spectrum_index` is a
// uint64 and not a safe JS number); the native id is kept as an opaque string.

import type { WavelengthSpectrumArrays, WavelengthBrowseIndex, WavelengthMatrix } from "@mzpeak/contracts";
import { plainify } from "../reader/fileMeta";
import type { Reader } from "../reader/openUrl";

// ── CV accessions (PSI-MS) ────────────────────────────────────────────────────
// Array unit CURIEs we know how to label:
const UNIT_COUNTS = "MS:1000131"; // number of detector counts → "counts"
// Absorbance unit terms (UO:0000269 = "absorbance unit"; MS absorbance term as fallback).
const UNIT_ABSORBANCE_UO = "UO:0000269";
const UNIT_ABSORBANCE_MS = "MS:1000814"; // absorbance (some writers tag the array with this)
// λmax metadata term.
const LAMBDA_MAX_ACC = "MS:1003812";
// Observed wavelength range terms: lowest / highest observed wavelength.
const LOWEST_OBSERVED_ACC = "MS:1000619";
const HIGHEST_OBSERVED_ACC = "MS:1000618";

// Human-readable data-array column keys (packTableIntoDataArrays uses the parquet field
// name, which is the CV array's human-readable name — same convention as "m/z array" /
// "intensity array" on the MS path). The x axis is the wavelength array; the y axis is
// the intensity array. We match leniently (case-insensitive substring) and fall back to
// positional selection so a slightly-differently-named column still reconstructs.
const WAVELENGTH_KEY_RE = /wavelength/i;
const INTENSITY_KEY_RE = /intensity/i;

/** The raw wavelength-spectrum record mzpeakts returns from getWavelengthSpectrum(index). */
export type RawWavelengthSpectrum = {
  id: unknown;
  /** Acquisition/retention time, in MINUTES (file convention), normalized to seconds here. */
  time?: unknown;
  dataArrays?: Record<string, ArrayLike<number>> | undefined;
  /** Promoted columns by accession-derived name (for λmax / observed-range / unit fallback). */
  meta?: Record<string, unknown> | null;
  /** Param accessor (present on the mzpeakts Spectrum record) for CV-param lookups. */
  getParamByAccession?: (accession: string) => { value?: unknown; unit?: string | null } | undefined;
};

/**
 * Thrown when a wavelength spectrum has no decodable wavelength + intensity arrays.
 * Named so the worker can distinguish "empty" from a transient reader error and never
 * silently emit zeros. Mirrors `EmptySpectrumError` on the MS path.
 */
export class EmptyWavelengthSpectrumError extends Error {
  constructor(public readonly index: number) {
    super(`Wavelength spectrum ${index}: no decodable wavelength + intensity arrays`);
    this.name = "EmptyWavelengthSpectrumError";
  }
}

/** Pick the wavelength (x) + intensity (y) arrays + the y column's KEY from a dataArrays bag. */
function pickArrays(
  da: Record<string, ArrayLike<number>>,
): { wavelength: ArrayLike<number>; intensity: ArrayLike<number>; intensityKey: string } | null {
  const keys = Object.keys(da);
  let wKey = keys.find((k) => WAVELENGTH_KEY_RE.test(k));
  let iKey = keys.find((k) => INTENSITY_KEY_RE.test(k));
  // Positional fallback: if either name didn't match, use the two columns left over. The
  // data layout is (x, y); the first numeric column is the axis, the second the signal.
  if (!wKey || !iKey) {
    const numeric = keys.filter((k) => {
      const v = da[k];
      return v != null && typeof (v as ArrayLike<number>).length === "number";
    });
    if (numeric.length >= 2) {
      wKey = wKey ?? (iKey ? numeric.find((k) => k !== iKey) : numeric[0]);
      iKey = iKey ?? numeric.find((k) => k !== wKey);
    }
  }
  if (!wKey || !iKey || !da[wKey] || !da[iKey]) return null;
  return { wavelength: da[wKey]!, intensity: da[iKey]!, intensityKey: iKey };
}

/**
 * Resolve the intensity unit LABEL from the array's unit CURIE.
 *  - MS:1000131 (number of detector counts) → "counts"
 *  - any absorbance term (UO:0000269 / MS:1000814) → "AU"
 *  - else → "Intensity"
 * The unit CURIE may live in the intensity column NAME (the `..._unit_MS_xxxxxxx` /
 * `..._unit_UO_xxxxxxx` convention) or in the record params/meta. We check the column
 * name first (most reliable for data arrays), then the intensity-array param.
 */
export function resolveIntensityUnit(intensityKey: string, unitCurieFromMeta?: string | null): string {
  const fromName = unitCurieFromKey(intensityKey);
  const curie = fromName ?? unitCurieFromMeta ?? null;
  if (curie === UNIT_COUNTS) return "counts";
  if (curie === UNIT_ABSORBANCE_UO || curie === UNIT_ABSORBANCE_MS) return "AU";
  return "Intensity";
}

/** Extract a `MS:xxxxxxx` / `UO:xxxxxxx` unit CURIE from a `..._unit_MS_xxxxxxx` column name. */
function unitCurieFromKey(key: string): string | null {
  const m = /_unit_([A-Z]+)_(\d+)/.exec(key);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

/** Coerce array-like → Float32Array (always copying; the result buffer is transferred). */
function toF32(a: ArrayLike<number>): Float32Array {
  return a instanceof Float32Array ? a.slice() : Float32Array.from(a);
}

/**
 * Sort (wavelength, intensity) pairs ASCENDING by wavelength, dropping pairs where the
 * wavelength is non-finite. SIGNED / zero intensity is preserved (UV is baseline-
 * subtracted) — we never filter on the intensity value. Pure + separately testable.
 * Fast path: already-finite + ascending + equal-length input returns unchanged (no copy).
 */
export function sortByWavelength(
  wavelength: Float32Array,
  intensity: Float32Array,
): { wavelength: Float32Array; intensity: Float32Array } {
  const n = Math.min(wavelength.length, intensity.length);
  let clean = wavelength.length === intensity.length;
  for (let i = 0; i < n && clean; i++) {
    if (!Number.isFinite(wavelength[i]!) || (i > 0 && wavelength[i]! < wavelength[i - 1]!)) {
      clean = false;
    }
  }
  if (clean) return { wavelength, intensity };

  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(wavelength[i]!)) idx.push(i);
  idx.sort((a, b) => wavelength[a]! - wavelength[b]!);
  const w = new Float32Array(idx.length);
  const y = new Float32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    const j = idx[i]!;
    w[i] = wavelength[j]!;
    y[i] = intensity[j]!;
  }
  return { wavelength: w, intensity: y };
}

/** Read a numeric CV param/meta value off the record (param accessor first, then raw meta). */
function readNumeric(rec: RawWavelengthSpectrum, accession: string): number | null {
  const p = rec.getParamByAccession?.(accession);
  if (p && typeof p.value === "number" && Number.isFinite(p.value)) return p.value;
  if (p && typeof p.value === "bigint") return Number(p.value);
  // Fallback: scan promoted columns for an accession-derived key (MS_xxxxxxx_...).
  const meta = rec.meta ?? {};
  const acc = accession.replace(":", "_");
  for (const [k, v] of Object.entries(meta)) {
    if (k.startsWith(acc) && typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Read the intensity array's unit CURIE from the record params, if present. */
function readIntensityUnitCurie(rec: RawWavelengthSpectrum): string | null {
  // Absorbance/counts terms carry the unit on the array param; try the absorbance terms
  // and the counts term, returning the CURIE of whichever has a unit.
  const p =
    rec.getParamByAccession?.(UNIT_ABSORBANCE_MS) ??
    rec.getParamByAccession?.(UNIT_ABSORBANCE_UO) ??
    rec.getParamByAccession?.(UNIT_COUNTS);
  if (p && typeof p.unit === "string") return p.unit;
  return null;
}

/**
 * PURE reconstruction: turn a raw wavelength record + its zero-based array position into
 * the wire `WavelengthSpectrumArrays`. Sorts ascending by wavelength, normalizes time
 * minutes→seconds, resolves the intensity unit, and derives λmax / observedRange under
 * the validation rules. Throws `EmptyWavelengthSpectrumError` when no arrays decode.
 */
export function reconstructWavelengthSpectrum(
  rec: RawWavelengthSpectrum,
  index: number,
): WavelengthSpectrumArrays {
  const da = rec.dataArrays;
  if (!da) throw new EmptyWavelengthSpectrumError(index);
  const picked = pickArrays(da);
  if (!picked) throw new EmptyWavelengthSpectrumError(index);

  const sorted = sortByWavelength(toF32(picked.wavelength), toF32(picked.intensity));
  const wavelength = sorted.wavelength;
  const intensity = sorted.intensity;

  // Array min/max for validating the declared observed range (signed intensity is fine —
  // these bounds are on the WAVELENGTH axis, which is ascending after the sort).
  const arrMin = wavelength.length > 0 ? wavelength[0]! : NaN;
  const arrMax = wavelength.length > 0 ? wavelength[wavelength.length - 1]! : NaN;

  // time: file convention is MINUTES → seconds. NaN when absent.
  const timeRaw = typeof rec.time === "number" ? rec.time : (typeof rec.time === "bigint" ? Number(rec.time) : NaN);
  const timeSec = Number.isFinite(timeRaw) ? timeRaw * 60 : NaN;

  // intensity unit from the array unit CURIE (column name first, then param meta).
  const intensityUnit = resolveIntensityUnit(picked.intensityKey, readIntensityUnitCurie(rec));

  // λmax: from MS:1003812 metadata ONLY when present AND a positive finite wavelength
  // (reject 0 / negative / NaN — a wavelength must be > 0 nm), else null.
  const lambdaMaxRaw = readNumeric(rec, LAMBDA_MAX_ACC);
  const lambdaMax = lambdaMaxRaw != null && Number.isFinite(lambdaMaxRaw) && lambdaMaxRaw > 0 ? lambdaMaxRaw : null;

  // observedRange: from MS:1000619 (lo) / MS:1000618 (hi), validated against array min/max.
  // Suppress entirely for an empty spectrum (no points → no meaningful observed range).
  const observedRange =
    wavelength.length === 0
      ? null
      : resolveObservedRange(
          readNumeric(rec, LOWEST_OBSERVED_ACC),
          readNumeric(rec, HIGHEST_OBSERVED_ACC),
          arrMin,
          arrMax,
        );

  return {
    index,
    id: String(rec.id),
    wavelength,
    intensity,
    intensityUnit,
    timeSec,
    lambdaMax,
    observedRange,
  };
}

/**
 * Resolve the observed wavelength range from the declared lo/hi metadata, validated
 * against the array's actual min/max. Returns null unless BOTH bounds are present, finite,
 * ordered (lo ≤ hi), and consistent with the array extent (when the array has values, the
 * declared range must overlap [arrMin, arrMax] — a wildly-off declared range is rejected).
 */
export function resolveObservedRange(
  lo: number | null,
  hi: number | null,
  arrMin: number,
  arrMax: number,
): [number, number] | null {
  if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (lo <= 0 || hi <= 0) return null; // wavelengths are positive nm
  if (lo > hi) return null;
  if (Number.isFinite(arrMin) && Number.isFinite(arrMax)) {
    // Reject a declared range that doesn't intersect the actual array extent.
    if (hi < arrMin || lo > arrMax) return null;
  }
  return [lo, hi];
}

/**
 * Read + reconstruct wavelength spectrum at zero-based array `index`. The live reader call
 * is the only I/O; reconstruction is the pure path above. Mirrors `readEngineSpectrum`.
 */
export async function readWavelengthSpectrum(
  reader: Reader,
  index: number,
): Promise<WavelengthSpectrumArrays> {
  const rec = (await reader.getWavelengthSpectrum(index)) as RawWavelengthSpectrum | null | undefined;
  if (!rec) throw new Error(`No wavelength spectrum at index ${index}`);
  const out = reconstructWavelengthSpectrum(rec, index);
  // Attach the full per-spectrum metadata tree (CV-resolved in the UI). Never fatal.
  try {
    out.meta = wavelengthSpectrumMetaTree(rec, index);
  } catch {
    out.meta = undefined;
  }
  return out;
}

/** Plain, structured-clone-safe metadata tree for the wavelength spectrum metadata panel. */
function wavelengthSpectrumMetaTree(rec: RawWavelengthSpectrum, index: number): unknown {
  const r = rec as unknown as {
    id?: unknown; time?: unknown; parameters?: unknown; params?: unknown;
    scans?: unknown; meta?: unknown;
  };
  return plainify({
    index,
    id: r.id,
    time: r.time,
    parameters: r.parameters ?? r.params,
    scans: r.scans,
    promotedColumns: r.meta,
  });
}

// ── Browse index ──────────────────────────────────────────────────────────────

/** A minimal view over the wavelength metadata table (the eager-loaded SpectrumMetadata). */
type WavelengthMetaTable = {
  length?: number;
  get(i: number | bigint): RawWavelengthSpectrum;
};

/**
 * Build the lazy wavelength BROWSE index — parallel arrays, length = numWavelengthSpectra.
 * Reads ONLY the in-memory metadata table (id, time, λmax); the heavy wavelength/intensity
 * arrays are NEVER materialized here (selected spectra are fetched on demand + LRU-cached).
 * `total` (TIC-analog) is filled from a declared total-signal column when present, else NaN
 * — we do NOT decode every spectrum just to sum it (that would defeat the lazy contract).
 */
export function buildWavelengthBrowse(reader: Reader): WavelengthBrowseIndex {
  const sm = reader.wavelengthMetadata as unknown as WavelengthMetaTable | null;
  const n = sm?.length ?? reader.numWavelengthSpectra ?? 0;

  const id: string[] = new Array(n);
  const rt = new Float32Array(n);
  const lambdaMax = new Float32Array(n);
  const total = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    rt[i] = NaN;
    lambdaMax[i] = NaN;
    total[i] = NaN;
    if (!sm) {
      id[i] = String(i);
      continue;
    }
    let rec: RawWavelengthSpectrum | undefined;
    try {
      rec = sm.get(i);
    } catch {
      id[i] = String(i);
      continue;
    }
    id[i] = String(rec?.id ?? i);
    const t = typeof rec?.time === "number" ? rec.time : (typeof rec?.time === "bigint" ? Number(rec.time) : NaN);
    if (Number.isFinite(t)) rt[i] = t * 60; // minutes → seconds
    if (rec) {
      const lm = readNumeric(rec, LAMBDA_MAX_ACC);
      if (lm != null && lm !== 0) lambdaMax[i] = lm;
      const tot = readNumeric(rec, "MS:1000285"); // total ion current analog, when declared
      if (tot != null) total[i] = tot;
    }
  }

  return { id, rt, lambdaMax, total };
}

/**
 * Dataset-level observed wavelength range [minNm, maxNm] across the file's wavelength
 * spectra, or null when unknown (MG-11 — drives the Summary UV / VIS / UV-VIS pill).
 * Metadata only (NO signal I/O): reads the per-spectrum lowest (MS:1000619) / highest
 * (MS:1000618) observed-wavelength CV terms from the in-memory wavelength metadata and
 * takes the min of the lows / max of the highs. Returns null when neither term is
 * present on any spectrum (we do NOT decode arrays just to find the range).
 */
export async function wavelengthRange(reader: Reader): Promise<[number, number] | null> {
  const n = reader.wavelengthMetadata?.length ?? reader.numWavelengthSpectra ?? 0;
  if (!n) return null;
  // The FIRST wavelength spectrum only (review): PDA/DAD scans share one common
  // wavelength grid, so spectrum 0's observed range is the dataset range — no need to
  // read every spectrum. Materialized once onto capability.wavelength.range at open.
  let spec: WavelengthSpectrumArrays;
  try {
    spec = await readWavelengthSpectrum(reader, 0);
  } catch {
    return null; // EmptyWavelengthSpectrumError / transient read error → no range
  }
  // Prefer the validated observed-range metadata; else the sorted wavelength-array bounds.
  const lo = spec.observedRange ? spec.observedRange[0] : spec.wavelength[0];
  const hi = spec.observedRange ? spec.observedRange[1] : spec.wavelength[spec.wavelength.length - 1];
  if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0 || lo > hi) {
    return null;
  }
  return [lo, hi];
}

// ── Time × wavelength matrix (PDA/DAD data cube) ───────────────────────────────

/**
 * Build the dense time × wavelength matrix for PDA/DAD UV/VIS data.
 * Common grid = spectrum 0's ascending wavelength array. Each spectrum is mapped onto
 * that grid by nearest sample; cells with no source sample within half the local grid
 * step become NaN. Rows are ordered by ascending acquisition time. All typed-array
 * buffers are fresh copies suitable for transfer.
 */
export async function buildWavelengthMatrix(reader: Reader): Promise<WavelengthMatrix> {
  const n = reader.numWavelengthSpectra ?? 0;
  if (n === 0) {
    return {
      time: new Float32Array(0),
      wavelength: new Float32Array(0),
      intensity: new Float32Array(0),
      width: 0,
      height: 0,
      min: NaN,
      max: NaN,
      intensityUnit: "Intensity",
    };
  }

  const spectra: WavelengthSpectrumArrays[] = [];
  for (let i = 0; i < n; i++) {
    spectra.push(await readWavelengthSpectrum(reader, i));
  }

  // Common grid: spectrum 0's wavelength axis (already ascending from reconstruct).
  const grid = spectra[0]!.wavelength.slice();
  const width = grid.length;
  const intensityUnit = spectra[0]!.intensityUnit;

  // Sort rows by ascending acquisition time; spectra with missing time sink to the end.
  spectra.sort((a, b) => {
    const fa = Number.isFinite(a.timeSec);
    const fb = Number.isFinite(b.timeSec);
    if (fa && fb) return a.timeSec - b.timeSec;
    if (fa) return -1;
    if (fb) return 1;
    return 0;
  });

  const height = spectra.length;
  const time = new Float32Array(height);
  const intensity = new Float32Array(height * width);

  // Half the local grid step per column: used as the inclusion radius for nearest-sample
  // mapping. Boundaries use the one-sided neighbor spacing; a single-column grid accepts
  // any nearest sample.
  const halfStep = new Float32Array(width);
  for (let w = 0; w < width; w++) {
    if (width === 1) {
      halfStep[w] = Infinity;
    } else {
      let step = Infinity;
      if (w > 0) step = Math.min(step, grid[w]! - grid[w - 1]!);
      if (w < width - 1) step = Math.min(step, grid[w + 1]! - grid[w]!);
      halfStep[w] = step / 2;
    }
  }

  let min = Infinity;
  let max = -Infinity;

  for (let t = 0; t < height; t++) {
    const spec = spectra[t]!;
    time[t] = spec.timeSec;

    const srcW = spec.wavelength;
    const srcI = spec.intensity;
    let srcIdx = 0;

    for (let w = 0; w < width; w++) {
      const targetW = grid[w]!;
      // Advance the source pointer while the next sample is closer to the target.
      while (
        srcIdx < srcW.length - 1 &&
        Math.abs(srcW[srcIdx + 1]! - targetW) < Math.abs(srcW[srcIdx]! - targetW)
      ) {
        srcIdx++;
      }

      let val = NaN;
      if (srcIdx < srcW.length) {
        const d = Math.abs(srcW[srcIdx]! - targetW);
        if (d <= halfStep[w]!) {
          val = srcI[srcIdx]!;
          if (Number.isFinite(val)) {
            if (val < min) min = val;
            if (val > max) max = val;
          }
        }
      }
      intensity[t * width + w] = val;
    }
  }

  return {
    time,
    wavelength: grid,
    intensity,
    width,
    height,
    min: Number.isFinite(min) ? min : NaN,
    max: Number.isFinite(max) ? max : NaN,
    intensityUnit,
  };
}
