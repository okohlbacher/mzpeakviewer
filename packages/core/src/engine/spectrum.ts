// Engine spectrum read: reconstruct one spectrum's signal, then adapt to the wire
// `SpectrumArrays`. The reconstruction (choosing the profile vs centroid source and
// resolving the representation) is a PURE, separately-testable function operating on
// the already-fetched raw mzpeakts spectrum record. The live reader call is the only
// I/O; everything else is pure so it can be unit-tested without WASM.
//
// Routing:
//   - representation "centroid" → centroid source (spectra_peaks).
//   - representation "profile" / null → data-array source (spectra_data), the
//     documented profile default.
//   - when the routed source is empty we fall through to the OTHER source so a
//     slightly-mislabeled file still renders — BUT the reported `representation`
//     stays the metadata-declared value (the file's own claim). The fallback never
//     rewrites the representation, so we don't lie about what the file says it is.
//   - when BOTH sources are empty we throw a named error rather than emit zeros.

import type { SpectrumArrays as WireSpectrumArrays, MobilityCodec } from "@mzpeak/contracts";
import { adaptSpectrum } from "../adapt/spectrum";
import { packMobility } from "../reader/mobility";
import { spectrumMeta } from "../reader/fileMeta";
import { streamSpectraDataArrays, streamSpectraPeaksArrays, type Reader, type StreamedSpectrumArrays } from "../reader/openUrl";
import type { SpectrumRepresentation } from "../reader/types";
import type { SpectrumLruCache } from "./cache";
import type { PrefetchControl } from "./imaging";

// Promoted per-spectrum columns (CV-accession-derived names) read vectorized for the
// LC prefetch — no per-record materialization.
const MS_LEVEL_COL = "MS_1000511_ms_level";
const REPR_COL = "MS_1000525_spectrum_representation";
const REPR_PROFILE_ACC = "MS:1000128";
const REPR_CENTROID_ACC = "MS:1000127";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
const PREFETCH_SLICE_MS = 30;
/** Max time the prefetch defers to sustained user activity before forcing one slice
 *  (bounds starvation under steady navigation). Mirrors imaging.ts. */
const MAX_PREFETCH_STARVE_MS = 4000;

// mzpeakts names the reconstructed data-array columns by their human-readable CV name.
const MZ_KEY = "m/z array";
const INTENSITY_KEY = "intensity array";
// Ion mobility (1/K0, MS:1003006) in the data-array (profile) path, keyed by the human
// array name. The centroid path reads it off the typed `mean_inverse_reduced_ion_mobility`
// field (mzpeakts' packTableIntoPeaks underscores the array name).
const MOBILITY_DATA_KEY = "mean inverse reduced ion mobility array";

/**
 * ims-compact (Bruker timsTOF / TDF) peaks store an integer `tof` (MS:1000786) in place of an
 * `m/z array`; m/z is recovered as `mz = (a + b·tof)²` with `a,b` from the index's
 * `ims_calibration` (the converter keeps this as the contract — tof in the *archive* is
 * absolute, a direct per-point map). See the mzPeakConverter compliance reply §2.
 */
export type ImsCalibration = { a: number; b: number };

function mzFromTof(cal: ImsCalibration, tof: number): number {
  const m = cal.a + cal.b * tof;
  return m * m;
}

/** The index `metadata` object (`store.fileIndex.metadata`), or `{}`. */
function indexMeta(reader: Reader): Record<string, unknown> {
  const m = (reader as unknown as { store?: { fileIndex?: { metadata?: unknown } } }).store?.fileIndex?.metadata;
  return m && typeof m === "object" ? (m as Record<string, unknown>) : {};
}
/** A metadata value that may be an inlined object OR a JSON string → object, else null. */
function asObj(v: unknown): Record<string, unknown> | null {
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** Parse `metadata.ims_calibration` (a JSON string OR an inlined object) to `{a,b}`, or null
 *  when the file isn't ims-compact / the calibration is malformed. */
export function readImsCalibration(reader: Reader): ImsCalibration | null {
  const raw = asObj(indexMeta(reader)["ims_calibration"]);
  if (!raw) return null;
  const a = raw["a"], b = raw["b"];
  return typeof a === "number" && typeof b === "number" ? { a, b } : null;
}

/** A per-spectrum integer-axis → m/z map for SciEX/Agilent grid profile data (`tof_index`). */
export type GridMz = (axis: number) => number;
const GRID_AXIS_KEY = "tof_index"; // mzpeakts array_name for the integer grid axis (MS:1000519)

/** One Agilent calibration row (`tof_calibration.calibrations[id]`): the traditional quadratic
 *  `(coeff·(t−base))²` plus a sub-ppm polynomial refinement evaluated at `clamp(t,left,right)`. */
type AgilentCal = { base: number; coeff: number; left: number; right: number; poly: number[]; useFlags: number };
type GridCal =
  | { kind: "mz-grid"; scale: number }
  | { kind: "tof-grid" }
  | { kind: "agilent-grid"; calibrations: Record<string, AgilentCal> };

const isFiniteNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Parse the `tof_calibration.calibrations` map (id → {base,coeff,left,right,poly_coeffs,use_flags}).
 * Returns null (→ the file fails loud as un-decodable) on ANY malformed entry rather than
 * silently reconstructing wrong m/z or throwing: a null/non-object row, a non-finite or zero
 * `coeff`, an inverted `left>right` window, a non-integer/out-of-range `use_flags`, or a
 * `poly_coeffs` that isn't an all-finite array. Valid converter output never trips these.
 */
function parseAgilentCals(raw: unknown): Record<string, AgilentCal> | null {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!obj) return null;
  const out: Record<string, AgilentCal> = {};
  for (const [id, v] of Object.entries(obj)) {
    const c = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    if (!c) return null;
    const base = c["base"], coeff = c["coeff"], left = c["left"], right = c["right"], uf = c["use_flags"], poly = c["poly_coeffs"];
    if (!isFiniteNum(base) || !isFiniteNum(coeff) || coeff === 0 || !isFiniteNum(left) || !isFiniteNum(right) || left > right) return null;
    if (!Number.isInteger(uf) || (uf as number) < 0 || (uf as number) > 0xffffffff) return null;
    if (!Array.isArray(poly) || !poly.every(isFiniteNum)) return null;
    out[id] = { base, coeff, left, right, poly: poly as number[], useFlags: uf as number };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Detect the grid calibration codec from the index metadata — COEFF-INDEPENDENT (no per-spectrum
 * read), so it's a stable "is this a grid file" predicate regardless of which spectrum is
 * inspected (a grid file's spectrum 0 may be an empty survey scan with null coefficients). Only
 * the VERIFIED shapes are accepted (gated on the `model` field); any unrecognised grid → null →
 * fail loud rather than reconstruct wrong m/z.
 */
function gridCal(reader: Reader): GridCal | null {
  const meta = indexMeta(reader);
  const mzc = asObj(meta["mz_calibration"]);
  if (mzc && mzc["codec"] === "mz-grid" && typeof mzc["scale"] === "number" && (mzc["scale"] as number) > 0) {
    return { kind: "mz-grid", scale: mzc["scale"] as number };
  }
  const tofc = asObj(meta["tof_calibration"]);
  if (tofc && tofc["codec"] === "tof-grid") {
    // SciEX sqrt: per-spectrum (tof_c0,tof_c1), mz=(c0+c1·idx)². No `calibrations` block.
    if (tofc["model"] === "sciex_sqrt" && !("calibrations" in tofc)) {
      const cols = tofc["per_spectrum_columns"];
      const formula = String(tofc["tof_to_mz"] ?? "");
      if (Array.isArray(cols) && cols.includes("tof_c0") && cols.includes("tof_c1")
        && /\(\s*tof_c0\s*\+\s*tof_c1\s*\*\s*tof_index\s*\)\s*\^\s*2/.test(formula)) {
        return { kind: "tof-grid" };
      }
    }
    // Agilent sqrt+poly: per-spectrum (tof_c0,tof_c1,tof_calibration_id) selects a row in the
    // `calibrations` map; mz=(coeff·(t−base))² − poly(clamp(t,left,right)). See agilent_profile.rs.
    if (tofc["model"] === "agilent_sqrt_poly") {
      const cols = tofc["per_spectrum_columns"];
      const cals = parseAgilentCals(tofc["calibrations"]);
      if (cals && Array.isArray(cols) && cols.includes("tof_c0") && cols.includes("tof_c1") && cols.includes("tof_calibration_id")) {
        return { kind: "agilent-grid", calibrations: cals };
      }
    }
  }
  return null;
}

/** Build the Horner coefficient list for an Agilent poly: `poly_coeffs` fill the orders whose
 *  bits are set in `useFlags` (ascending). Mirrors `calibrated_mz` in agilent_profile.rs. */
function agilentPoly(coeffs: number[], useFlags: number): number[] | null {
  if (useFlags === 0) return null;
  const poly: number[] = [];
  let ci = 0;
  for (let k = 0; k < 32; k++) {
    if ((useFlags >>> k) & 1) {
      while (poly.length <= k) poly.push(0);
      if (ci < coeffs.length) poly[k] = coeffs[ci++]!;
    }
  }
  return poly.length ? poly : null;
}

/** True when the file is a SciEX grid file (mz-grid OR tof-grid) — coeff-independent, so it's
 *  the correct gate for "skip the bulk prefetch / don't trust the imaging ion cache". */
export function isGridFile(reader: Reader): boolean {
  return gridCal(reader) !== null;
}

/**
 * Resolve the per-spectrum integer-axis → m/z map for a grid profile spectrum:
 *  - **mz-grid** (sciex uniform): `mz = tof_index / scale`, run-wide.
 *  - **tof-grid** (sciex sqrt): `mz = (c0 + c1·tof_index)²` with PER-SPECTRUM `c0,c1`.
 *  - **agilent-grid** (sqrt + polynomial): `mz = (c0+c1·k)² − poly(clamp(t,left,right))`,
 *    `t = base + (c0+c1·k)/coeff`, with PER-SPECTRUM `c0,c1,calibration_id` selecting the
 *    calibration row; exact MassHunter m/z (mirrors `calibrated_mz` in agilent_profile.rs).
 * Per-spectrum values come from the spectrum metadata (`MZP_1000003_tof_c0` /
 * `MZP_1000004_tof_c1` / `MZP_1000005_tof_calibration_id`). Returns null when the file isn't a
 * grid file OR this spectrum lacks usable coefficients (e.g. an empty survey scan).
 */
export function resolveGridMz(reader: Reader, index: number): GridMz | null {
  const g = gridCal(reader);
  if (!g) return null;
  if (g.kind === "mz-grid") { const s = g.scale; return (axis) => axis / s; }
  const spectra = (reader as unknown as { spectrumMetadata?: { spectra?: { getChild?: (n: string) => { get(i: number): unknown } | null } } }).spectrumMetadata?.spectra;
  const num = (name: string): number | null => {
    const v = spectra?.getChild?.(name)?.get?.(index);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const c0 = num("MZP_1000003_tof_c0"), c1 = num("MZP_1000004_tof_c1");
  if (c0 == null || c1 == null) return null;
  if (g.kind === "tof-grid") return (axis) => { const m = c0 + c1 * axis; return m * m; };
  // agilent-grid: select the calibration row for this spectrum, then mz = (c0+c1·k)² −
  // poly(clamp(t,left,right)) with t = base + (c0+c1·k)/coeff (= the Rust calibrated_mz).
  // `tof_calibration_id` is int64 → Arrow-JS yields a BigInt; coerce to the string map key.
  const idRaw = spectra?.getChild?.("MZP_1000005_tof_calibration_id")?.get?.(index);
  const calKey = typeof idRaw === "bigint" ? idRaw.toString()
    : typeof idRaw === "number" && Number.isSafeInteger(idRaw) ? String(idRaw) : null;
  const cal = calKey != null ? g.calibrations[calKey] : undefined;
  if (!cal) return null;
  const { base, coeff, left, right } = cal;
  const poly = agilentPoly(cal.poly, cal.useFlags);
  return (axis) => {
    const lin = c0 + c1 * axis; // = coeff·(t−base)
    const mz = lin * lin;
    if (!poly) return mz;
    const t = base + lin / coeff;
    const tc = t < left ? left : t > right ? right : t;
    let corr = 0;
    for (let i = poly.length - 1; i >= 0; i--) corr = corr * tc + poly[i]!;
    return mz - corr;
  };
}

// Standard centroid-object keys mzpeakts emits; any OTHER numeric key is the non-standard
// data array (the ims-compact `tof`, whose 1-word name packTableIntoPeaks can't suffix-strip).
const CENTROID_STD_KEYS = new Set(["mz", "intensity", "mean_inverse_reduced_ion_mobility"]);
function tofColumnKey(c: Record<string, unknown>): string | null {
  for (const k of Object.keys(c)) if (!CENTROID_STD_KEYS.has(k) && typeof c[k] === "number") return k;
  return null;
}

/** The raw spectrum record shape mzpeakts returns from getSpectrum(index). The centroid
 *  objects may carry extra promoted columns (e.g. ion mobility) beyond mz/intensity. */
export type RawSpectrum = {
  id: unknown;
  dataArrays?: Record<string, ArrayLike<number>> | undefined;
  centroids?: { mz: number; intensity: number; mean_inverse_reduced_ion_mobility?: number }[] | undefined;
};

/** Plain, transfer-ready reconstruction output (pre-adapter). */
export type ReconstructedSpectrum = {
  index: number;
  id: string;
  mz: Float64Array;
  intensity: Float32Array;
  /**
   * The representation the FILE declares (its MS:1000525 metadata value), NOT the
   * source the bytes were ultimately read from. A fallback read of the other source
   * does not change this — the metadata claim is preserved verbatim.
   */
  representation: SpectrumRepresentation;
  /** Dictionary-encoded per-peak ion mobility (1/K0), present only for IMS spectra that
   *  carry the MS:1003006 array; aligned with the post-sanitize `mz`/`intensity`. */
  mobility?: MobilityCodec;
};

/**
 * Thrown when neither spectra_data nor spectra_peaks yields decodable arrays for a
 * spectrum. Named so callers can distinguish "no signal at all" from a transient
 * reader error and never silently render zeros.
 */
export class EmptySpectrumError extends Error {
  constructor(public readonly index: number) {
    super(`Spectrum ${index}: neither spectra_data nor spectra_peaks has decodable m/z + intensity arrays`);
    this.name = "EmptySpectrumError";
  }
}

function hasDataArrays(s: RawSpectrum): boolean {
  return !!(s.dataArrays && s.dataArrays[MZ_KEY] && s.dataArrays[INTENSITY_KEY]);
}
/** Grid profile data: integer `tof_index` + intensity (no `m/z array`) AND a resolver to map it. */
function hasGridData(s: RawSpectrum, gridMz: GridMz | null): boolean {
  const da = s.dataArrays;
  return !!(gridMz && da && da[GRID_AXIS_KEY] && da[INTENSITY_KEY] && !da[MZ_KEY]);
}
function hasCentroids(s: RawSpectrum): boolean {
  return !!(s.centroids && s.centroids.length > 0);
}

/**
 * Drop non-finite (mz, intensity) PAIRS, reconcile a ragged mz/intensity length
 * (truncate to the shorter), and guarantee ascending m/z. uPlot and the hover
 * binary-search require monotonic finite x. PURE + separately unit-testable.
 *
 * Fast path: when the input is already finite + sorted + equal-length (the normal
 * case for real data) the inputs are returned unchanged with no copy.
 */
export function sanitizePairs(
  mz: Float64Array,
  intensity: Float32Array,
  mobility?: ArrayLike<number>,
): { mz: Float64Array; intensity: Float32Array; mobility?: Float64Array } {
  const n = Math.min(mz.length, intensity.length);
  let clean = mz.length === intensity.length;
  for (let i = 0; i < n && clean; i++) {
    if (
      !Number.isFinite(mz[i]!) ||
      !Number.isFinite(intensity[i]!) ||
      (i > 0 && mz[i]! < mz[i - 1]!)
    ) {
      clean = false;
    }
  }
  // Fast path: already finite + sorted + equal-length. mz/intensity pass through uncopied;
  // mobility (if any) is owned-copied to the same length so it stays aligned.
  if (clean) return mobility ? { mz, intensity, mobility: Float64Array.from({ length: n }, (_, i) => mobility[i]!) } : { mz, intensity };

  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(mz[i]!) && Number.isFinite(intensity[i]!)) idx.push(i);
  }
  idx.sort((a, b) => mz[a]! - mz[b]!);
  const nmz = new Float64Array(idx.length);
  const ninten = new Float32Array(idx.length);
  // Carry mobility through the SAME drop-and-reorder permutation so mobility[k] keeps
  // pointing at the peak now at nmz[k]/ninten[k].
  const nmob = mobility ? new Float64Array(idx.length) : undefined;
  for (let i = 0; i < idx.length; i++) {
    const j = idx[i]!;
    nmz[i] = mz[j]!;
    ninten[i] = intensity[j]!;
    if (nmob) nmob[i] = mobility![j]!;
  }
  return nmob ? { mz: nmz, intensity: ninten, mobility: nmob } : { mz: nmz, intensity: ninten };
}

type RawSignal = { mz: Float64Array; intensity: Float32Array; mobility?: ArrayLike<number> };

/** Copy spectra_data (profile) arrays into the canonical dtypes (f64 m/z, f32 int), plus
 *  the optional ion-mobility array when the file carries it. */
function readDataArrays(s: RawSpectrum, gridMz: GridMz | null): RawSignal {
  const da = s.dataArrays!;
  // SciEX/Agilent grid: an integer `tof_index` replaces the `m/z array`; reconstruct m/z
  // per point through the resolved grid map (mz-grid: idx/scale; tof-grid: (c0+c1·idx)²).
  if (gridMz && da[GRID_AXIS_KEY] && !da[MZ_KEY]) {
    const axis = da[GRID_AXIS_KEY]!, n = axis.length;
    const mz = new Float64Array(n);
    for (let i = 0; i < n; i++) mz[i] = gridMz(axis[i]!);
    return { mz, intensity: Float32Array.from(da[INTENSITY_KEY]!) };
  }
  const mob = da[MOBILITY_DATA_KEY];
  return {
    mz: Float64Array.from(da[MZ_KEY]!),
    intensity: Float32Array.from(da[INTENSITY_KEY]!),
    ...(mob ? { mobility: mob } : {}),
  };
}

/** Copy spectra_peaks (centroid) arrays into the canonical dtypes, plus per-peak ion
 *  mobility when the centroid objects carry it (timsTOF / IMS). When the peaks carry a
 *  `tof` array instead of `mz` (ims-compact) and `cal` is present, reconstruct
 *  `mz = (a + b·tof)²`. */
function readCentroids(s: RawSpectrum, cal: ImsCalibration | null): RawSignal {
  const centroids = s.centroids! as unknown as Record<string, number>[];
  const n = centroids.length;
  const mz = new Float64Array(n);
  const intensity = new Float32Array(n);
  const hasMobility = n > 0 && centroids[0]!["mean_inverse_reduced_ion_mobility"] != null;
  const mobility = hasMobility ? new Float64Array(n) : undefined;
  // ims-compact: no `mz` key, integer `tof` instead. Locate the tof column once (its mzpeakts
  // key is unstable), then map every peak through the calibration.
  const tofKey = cal && n > 0 && centroids[0]!["mz"] == null ? tofColumnKey(centroids[0]!) : null;
  for (let i = 0; i < n; i++) {
    const c = centroids[i]!;
    // tofKey may be "" (mzpeakts mangles the 1-word "tof" name) — test for null, not truthiness.
    mz[i] = tofKey !== null ? mzFromTof(cal!, c[tofKey]!) : c["mz"]!;
    intensity[i] = c["intensity"]!;
    if (mobility) mobility[i] = c["mean_inverse_reduced_ion_mobility"]!;
  }
  return mobility ? { mz, intensity, mobility } : { mz, intensity };
}

/**
 * PURE reconstruction: pick the signal source the resolved `representation` routes
 * to, with a fall-through to the OTHER source so a file whose MS:1000525 disagrees
 * with its stored layout still reconstructs. Two invariants:
 *   1. `representation` in the result is ALWAYS the metadata-declared value — a
 *      fallback read never rewrites it (no false claim about the file).
 *   2. When NEITHER source has arrays we throw `EmptySpectrumError`, never zeros.
 * Both profile and centroid arrays are run through `sanitizePairs`.
 */
export function reconstructSpectrum(
  spectrum: RawSpectrum,
  index: number,
  representation: SpectrumRepresentation,
  cal: ImsCalibration | null = null,
  gridMz: GridMz | null = null,
): ReconstructedSpectrum {
  // A genuinely-EMPTY scan: mzpeakts emits a 0-length `m/z array` (the file's own "0 data
  // points" signal) and nothing else. Render it as an empty spectrum rather than throwing —
  // SciEX/Agilent runs interleave empty survey scans with data scans, so the default-open
  // spectrum is often empty. This is distinct from "no decodable arrays at all" (which still
  // throws below): here the file explicitly declares zero points.
  const mzArr = spectrum.dataArrays?.[MZ_KEY];
  const daOk = hasDataArrays(spectrum) || hasGridData(spectrum, gridMz);
  if (!daOk && !hasCentroids(spectrum) && mzArr && mzArr.length === 0) {
    return { index, id: String(spectrum.id), mz: new Float64Array(0), intensity: new Float32Array(0), representation };
  }

  // Route by representation, but fall through to the other source when empty.
  // `representation` is reported as-is regardless of which source supplied bytes.
  // ims-compact peaks → centroid reader takes `cal`; SciEX grid profile → data reader takes `gridMz`.
  let raw: RawSignal;
  if (representation === "centroid") {
    if (hasCentroids(spectrum)) raw = readCentroids(spectrum, cal);
    else if (daOk) raw = readDataArrays(spectrum, gridMz);
    else throw new EmptySpectrumError(index);
  } else {
    // "profile" or null (unknown) → data-array default, centroid fall-through.
    if (daOk) raw = readDataArrays(spectrum, gridMz);
    else if (hasCentroids(spectrum)) raw = readCentroids(spectrum, cal);
    else throw new EmptySpectrumError(index);
  }

  // Carry mobility through the same drop-and-sort permutation, then dictionary-encode it
  // (a TIMS frame's ~10⁵ peaks share a few hundred 1/K0 bins — see MobilityCodec).
  const clean = sanitizePairs(raw.mz, raw.intensity, raw.mobility);
  return {
    index,
    id: String(spectrum.id),
    mz: clean.mz,
    intensity: clean.intensity,
    representation, // metadata value, preserved across any fallback
    ...(clean.mobility ? { mobility: packMobility(clean.mobility) } : {}),
  };
}

/**
 * Read + reconstruct spectrum `index` and adapt it to the wire `SpectrumArrays`.
 * The live reader stays in the engine; only plain typed arrays leave the boundary.
 */
export async function readEngineSpectrum(
  reader: Reader,
  index: number,
): Promise<WireSpectrumArrays> {
  // Resolve representation from the metadata row (MS:1000525), null when unknown.
  let representation: SpectrumRepresentation = null;
  try {
    representation = spectrumMeta(reader, index).representation;
  } catch {
    representation = null;
  }

  const spectrum = (await reader.getSpectrum(index)) as RawSpectrum | null;
  if (!spectrum) throw new Error(`No spectrum at index ${index}`);

  const recon = reconstructSpectrum(spectrum, index, representation, readImsCalibration(reader), resolveGridMz(reader, index));
  return adaptSpectrum({
    index: recon.index,
    id: recon.id,
    mz: recon.mz,
    intensity: recon.intensity,
    representation: recon.representation,
    ...(recon.mobility ? { mobility: recon.mobility } : {}),
  });
}

/** Minimal view over the promoted per-spectrum Arrow columns. */
type Col = { get(i: number): unknown } | null | undefined;
function readCols(reader: Reader): { n: number; lvl: Col; repr: Col } {
  const sm = reader.spectrumMetadata as unknown as
    | { length?: number; spectra?: { getChild?: (n: string) => Col } | null }
    | null
    | undefined;
  const spectra = sm?.spectra;
  const get = (name: string): Col =>
    spectra && typeof spectra.getChild === "function" ? spectra.getChild(name) : null;
  return { n: sm?.length ?? 0, lvl: get(MS_LEVEL_COL), repr: get(REPR_COL) };
}

/**
 * Background-prefetch the SPECTRUM LRU for a non-imaging (LC/DDA) file: stream the signal
 * sources ONCE and cache the **MS0/1** spectra (skipping MS2, per the design requirement)
 * so first-time navigation to any MS1 spectrum is instant instead of a cold row-group read.
 *
 * Routing correctness: each spectrum is cached from the source its declared representation
 * routes to — profile/unknown from `spectra_data`, centroid from `spectra_peaks` — which is
 * exactly what `readEngineSpectrumCached` would reconstruct on a miss, so a cache hit never
 * returns mismatched arrays. (LC/DDA spectra usually live in `spectra_peaks` as centroids.)
 *
 * Cooperative + interruptible (same `PrefetchControl` as the ion prefetch): reads run under
 * the mutex, pause on user activity, time-slice (30 ms), and bail on `shouldStop`. The LRU's
 * own budget eviction bounds memory. MS-scoping saves cache memory; it does not save
 * bandwidth (MS1/MS2 interleave in the peaks row groups).
 */
export async function prefetchSpectrumCache(
  reader: Reader,
  cache: SpectrumLruCache,
  control: PrefetchControl,
): Promise<{ cached: number; stopped: boolean }> {
  const { lvl, repr } = readCols(reader);
  let cached = 0;

  const msLevelOf = (i: number): number | null => {
    const v = lvl?.get(i);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  // MS0/1 only — skip MS2+. null/unknown level is treated as MS1 (kept).
  const isMs01 = (i: number): boolean => {
    const m = msLevelOf(i);
    return m === null || m <= 1;
  };
  const reprOf = (i: number): SpectrumRepresentation => {
    const v = repr?.get(i);
    if (v === REPR_PROFILE_ACC) return "profile";
    if (v === REPR_CENTROID_ACC) return "centroid";
    return null;
  };

  const waitWhileUserActive = async (): Promise<boolean> => {
    const waitStart = nowMs();
    while (control.isUserActive()) {
      if (control.shouldStop()) return false;
      if (nowMs() - waitStart > MAX_PREFETCH_STARVE_MS) break; // forced progress (see imaging.ts)
      await sleep(control.cooldownMs()); // live adaptive value, re-read each slice
    }
    return !control.shouldStop();
  };

  // Drive one bulk stream through the time-sliced mutex loop, caching entries `accept`s.
  const drain = async (
    stream: AsyncGenerator<StreamedSpectrumArrays>,
    accept: (index: number) => boolean,
  ): Promise<boolean> => {
    const it = stream[Symbol.asyncIterator]();
    let done = false;
    try {
      while (!done) {
        if (!(await waitWhileUserActive())) return false;
        await control.mutex.runExclusive(async () => {
          const start = nowMs();
          for (;;) {
            const res = await it.next();
            if (res.done) { done = true; return; }
            const { index, mz, intensity } = res.value;
            if (accept(index)) {
              // The spectrum-display prefetch streams full f64 m/z (default, no mzFloat32) for
              // display fidelity, so mz is a Float64Array here.
              cache.set(index, { mz: mz as Float64Array, intensity, msLevel: msLevelOf(index) });
              cached++;
            }
            if (nowMs() - start > PREFETCH_SLICE_MS) return;
          }
        });
        await sleep(0);
      }
    } finally {
      if (it.return) await it.return(undefined);
    }
    return true;
  };

  // ims-compact / SciEX-grid files: the bulk stream yields {index, mz, intensity} where the
  // integer axis is either ABSENT (ims-compact `tof`) or NOT named "m/z array" (grid
  // `tof_index`), so it never reconstructs true m/z — prefetching is useless/poisoning. Skip
  // it entirely; the per-select getSpectrum path reconstructs + caches on demand. NOTE: gate on
  // the coeff-INDEPENDENT `isGridFile`, not `resolveGridMz(reader,0)` — a grid file's spectrum 0
  // is usually an empty survey scan with null c0/c1, which would make a per-spectrum probe miss.
  if (readImsCalibration(reader) || isGridFile(reader)) return { cached: 0, stopped: false };
  // Profile/unknown spectra from spectra_data; centroid spectra from spectra_peaks.
  const okData = await drain(streamSpectraDataArrays(reader), (i) => isMs01(i) && reprOf(i) !== "centroid");
  if (!okData) return { cached, stopped: true };
  const okPeaks = await drain(streamSpectraPeaksArrays(reader), (i) => isMs01(i) && reprOf(i) === "centroid");
  return { cached, stopped: !okPeaks };
}

/**
 * Cached variant of {@link readEngineSpectrum}: serves the decoded (m/z, intensity)
 * arrays from the worker's `SpectrumLruCache` on a hit, avoiding the expensive
 * `getSpectrum` row-group read. Only the signal arrays + msLevel are cached; the light
 * metadata (id, representation) is re-read from the in-memory table every call (cheap),
 * per the "no metadata besides MS level" design requirement.
 *
 * Transfer-safety: `adaptSpectrum` ALWAYS copies its inputs (it is the transfer
 * boundary), so the wire result never aliases — and therefore never detaches — the
 * cached arrays. The cache keeps the canonical buffers; the response carries copies.
 */
export async function readEngineSpectrumCached(
  reader: Reader,
  index: number,
  cache: SpectrumLruCache,
  ionCache?: { lookup(index: number): { mz: Float32Array; intensity: Float32Array } | undefined },
): Promise<WireSpectrumArrays> {
  // Light metadata is always cheap (in-memory metadata table): id, representation, msLevel.
  let representation: SpectrumRepresentation = null;
  let id = String(index);
  let msLevel: number | null = null;
  try {
    const m = spectrumMeta(reader, index);
    representation = m.representation;
    id = m.id;
    msLevel = m.msLevel;
  } catch {
    // keep defaults
  }

  const hit = cache.get(index);
  if (hit) {
    return adaptSpectrum({ index, id, mz: hit.mz, intensity: hit.intensity, representation, ...(hit.mobility ? { mobility: hit.mobility } : {}) });
  }

  // Imaging fast path: the background ion prefetch has already DECODED every grid-pixel
  // spectrum into the ion cache. Reuse it for a pixel-pick select instead of a cold
  // random-access getSpectrum (which on large-row-group / no-page-index profile data costs
  // ~seconds per pixel). The ion cache holds f32 m/z — adaptSpectrum widens to f64; for
  // display that's lossless enough. Only when the cache is WARM and holds this index.
  // NOT for SciEX-grid files: the ion cache is filled from the raw bulk stream (`tof_index`,
  // un-reconstructed), so trust only the getSpectrum reconstruction path below for those.
  const ionHit = isGridFile(reader) ? undefined : ionCache?.lookup(index);
  if (ionHit) {
    return adaptSpectrum({ index, id, mz: ionHit.mz, intensity: ionHit.intensity, representation });
  }

  const spectrum = (await reader.getSpectrum(index)) as RawSpectrum | null;
  if (!spectrum) throw new Error(`No spectrum at index ${index}`);
  const recon = reconstructSpectrum(spectrum, index, representation, readImsCalibration(reader), resolveGridMz(reader, index));
  // Cache the canonical decoded arrays (adaptSpectrum copies for the wire below).
  cache.set(index, { mz: recon.mz, intensity: recon.intensity, msLevel, ...(recon.mobility ? { mobility: recon.mobility } : {}) });
  return adaptSpectrum({
    index,
    id: recon.id,
    mz: recon.mz,
    intensity: recon.intensity,
    representation: recon.representation,
    ...(recon.mobility ? { mobility: recon.mobility } : {}),
  });
}
