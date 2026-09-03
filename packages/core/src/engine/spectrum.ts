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
import { getCol } from "../reader/explorer/cv";
import { streamSpectraDataArrays, streamSpectraPeaksArrays, type Reader, type StreamedSpectrumArrays } from "../reader/openUrl";
import type { SpectrumRepresentation } from "../reader/types";
import type { SpectrumLruCache } from "./cache";
import type { PrefetchControl } from "./imaging";

// Promoted per-spectrum columns (CV-accession-derived names) read vectorized for the
// LC prefetch — no per-record materialization.
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
 *
 * `a,b` are the RUN-WIDE two-point chord (timsrust). When the vendor MzCalibration is exactly
 * linear in tof (TDF ModelType 1 with C2 = 0) the converter ALSO writes per-spectrum `tof_c0` /
 * `tof_c1` metadata columns — named by `ims_calibration.per_spectrum` ("tof_c0,tof_c1"), the same
 * `*_tof_c0` / `*_tof_c1` suffix convention as the SciEX sqrt grid — that reproduce the vendor
 * m/z through the SAME transform (MS:1003825): `mz = (tof_c0 + tof_c1·tof)²`.
 * {@link resolveImsCalibration} binds that pair for one spectrum; {@link mzFromTof} prefers it.
 */
export type ImsCalibration = {
  a: number;
  b: number;
  // How `point.tof` is stored (ims-compact Layout A/B). "per-scan-delta": tof is a per-mobility-
  // scan delta (first-of-scan absolute, rest deltas) → needs a cumsum with a reset at each scan
  // boundary (a mobility-value change) before mzFromTof. "absolute": tof is the raw bin (--no-tof-
  // delta). null: legacy files with no encoding declared → treat as absolute. See the IM-TOF handoff.
  tofEncoding: "per-scan-delta" | "absolute" | "m/z-chunked" | null;
  /** Metadata column NAME SUFFIXES of the per-spectrum linear pair (`per_spectrum: "tof_c0,tof_c1"`
   *  → `_tof_c0` / `_tof_c1`), or null when the archive carries only the run-wide chord. */
  perSpectrum?: { c0: string; c1: string } | null;
  /** What named the pair: the `ims_calibration.per_spectrum` key, or — with no (valid) key — the
   *  presence of BOTH `*_tof_c0` / `*_tof_c1` spectra-metadata columns, the trigger the vendored
   *  Rust reader uses (`reader/point.rs reconstruct_per_spectrum_grid_mz`: the `SqrtMzFromTof` array
   *  index entry + `tof_c0`/`tof_c1` params by name), so a hand-edited / stamp-only archive maps the
   *  same way in both readers. */
  perSpectrumSource?: "per_spectrum" | "columns" | null;
  /** The converter's `exact_per_spectrum` claim: the per-spectrum pair IS the vendor calibration. */
  exactPerSpectrum?: boolean;
  /** THIS spectrum's own (c0, c1), bound by {@link resolveImsCalibration} when its columns are
   *  finite; `mzFromTof` prefers it over the chord. Absent / null → the run-wide chord. */
  spectrumCoeffs?: { c0: number; c1: number } | null;
};

function mzFromTof(cal: ImsCalibration, tof: number): number {
  const s = cal.spectrumCoeffs;
  const m = s ? s.c0 + s.c1 * tof : cal.a + cal.b * tof;
  return m * m;
}

/** The tof → m/z map `cal` reconstructs with (the bound per-spectrum pair, else the chord) — for
 *  the callers that map an axis outside the spectrum readers (the ims-compact XIC window). */
export function imsTofToMz(cal: ImsCalibration): (tof: number) => number {
  return (tof) => mzFromTof(cal, tof);
}

/** True when `cal` reconstructs m/z through the per-spectrum pair the converter declared exact
 *  (`exact_per_spectrum` AND this spectrum's own finite columns) — the vendor m/z, not the chord.
 *  Not surfaced by any UI today (nothing reads `ims_calibration.exact`); exported for the day one does. */
export function imsMzExact(cal: ImsCalibration | null): boolean {
  return !!(cal && cal.spectrumCoeffs && cal.exactPerSpectrum);
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

/** The default per-spectrum pair suffixes (the sqrt-grid `tof_c0` / `tof_c1` columns, MS:4000900/1 or
 *  MZP:1000003/4 — matched by suffix, like {@link resolveGridMz}). */
const TOF_PAIR_SUFFIXES = { c0: "_tof_c0", c1: "_tof_c1" } as const;

/** Parse `metadata.ims_calibration` (a JSON string OR an inlined object) to `{a,b}`, or null
 *  when the file isn't ims-compact / the calibration is malformed. */
export function readImsCalibration(reader: Reader): ImsCalibration | null {
  const raw = asObj(indexMeta(reader)["ims_calibration"]);
  if (!raw) return null;
  const a = raw["a"], b = raw["b"];
  if (typeof a !== "number" || typeof b !== "number") return null;
  const te = raw["tof_encoding"];
  const tofEncoding =
    te === "per-scan-delta" || te === "absolute" || te === "m/z-chunked" ? te : null;
  // `per_spectrum`: "tof_c0,tof_c1" (a comma list; an array is tolerated) naming the two
  // per-spectrum metadata columns, c0 then c1. Without a valid key the pair is still bound when
  // BOTH default `*_tof_c0` / `*_tof_c1` columns exist — that is the vendored Rust reader's trigger
  // (`reconstruct_per_spectrum_grid_mz`: the `SqrtMzFromTof` array-index entry every ims-compact
  // `tof` column carries + the `tof_c0`/`tof_c1` params by name), so an archive that carries the
  // columns but lost the key (hand-edited index JSON, a partial migration) reconstructs the SAME
  // m/z here as through `mzpeak-convert ARCHIVE -o x.mzML`. Other column names are never guessed.
  const ps = raw["per_spectrum"];
  const names: unknown[] = typeof ps === "string" ? ps.split(",").map((x) => x.trim()) : Array.isArray(ps) ? ps : [];
  let perSpectrum: ImsCalibration["perSpectrum"] = null;
  let perSpectrumSource: ImsCalibration["perSpectrumSource"] = null;
  if (names.length === 2 && names.every((n) => typeof n === "string" && /^[A-Za-z0-9_]+$/.test(n))) {
    perSpectrum = { c0: `_${names[0] as string}`, c1: `_${names[1] as string}` };
    perSpectrumSource = "per_spectrum";
  } else {
    const spectra = spectraStruct(reader);
    if (fieldBySuffix(spectra, TOF_PAIR_SUFFIXES.c0) && fieldBySuffix(spectra, TOF_PAIR_SUFFIXES.c1)) {
      perSpectrum = { ...TOF_PAIR_SUFFIXES };
      perSpectrumSource = "columns";
    }
  }
  return { a, b, tofEncoding, perSpectrum, perSpectrumSource, exactPerSpectrum: raw["exact_per_spectrum"] === true };
}

/** Per reader: how many spectra a `per_spectrum` + `exact_per_spectrum` archive has so far left on
 *  the chord because their pair cells were null / non-finite / 0 (see {@link resolveImsCalibration}).
 *  The converter's lane is all-or-nothing, so any count > 0 is a half-written or truncated
 *  metadata facet — warned once per reader on the console and readable here for a UI badge. */
const imsPairUnbound = new WeakMap<object, number>();
/** The number of spectra of `reader` resolved so far that fell back to the chord although the
 *  archive claims an exact per-spectrum pair (0 = no degradation seen). */
export function imsPairUnboundCount(reader: Reader): number {
  return imsPairUnbound.get(reader as unknown as object) ?? 0;
}

/**
 * The ims-compact calibration to reconstruct spectrum `index` with: the run-wide chord, with THIS
 * spectrum's exact linear pair bound (`spectrumCoeffs`) when `ims_calibration.per_spectrum` names
 * the columns (or the default `*_tof_c0`/`*_tof_c1` columns exist — {@link readImsCalibration})
 * and both cells are finite. A missing / null / non-finite cell — or a `tof_c1` of 0,
 * the value mzpeakts materialises for a NULL f64 cell (a spectrum the converter left on the chord;
 * a real c1 = DigitizerTimebase·√C1/1e6 is never 0) — falls back to the chord: never a constant-
 * m/z spectrum reconstructed from a null fill. Null when the file isn't ims-compact.
 */
export function resolveImsCalibration(reader: Reader, index: number): ImsCalibration | null {
  const cal = readImsCalibration(reader);
  if (!cal?.perSpectrum) return cal;
  const spectra = spectraStruct(reader);
  const c0 = spectrumNumBySuffix(spectra, cal.perSpectrum.c0, index);
  const c1 = spectrumNumBySuffix(spectra, cal.perSpectrum.c1, index);
  if (c0 == null || c1 == null || c1 === 0) {
    // The archive CLAIMS every spectrum carries the exact pair; this one doesn't → it renders on
    // the chord (up to ~4 ppm off on 2485.d). Never silent: count it and warn once per reader.
    if (cal.exactPerSpectrum) {
      const key = reader as unknown as object;
      const n = (imsPairUnbound.get(key) ?? 0) + 1;
      imsPairUnbound.set(key, n);
      if (n === 1) {
        console.warn(
          `ims_calibration declares exact_per_spectrum but spectrum ${index} has no finite ` +
          `${cal.perSpectrum.c0}/${cal.perSpectrum.c1} pair (null, NaN or c1 = 0); it and any further ` +
          `such spectra fall back to the run-wide chord (a + b·tof)² — a half-written or truncated ` +
          `spectra_metadata facet? (warned once per file; imsPairUnboundCount(reader) has the count)`,
        );
      }
    }
    return cal;
  }
  return { ...cal, spectrumCoeffs: { c0, c1 } };
}

/** A per-spectrum integer-axis → m/z map for SciEX/Agilent/Shimadzu grid data (`tof_index`). */
export type GridMz = (axis: number) => number;
/**
 * The facet a grid resolver is asked for. One file may carry BOTH index blocks — Shimadzu keeps
 * the per-spectrum sqrt grid (`tof_calibration`) on the PROFILE facet and an exact Int64 lattice
 * (`mz_calibration`, `mz-grid`) on the CENTROID facet — so the block precedence is per facet:
 *   centroid → `mz_calibration` first, then `tof_calibration`;
 *   profile  → `tof_calibration` first, then `mz_calibration`.
 * Single-block files resolve identically for either facet (SciEX `mz-grid` → centroids; mzML
 * `--tof-grid` → both facets through the sqrt grid, exactly as before).
 */
export type GridFacet = "profile" | "centroid";
/** Per-facet grid resolvers for one spectrum (null = that facet has no resolvable grid). */
export type GridResolvers = { profile: GridMz | null; centroid: GridMz | null };
/** Widen an `ArrayLike<number>` to the Int64 case: mzpeakts materialises an Int64 column as a
 *  `BigInt64Array` (dataArrays) / `bigint` properties (centroid objects). Every AXIS read goes
 *  through `axisNum` before arithmetic; lattice values reach ~1.25e12, well inside Number. */
type AxisLike = ArrayLike<number | bigint>;
const axisNum = (v: number | bigint | undefined | null): number =>
  typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : NaN;
const GRID_AXIS_KEY = "tof_index"; // mzpeakts array_name for the integer grid axis (MS:1000519)
const TOF_DATA_KEY = "tof"; // ims-compact tof axis (MS:1000786) as it appears in a chunked facet (Layout B)

/** One Agilent calibration row (`tof_calibration.calibrations[id]`): the traditional quadratic
 *  `(coeff·(t−base))²` plus a sub-ppm polynomial refinement evaluated at `clamp(t,left,right)`. */
type AgilentCal = { base: number; coeff: number; left: number; right: number; poly: number[]; useFlags: number };
type GridCal =
  | { kind: "mz-grid"; scale: number }
  | { kind: "tof-grid" } // sciex sqrt, PER-SPECTRUM c0/c1
  | { kind: "tof-grid-global"; c0: number; c1: number } // sciex sqrt, RUN-WIDE c0/c1
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
function gridCal(reader: Reader, facet: GridFacet = "centroid"): GridCal | null {
  const meta = indexMeta(reader);
  const mzRaw = meta["mz_calibration"], tofRaw = meta["tof_calibration"];
  // Per-facet precedence (see GridFacet): the centroid facet prefers the `mz_calibration`
  // lattice, the profile facet prefers the `tof_calibration` sqrt grid. The fallback to the
  // OTHER block applies only when the preferred block is ABSENT (single-block files). A block
  // that is PRESENT but malformed (e.g. a string / zero `scale`) resolves to null for its
  // facet — fail loud rather than push a ~1e12 lattice axis through the sqrt grid and render
  // finite, ascending, absurd m/z (review 2026-09-02).
  return facet === "profile"
    ? asObj(tofRaw) != null ? mzGridTofCal(tofRaw) : mzGridLatticeCal(mzRaw)
    : asObj(mzRaw) != null ? mzGridLatticeCal(mzRaw) : mzGridTofCal(tofRaw);
}

/** `mz_calibration` `{codec:"mz-grid", scale}` → uniform lattice `mz = idx · (1/scale)`. `scale` must
 *  be a JSON number > 0 (the viewer gates on it — a string/zero/negative scale is unresolvable). */
function mzGridLatticeCal(raw: unknown): GridCal | null {
  const mzc = asObj(raw);
  if (mzc && mzc["codec"] === "mz-grid" && typeof mzc["scale"] === "number" && (mzc["scale"] as number) > 0) {
    return { kind: "mz-grid", scale: mzc["scale"] as number };
  }
  return null;
}

/** `tof_calibration` `{codec:"tof-grid", model, …}` → the verified sqrt / Agilent shapes. */
function mzGridTofCal(raw: unknown): GridCal | null {
  const tofc = asObj(raw);
  if (tofc && tofc["codec"] === "tof-grid") {
    // SciEX sqrt, mz=(c0+c1·idx)². Current model is "sciex_sqrt_per_spectrum" (per-spectrum
    // c0/c1 columns); "sciex_sqrt" is the mzML --tof-grid path (per-spectrum if it carries the
    // columns, else RUN-WIDE c0/c1 in the block). Gate on `model` + columns/keys only (not the
    // `tof_to_mz` formula string, whose format isn't a contract).
    if ((tofc["model"] === "sciex_sqrt_per_spectrum" || tofc["model"] === "sciex_sqrt") && !("calibrations" in tofc)) {
      const cols = tofc["per_spectrum_columns"];
      if (Array.isArray(cols) && cols.includes("tof_c0") && cols.includes("tof_c1")) {
        return { kind: "tof-grid" };
      }
      // Global path: run-wide c0/c1 in the block, no per-spectrum columns. (Unverified shape —
      // no corpus file uses it yet; reads `c0`/`c1` per the converter's mz_from_tof_index spec.)
      if (tofc["model"] === "sciex_sqrt" && isFiniteNum(tofc["c0"]) && isFiniteNum(tofc["c1"])) {
        return { kind: "tof-grid-global", c0: tofc["c0"] as number, c1: tofc["c1"] as number };
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

/** True when the file is GRID-ENCODED (`mz-grid`/`tof-grid` codec present) — independent of
 *  whether we can fully RESOLVE the m/z (an unknown/unverified model still returns true here).
 *  This is the gate for "skip the bulk prefetch / don't trust the imaging ion cache": a grid file
 *  we can't resolve must still bypass those raw-`tof_index` paths (the per-select read fails loud
 *  instead). m/z reconstruction itself uses the stricter `gridCal`/`resolveGridMz`. */
export function isGridFile(reader: Reader): boolean {
  if (gridCal(reader)) return true; // either block resolvable (the centroid order sees both)
  const meta = indexMeta(reader);
  const mzc = asObj(meta["mz_calibration"]);
  if (mzc && mzc["codec"] === "mz-grid") return true;
  const tofc = asObj(meta["tof_calibration"]);
  return !!(tofc && tofc["codec"] === "tof-grid");
}

/** A minimal view of the spectrum-metadata `spectrum` struct vector (mzpeakts Arrow). */
type SpectraStruct = { getChild?: (n: string) => { get(i: number): unknown } | null; type?: { children?: { name?: unknown }[] } };
/** The full metadata field name ENDING in `suffix` (e.g. "_tof_c0"), or null — robust to the
 *  accession-prefix drift (MZP_1000003_tof_c0 → MS_4000900_tof_c0); `per_spectrum_columns` pins
 *  the suffix, so we match on it rather than the full accession-prefixed name. */
function fieldBySuffix(spectra: SpectraStruct | undefined, suffix: string): string | null {
  const kids = spectra?.type?.children;
  if (Array.isArray(kids)) for (const c of kids) if (typeof c?.name === "string" && c.name.endsWith(suffix)) return c.name;
  return null;
}
/** The spectrum-metadata `spectrum` struct vector (mzpeakts Arrow), if the reader exposes it. */
function spectraStruct(reader: Reader): SpectraStruct | undefined {
  return (reader as unknown as { spectrumMetadata?: { spectra?: SpectraStruct } }).spectrumMetadata?.spectra;
}
/** The FINITE number in the per-spectrum metadata column whose name ends in `suffix`, for
 *  spectrum `index`; null when the column is absent or the cell is null / non-finite. */
function spectrumNumBySuffix(spectra: SpectraStruct | undefined, suffix: string, index: number): number | null {
  const name = fieldBySuffix(spectra, suffix);
  const v = name ? spectra?.getChild?.(name)?.get?.(index) : null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Resolve the per-spectrum integer-axis → m/z map for a grid spectrum, for ONE facet:
 *  - **mz-grid** (sciex uniform / Shimadzu lattice): `mz = tof_index · (1/scale)`, run-wide —
 *    the Parquet transform's multiplier (`transform_params [1e-9]`), bit-identical to the
 *    reference reader; NOT `tof_index / scale` (1 ulp off on ~40 % of values).
 *  - **tof-grid** (sciex sqrt): `mz = (c0 + c1·tof_index)²` with PER-SPECTRUM `c0,c1`.
 *  - **agilent-grid** (sqrt + polynomial): `mz = (c0+c1·k)² − poly(clamp(t,left,right))`,
 *    `t = base + (c0+c1·k)/coeff`, with PER-SPECTRUM `c0,c1,calibration_id` selecting the
 *    calibration row; exact MassHunter m/z (mirrors `calibrated_mz` in agilent_profile.rs).
 * Per-spectrum values are read from the spectrum metadata columns by NAME SUFFIX
 * (`*_tof_c0` / `*_tof_c1` / `*_tof_calibration_id`) — the accession prefix drifts across
 * converter versions (MZP_1000003_tof_c0 → MS_4000900_tof_c0), so we match the suffix, not the
 * full name. Returns null when the file isn't a grid file OR this spectrum lacks coefficients.
 *
 * `facet` picks the index-block precedence (see {@link GridFacet}); it defaults to "centroid" so
 * the pre-facet call shape `resolveGridMz(reader, index)` keeps resolving exactly what it did for
 * every single-block file. The engine's read paths use {@link resolveFacetGridMz} to get both.
 */
export function resolveGridMz(reader: Reader, index: number, facet: GridFacet = "centroid"): GridMz | null {
  const g = gridCal(reader, facet);
  if (!g) return null;
  if (g.kind === "mz-grid") {
    // DIVIDE by the scale, never multiply by its reciprocal. `k / 1e9` and `k * 1e-9` disagree on
    // ~40 % of lattice values (measured: 80,150 of 200,000 random indices in the 70–1700 m/z range),
    // and division is the EXACT one: 1e9 is representable in IEEE-754 while 1e-9 is not, so `k / 1e9`
    // is correctly rounded to the true quotient whereas `k * 1e-9` carries the reciprocal's own error.
    // This is also what the archive documents (`mz_from_tof_index: "tof_index / scale"`) and what the
    // reference reader computes (mzpeak_prototyping reader/point.rs `k as f64 / scale`).
    // An earlier revision of this file multiplied, to match a reader that has since been corrected.
    const scale = g.scale;
    return (axis) => axis / scale;
  }
  if (g.kind === "tof-grid-global") { const { c0, c1 } = g; return (axis) => { const m = c0 + c1 * axis; return m * m; }; }
  const spectra = spectraStruct(reader);
  const c0 = spectrumNumBySuffix(spectra, "_tof_c0", index), c1 = spectrumNumBySuffix(spectra, "_tof_c1", index);
  if (c0 == null || c1 == null) return null;
  if (g.kind === "tof-grid") return (axis) => { const m = c0 + c1 * axis; return m * m; };
  // agilent-grid: select the calibration row for this spectrum, then mz = (c0+c1·k)² −
  // poly(clamp(t,left,right)) with t = base + (c0+c1·k)/coeff (= the Rust calibrated_mz).
  // `tof_calibration_id` is int64 → Arrow-JS yields a BigInt; coerce to the string map key.
  const idName = fieldBySuffix(spectra, "_tof_calibration_id");
  const idRaw = idName ? spectra?.getChild?.(idName)?.get?.(index) : null;
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

/** Both facet resolvers for spectrum `index` (what `reconstructSpectrum` consumes). */
export function resolveFacetGridMz(reader: Reader, index: number): GridResolvers {
  return { profile: resolveGridMz(reader, index, "profile"), centroid: resolveGridMz(reader, index, "centroid") };
}

/** Normalise the `gridMz` argument of `reconstructSpectrum`: a bare resolver applies to BOTH
 *  facets (the pre-facet call shape used by single-block files and the unit tests). */
function facetResolvers(g: GridMz | GridResolvers | null | undefined): GridResolvers {
  if (typeof g === "function") return { profile: g, centroid: g };
  return g ?? { profile: null, centroid: null };
}

// Standard centroid-object keys mzpeakts emits; any OTHER numeric key is the non-standard
// data array (the ims-compact `tof`, whose 1-word name packTableIntoPeaks can't suffix-strip).
const CENTROID_STD_KEYS = new Set(["mz", "intensity", "mean_inverse_reduced_ion_mobility"]);
function tofColumnKey(c: Record<string, unknown>): string | null {
  // Prefer the KNOWN integer-axis names (mzpeakts mangles the 1-word `tof`/`tof_index` to "")
  // before falling back to by-elimination, so an unrelated extra numeric centroid field can't be
  // mistaken for the axis.
  // An Int64 axis (the Shimadzu `mz-grid` lattice) arrives as a `bigint` property.
  const isAxis = (v: unknown): boolean => typeof v === "number" || typeof v === "bigint";
  for (const k of ["tof_index", "tof", ""]) if (k in c && isAxis(c[k])) return k;
  for (const k of Object.keys(c)) if (!CENTROID_STD_KEYS.has(k) && isAxis(c[k])) return k;
  return null;
}
/** A row's f64 `mz` that IS a usable value: a finite number > 0. Everything else is the null fill
 *  of a gridded row — absent (no `mz` column, e.g. SciEX mz-grid / ims-compact peaks), null, or
 *  the 0 mzpeakts materialises for a NULL f64 cell (Shimadzu: `mz` is the per-spectrum f64
 *  fallback column, null on lattice rows). The rule is PER ROW and the same on both facets:
 *  axis present AND `mz` unusable → the grid axis is authoritative; `mz` finite and > 0 → `mz`
 *  wins. The second half matters for a fallback f64 spectrum inside a lattice facet: mzpeakts
 *  drops a column that is all-null within the selected rows, so a whole-spectrum fallback most
 *  likely arrives with NO axis key at all, but a NULL Int64 cell that IS materialised comes back
 *  as `0n` — either shape reads `mz` and is never reconstructed from the zero. (The converter
 *  routes per spectrum, so the real archives are homogeneous per spectrum on both facets; the
 *  mixed shapes below are defensive.) */
const mzUsable = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const mzUnusable = (v: unknown): boolean => !mzUsable(v);

/** The raw spectrum record shape mzpeakts returns from getSpectrum(index). The centroid
 *  objects may carry extra promoted columns (e.g. ion mobility) beyond mz/intensity. */
export type RawSpectrum = {
  id: unknown;
  /** Axis arrays may be `BigInt64Array` (an Int64 `tof_index`); m/z + intensity are float arrays. */
  dataArrays?: Record<string, AxisLike> | undefined;
  /** Centroid objects may carry an integer axis (`tof_index` / `tof` — mzpeakts often mangles
   *  the 1-word name to "" — number OR bigint) in place of, or beside a null-filled (null / 0),
   *  `mz`: the axis is authoritative for such a row (see `readCentroids`). */
  centroids?: RawCentroid[] | undefined;
};
/** One mzpeakts centroid object (structurally compatible with its `PointLike`). `mz` is the f64
 *  column — absent / null / 0 on a gridded row, where the integer axis (`tof_index` / `tof`, or
 *  the mangled "" key mzpeakts emits for the 1-word name; number OR bigint) is authoritative.
 *  `tofColumnKey` locates the axis by name, falling back to any other integer-valued key. */
export type RawCentroid = {
  mz?: number | null;
  intensity: number;
  mean_inverse_reduced_ion_mobility?: number | null;
  tof_index?: number | bigint | null;
  tof?: number | bigint | null;
  ""?: number | bigint | null;
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
  /** Facet that actually supplied the arrays (omitted for genuinely-empty spectra). */
  sourceUsed?: "profile" | "centroid";
  /** The OTHER facet also holds a non-empty signal (dual-stored spectrum). */
  altAvailable?: boolean;
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
// The grid axis is AUTHORITATIVE whenever it is present and resolvable, even beside an `m/z array`:
// a facet that grids most spectra and keeps f64 m/z for the few that do not fit (the Shimadzu
// sqrt-grid profile facet) carries BOTH columns, and mzpeakts materialises the null-filled `mz` of
// a gridded row as a Float64Array of zeros. Gating on `!da[MZ_KEY]` read those zeros as the signal.
function hasGridData(s: RawSpectrum, gridMz: GridMz | null): boolean {
  const da = s.dataArrays;
  return !!(gridMz && da && da[GRID_AXIS_KEY] && da[INTENSITY_KEY]);
}
function hasCentroids(s: RawSpectrum): boolean {
  return !!(s.centroids && s.centroids.length > 0);
}

/**
 * LENGTH-CHECKED profile availability (adversarial-review finding: `hasDataArrays` tests
 * key presence only, and a present-but-0-length m/z array is the file's explicit "0 data
 * points" encoding — it must NOT count as an available signal for the dual-source toggle
 * or the forced-read fallback). Grid (`tof_index`) and ims-chunked (`tof`) axes count as
 * profile signal when non-empty and resolvable.
 */
function profileNonEmpty(s: RawSpectrum, cal: ImsCalibration | null, gridMz: GridMz | null): boolean {
  const da = s.dataArrays;
  if (!da) return false;
  const len = (a: AxisLike | undefined) => (a ? a.length : 0);
  if (len(da[MZ_KEY]) > 0 && len(da[INTENSITY_KEY]) > 0) return true;
  if (gridMz && len(da[GRID_AXIS_KEY]) > 0 && len(da[INTENSITY_KEY]) > 0) return true;
  if (cal?.tofEncoding === "m/z-chunked" && len(da[TOF_DATA_KEY]) > 0) return true;
  return false;
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
function readDataArrays(s: RawSpectrum, gridMz: GridMz | null, cal: ImsCalibration | null = null): RawSignal {
  const da = s.dataArrays!;
  // SciEX/Agilent grid: an integer `tof_index` replaces the `m/z array`; reconstruct m/z
  // per point through the resolved grid map (mz-grid: idx·(1/scale); tof-grid: (c0+c1·idx)²).
  if (da[GRID_AXIS_KEY]) {
    // Per-row rule (see `mzUsable`): the grid axis is authoritative for a row whose `mz` is the
    // null fill (absent / 0); a row carrying a real f64 `mz` (a fallback spectrum whose null
    // Int64 axis, when materialised at all, mzpeakts yields as 0n) keeps it. An axis with NO resolver maps a null-mz
    // row to NaN — dropped by sanitizePairs, fail-loud (EmptySpectrumError) when the whole
    // spectrum is like that — never the 0 null fill as m/z.
    const axis = da[GRID_AXIS_KEY]!, n = axis.length;
    const mzArr = da[MZ_KEY] as ArrayLike<number> | undefined;
    const mz = new Float64Array(n);
    // `axisNum`: an Int64 axis is a BigInt64Array — coerce before arithmetic (no implicit mixing).
    for (let i = 0; i < n; i++) {
      const f = mzArr ? mzArr[i] : undefined;
      mz[i] = mzUsable(f) ? f : gridMz ? gridMz(axisNum(axis[i])) : NaN;
    }
    return { mz, intensity: Float32Array.from(da[INTENSITY_KEY] as ArrayLike<number>) };
  }
  // ims-compact Layout B (m/z-chunked): the chunked facet carries a `tof` axis instead of an
  // `m/z array`; reconstruct mz = (a + b·tof)². PROVISIONAL — the `--ims-chunked` writer schema is
  // NOT yet frozen (IM-TOF handoff §6) and there is no real chunked file to verify against. This
  // ASSUMES mzpeakts' chunk reader has already applied the per-chunk TOF delta decode (via
  // chunk_encoding), so `tof` here is absolute; the engine does NOT repeat the per-chunk cumsum
  // (chunk boundaries aren't exposed in the flattened array). Confirm both assumptions — the `tof`
  // array name and the delta handling — against a real `--ims-chunked` file, then finalize.
  const tof = da[TOF_DATA_KEY];
  if (cal?.tofEncoding === "m/z-chunked" && tof && !da[MZ_KEY]) {
    const n = tof.length;
    const mz = new Float64Array(n);
    for (let i = 0; i < n; i++) mz[i] = mzFromTof(cal, axisNum(tof[i]));
    const mob = da[MOBILITY_DATA_KEY] as ArrayLike<number> | undefined;
    return { mz, intensity: Float32Array.from(da[INTENSITY_KEY] as ArrayLike<number>), ...(mob ? { mobility: mob } : {}) };
  }
  const mob = da[MOBILITY_DATA_KEY] as ArrayLike<number> | undefined;
  return {
    mz: Float64Array.from(da[MZ_KEY] as ArrayLike<number>),
    intensity: Float32Array.from(da[INTENSITY_KEY] as ArrayLike<number>),
    ...(mob ? { mobility: mob } : {}),
  };
}

/** Copy spectra_peaks (centroid) arrays into the canonical dtypes, plus per-peak ion mobility
 *  when present (timsTOF / IMS). When the peaks carry an integer axis instead of `mz` —
 *  ims-compact `tof` (reconstruct via `cal`) or a SciEX grid `tof_index` (via `gridMz`) — map
 *  every peak through the reconstructor. (SciEX SWATH stores its grid in the CENTROID facet.) */
function readCentroids(s: RawSpectrum, cal: ImsCalibration | null, gridMz: GridMz | null): RawSignal {
  const centroids = s.centroids!;
  const n = centroids.length;
  const mz = new Float64Array(n);
  const intensity = new Float32Array(n);
  const hasMobility = n > 0 && centroids[0]!["mean_inverse_reduced_ion_mobility"] != null;
  const mobility = hasMobility ? new Float64Array(n) : undefined;
  // Unusable `mz` (absent / null / the 0 of a null-filled fallback column) on ANY row → locate
  // the non-standard integer axis once, from the first such row (mzpeakts mangles the 1-word
  // `tof`/`tof_index` name, often to ""). Locating it from row 0 alone would read a gridded
  // row's null-fill 0 verbatim whenever a fallback row (real f64 `mz`) happens to come first —
  // the per-row rule below must not depend on row order. All-usable `mz` → no axis, verbatim.
  // gridMz (grid) takes precedence over cal (ims-compact). Values may be number OR bigint
  // (Int64 lattice) — every axis read goes through `axisNum` before arithmetic. The axis is
  // located even when NO resolver is available so such rows map to NaN (→ EmptySpectrumError
  // when the whole spectrum is like that) instead of reading the 0 null-fill as m/z.
  const firstGridded = centroids.findIndex((c) => mzUnusable(c["mz"]));
  const axisKey = firstGridded >= 0 ? tofColumnKey(centroids[firstGridded]!) : null;
  // The axis may sit under a key `tofColumnKey` found by elimination — read it by string key.
  const axisOf = (c: RawCentroid): number => axisNum((c as Record<string, unknown>)[axisKey!] as number | bigint | null | undefined);
  // ims-compact Layout A: `point.tof` is a per-mobility-scan delta. Reconstruct absolute TOF by
  // cumulative sum in STORED order, resetting at each scan boundary — detected by the 1/K0 value
  // changing (one stored f64 per scan, strictly monotonic across scans; the handoff's contract).
  // Needs mobility to find boundaries; without it (not expected for Layout A) we fall through to
  // absolute. gridMz (SciEX/Agilent) takes precedence and is never delta-decoded.
  const perScanDelta =
    axisKey !== null && !gridMz && cal?.tofEncoding === "per-scan-delta" && !!mobility;
  let acc = 0, prevMob = NaN;
  for (let i = 0; i < n; i++) {
    const c = centroids[i]!;
    // axisKey may be "" — test for null, not truthiness.
    if (axisKey === null) {
      mz[i] = axisNum(c["mz"]);
    } else if (gridMz) {
      // Grid axis is authoritative for a row whose `mz` is unusable (absent / null-fill 0); a row
      // carrying a real f64 `mz` (the per-spectrum fallback) keeps it. A null axis on a null-mz
      // row maps NaN → dropped by sanitizePairs (fail loud if the whole spectrum is like that).
      mz[i] = mzUnusable(c["mz"]) ? gridMz(axisOf(c)) : axisNum(c["mz"]);
    } else if (perScanDelta) {
      const m = axisNum(c["mean_inverse_reduced_ion_mobility"]);
      acc = m !== prevMob ? axisOf(c) : acc + axisOf(c); // absolute on scan start, else add delta
      prevMob = m;
      mz[i] = mzFromTof(cal!, acc);
    } else if (cal) {
      mz[i] = mzFromTof(cal, axisOf(c));
    } else {
      // An integer axis with NO resolver (a lattice/grid archive whose index blocks are missing
      // or malformed): never read the null-fill 0 as m/z — NaN drops the row, and an all-NaN
      // spectrum fails loud in reconstructSpectrum. A row with a real f64 `mz` keeps it.
      mz[i] = mzUnusable(c["mz"]) ? NaN : axisNum(c["mz"]);
    }
    intensity[i] = axisNum(c["intensity"]);
    if (mobility) mobility[i] = axisNum(c["mean_inverse_reduced_ion_mobility"]);
  }
  return mobility ? { mz, intensity, mobility } : { mz, intensity };
}

/** One facet's signal, reconstructed (pre-sanitize) — what {@link readFacetSignal} returns. */
export type FacetSignal = { mz: Float64Array; intensity: Float32Array; mobility?: ArrayLike<number> };

/**
 * Thrown by {@link readFacetSignal} when a facet carries an integer grid axis (`tof_index`) on
 * rows whose `mz` is the null fill but NO resolver is available for that facet (missing or
 * malformed index block, or a spectrum without its per-spectrum coefficients). Named so the raw
 * readers fail loud instead of returning the 0 null fill as m/z.
 */
export class UnresolvedGridAxisError extends Error {
  constructor(public readonly index: number, facet: GridFacet, rows: number) {
    super(`Spectrum ${index}: ${rows} ${facet} row(s) carry a grid axis (tof_index) with no resolvable ${facet} grid calibration`);
    this.name = "UnresolvedGridAxisError";
  }
}

/**
 * Read ONE facet of a raw mzpeakts spectrum record through the SAME codecs `reconstructSpectrum`
 * uses — the per-facet grid resolver (`resolveFacetGridMz`: Shimadzu Int64 lattice / SciEX sqrt /
 * Agilent poly, BigInt axes coerced) and the ims-compact `tof` calibration — WITHOUT the
 * representation routing, source fall-through or sanitizing. This is the shared reconstruction for
 * the non-engine readers (`reader/arrays harvestDataArraysOrNull`, `reader/explorer/browse
 * getSpectrumArrays`) which choose their own source order; it exists so nobody reads a gridded
 * row's `mz` (the 0 null fill) verbatim.
 *
 * Returns null when the facet holds no signal at all (no data arrays / no centroid rows). A
 * facet whose rows need a grid axis it cannot resolve throws {@link UnresolvedGridAxisError};
 * rows carrying a real f64 `mz` (a fallback spectrum) read it verbatim under either outcome.
 * Pass `grid`/`cal` from `resolveFacetGridMz(reader, index)` / `resolveImsCalibration(reader, index)`
 * (resolved once per spectrum) or use {@link readSpectrumFacet} to resolve them here.
 */
export function readFacetSignal(
  spectrum: RawSpectrum,
  index: number,
  facet: GridFacet,
  grid: GridResolvers,
  cal: ImsCalibration | null,
): FacetSignal | null {
  if (facet === "centroid") {
    if (!hasCentroids(spectrum)) return null;
    const sig = readCentroids(spectrum, cal, grid.centroid);
    // readCentroids maps a null-mz row whose axis has no resolver to NaN — count those rows so a
    // partially-unresolved spectrum fails loud, not just an all-NaN one.
    if (!grid.centroid && !cal) assertResolved(sig.mz, spectrum.centroids!.map((c) => c["mz"]), index, facet);
    return sig;
  }
  const da = spectrum.dataArrays;
  if (!da || !da[INTENSITY_KEY]) return null;
  const imsChunked = cal?.tofEncoding === "m/z-chunked" && !!da[TOF_DATA_KEY];
  if (!da[MZ_KEY] && !da[GRID_AXIS_KEY] && !imsChunked) return null;
  const sig = readDataArrays(spectrum, grid.profile, cal);
  if (da[GRID_AXIS_KEY] && !grid.profile) assertResolved(sig.mz, da[MZ_KEY] as ArrayLike<number> | undefined, index, facet);
  return sig;
}

/** Fail loud when an unresolved axis left NaN on rows whose own `mz` was unusable. */
function assertResolved(mz: Float64Array, raw: ArrayLike<unknown> | undefined, index: number, facet: GridFacet): void {
  let bad = 0;
  for (let i = 0; i < mz.length; i++) if (!Number.isFinite(mz[i]!) && mzUnusable(raw?.[i])) bad++;
  if (bad > 0) throw new UnresolvedGridAxisError(index, facet, bad);
}

/** {@link readFacetSignal} with the resolvers taken from `reader` for spectrum `index`. */
export function readSpectrumFacet(reader: Reader, index: number, spectrum: RawSpectrum, facet: GridFacet): FacetSignal | null {
  return readFacetSignal(spectrum, index, facet, resolveFacetGridMz(reader, index), resolveImsCalibration(reader, index));
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
  // A bare GridMz applies to BOTH facets (single-block files / unit tests); the engine passes
  // the per-facet pair from `resolveFacetGridMz` (a Shimadzu file grids the two facets differently).
  gridMz: GridMz | GridResolvers | null = null,
  // TRAILING on purpose (review: inserting mid-signature would silently re-bind the
  // existing positional cal/gridMz call sites).
  forceSource: "profile" | "centroid" | null = null,
): ReconstructedSpectrum {
  const grid = facetResolvers(gridMz);
  // A genuinely-EMPTY scan: mzpeakts emits a 0-length `m/z array` (the file's own "0 data
  // points" signal) and nothing else. Render it as an empty spectrum rather than throwing —
  // SciEX/Agilent runs interleave empty survey scans with data scans, so the default-open
  // spectrum is often empty. This is distinct from "no decodable arrays at all" (which still
  // throws below): here the file explicitly declares zero points.
  const da = spectrum.dataArrays;
  const mzArr = da?.[MZ_KEY];
  // ims-compact Layout B (m/z-chunked): the chunked facet's axis is `tof` (reconstructed via `cal`)
  // instead of an `m/z array` — count it as decodable data so we don't false-empty. PROVISIONAL (§6).
  const imsChunked = cal?.tofEncoding === "m/z-chunked" && !!da?.[TOF_DATA_KEY];
  // LENGTH-checked, not key-presence: an explicit zero-length profile row (a real
  // encoding) must fall through to the centroid facet below, not "win" the routing and
  // render an empty spectrum while centroids exist (adversarial review 2026-09-01).
  const daOk =
    (hasDataArrays(spectrum) && (mzArr?.length ?? 0) > 0) ||
    hasGridData(spectrum, grid.profile) ||
    imsChunked;
  // mzpeakts decoded this spectrum to NO signal at all: a present `dataArrays` carrying no
  // intensity, no integer axis, and no (or a 0-length) m/z, and no centroids. Render it empty
  // rather than throwing — survey/empty scans interleave with data scans (SciEX/Agilent). A
  // spectrum that DOES carry an axis (tof_index) but lacks a resolver still throws below
  // (fail-loud, not silent zeros), as does a truly absent `dataArrays` (undefined).
  const noSignal = !!da && !da[INTENSITY_KEY] && !da[GRID_AXIS_KEY] && (!mzArr || mzArr.length === 0);
  if (!daOk && !hasCentroids(spectrum) && noSignal) {
    // Genuinely empty: no source supplied bytes → sourceUsed omitted, altAvailable false.
    return { index, id: String(spectrum.id), mz: new Float64Array(0), intensity: new Float32Array(0), representation, altAvailable: false };
  }

  // Route by representation, but fall through to the other source when empty.
  // `representation` is reported as-is regardless of which source supplied bytes. ims-compact AND
  // SciEX grid can live in EITHER facet, so both readers take `cal`+`gridMz`.
  const profOk = profileNonEmpty(spectrum, cal, grid.profile);
  const centOk = hasCentroids(spectrum);
  const altAvailable = profOk && centOk;

  let raw: RawSignal;
  let sourceUsed: "profile" | "centroid";
  // A forced source is honoured only when that facet holds a NON-EMPTY signal; otherwise
  // fall through to auto routing and report the truthful sourceUsed (the UI shows what IS
  // displayed — a toggle onto an empty facet never throws and never lies).
  const want =
    forceSource === "centroid" && centOk ? "centroid"
    : forceSource === "profile" && profOk ? "profile"
    : representation === "centroid" ? "centroid"
    : "profile";
  if (want === "centroid") {
    if (hasCentroids(spectrum)) { raw = readCentroids(spectrum, cal, grid.centroid); sourceUsed = "centroid"; }
    else if (daOk) { raw = readDataArrays(spectrum, grid.profile, cal); sourceUsed = "profile"; }
    else throw new EmptySpectrumError(index);
  } else {
    // "profile" or null (unknown) → data-array default, centroid fall-through.
    if (daOk) { raw = readDataArrays(spectrum, grid.profile, cal); sourceUsed = "profile"; }
    else if (hasCentroids(spectrum)) { raw = readCentroids(spectrum, cal, grid.centroid); sourceUsed = "centroid"; }
    else throw new EmptySpectrumError(index);
  }

  // Carry mobility through the same drop-and-sort permutation, then dictionary-encode it
  // (a TIMS frame's ~10⁵ peaks share a few hundred 1/K0 bins — see MobilityCodec).
  const clean = sanitizePairs(raw.mz, raw.intensity, raw.mobility);
  // Fail loud, not silent-empty: NON-empty input that reconstructs to ZERO finite pairs means we
  // couldn't decode it (e.g. a centroid/grid axis we have no resolver for → all-NaN m/z).
  // Genuinely-empty inputs were already returned above; this is a real decode failure.
  if (clean.mz.length === 0 && raw.mz.length > 0) throw new EmptySpectrumError(index);
  return {
    index,
    id: String(spectrum.id),
    mz: clean.mz,
    intensity: clean.intensity,
    representation, // metadata value, preserved across any fallback
    sourceUsed,
    altAvailable,
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
  source: "profile" | "centroid" | null = null,
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

  const recon = reconstructSpectrum(spectrum, index, representation, resolveImsCalibration(reader, index), resolveFacetGridMz(reader, index), source);
  return adaptSpectrum({
    index: recon.index,
    id: recon.id,
    mz: recon.mz,
    intensity: recon.intensity,
    representation: recon.representation,
    ...(recon.sourceUsed ? { sourceUsed: recon.sourceUsed } : {}),
    ...(recon.altAvailable != null ? { altAvailable: recon.altAvailable } : {}),
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
  // Resolve nested OR flat column names via getCol — hardcoding the nested names made the
  // prefetch treat every flat-file spectrum as unknown-level/unknown-representation:
  // MS2 spectra were prefetched and centroid-declared spectra were cached from the
  // PROFILE facet with wrong provenance (adversarial-review P0 finding).
  return {
    n: sm?.length ?? 0,
    lvl: getCol<NonNullable<Col>>(spectra as never, "msLevel"),
    repr: getCol<NonNullable<Col>>(spectra as never, "representation"),
  };
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
    onRow?: (index: number, mz: ArrayLike<number>, cachedEntry: boolean) => void,
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
            // STALE-GENERATION GUARD AT THE WRITE: shouldStop() is also checked between
            // slices, but an open(B) queued on the same mutex clears this cache and bumps
            // the generation while a slice is parked — writing after that would put file
            // A's spectra into file B's LRU keyed only by index (adversarial-review
            // BLOCKER; the ion prefetch commit was gen-guarded, this one was not).
            if (control.shouldStop()) { done = true; return; }
            const doCache = accept(index);
            if (doCache) {
              // The spectrum-display prefetch streams full f64 m/z (default, no mzFloat32) for
              // display fidelity, so mz is a Float64Array here. sourceUsed/altAvailable are
              // stamped by the caller's onRow hook — prefetch entries MUST carry the same
              // provenance as cold reads, or a prefetch-warmed LRU hit hides the Signal
              // toggle on exactly the dual files it exists for (adversarial-review finding).
              // sanitizePairs mirrors the cold-read path (drop non-finite pairs, ascending
              // m/z) — warm hits must never serve rows the cold path would have cleaned.
              const clean = sanitizePairs(mz as Float64Array, intensity);
              cache.set(index, { mz: clean.mz, intensity: clean.intensity, msLevel: msLevelOf(index) });
              cached++;
            }
            onRow?.(index, mz, doCache);
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
  // Facet-provenance stamping: the data drain marks every non-empty profile index; the
  // peaks drain then (a) flips altAvailable on already-cached profile entries whose index
  // also appears with centroids, and (b) stamps centroid entries with altAvailable from
  // the profile-presence set. An early-stopped drain leaves later entries unstamped
  // (fields absent → Signal toggle hidden until a cold read) — honest degradation.
  const profileSeen = new Set<number>();
  const okData = await drain(
    streamSpectraDataArrays(reader),
    (i) => isMs01(i) && reprOf(i) !== "centroid",
    (i, mz, cachedEntry) => {
      if (mz.length > 0) profileSeen.add(i);
      if (cachedEntry) {
        const e = cache.get(i);
        if (e) e.sourceUsed = "profile";
      }
    },
  );
  if (!okData) return { cached, stopped: true };
  const okPeaks = await drain(
    streamSpectraPeaksArrays(reader),
    (i) => isMs01(i) && reprOf(i) === "centroid",
    (i, mz, cachedEntry) => {
      if (mz.length === 0) return;
      const e = cache.get(i);
      if (!e) return;
      if (cachedEntry) {
        e.sourceUsed = "centroid";
        e.altAvailable = profileSeen.has(i);
      } else if (e.sourceUsed === "profile") {
        e.altAvailable = true; // profile-cached entry whose index also has centroids
      }
    },
  );
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
  source: "profile" | "centroid" | null = null,
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

  // FORCED-SOURCE read (the Spectra view's Signal toggle). Poisoning-safe by design:
  //  - an LRU entry whose stamped sourceUsed matches the request is served (its arrays
  //    came from exactly that facet — no re-read needed, no lie possible);
  //  - otherwise a cold read with the forced source, NOT written to the LRU (a forced
  //    entry must never be served for a later auto request) and never via the ion fast
  //    path (it holds profile-stream arrays with no per-facet provenance).
  if (source) {
    const fhit = cache.get(index);
    if (fhit && fhit.sourceUsed === source) {
      return adaptSpectrum({
        index, id, mz: fhit.mz, intensity: fhit.intensity, representation,
        sourceUsed: fhit.sourceUsed,
        ...(fhit.altAvailable != null ? { altAvailable: fhit.altAvailable } : {}),
        ...(fhit.mobility ? { mobility: fhit.mobility } : {}),
      });
    }
    const spectrum = (await reader.getSpectrum(index)) as RawSpectrum | null;
    if (!spectrum) throw new Error(`No spectrum at index ${index}`);
    const recon = reconstructSpectrum(spectrum, index, representation, resolveImsCalibration(reader, index), resolveFacetGridMz(reader, index), source);
    return adaptSpectrum({
      index, id: recon.id, mz: recon.mz, intensity: recon.intensity, representation: recon.representation,
      ...(recon.sourceUsed ? { sourceUsed: recon.sourceUsed } : {}),
      ...(recon.altAvailable != null ? { altAvailable: recon.altAvailable } : {}),
      ...(recon.mobility ? { mobility: recon.mobility } : {}),
    });
  }

  const hit = cache.get(index);
  if (hit) {
    return adaptSpectrum({
      index, id, mz: hit.mz, intensity: hit.intensity, representation,
      ...(hit.sourceUsed ? { sourceUsed: hit.sourceUsed } : {}),
      ...(hit.altAvailable != null ? { altAvailable: hit.altAvailable } : {}),
      ...(hit.mobility ? { mobility: hit.mobility } : {}),
    });
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
  const recon = reconstructSpectrum(spectrum, index, representation, resolveImsCalibration(reader, index), resolveFacetGridMz(reader, index));
  // Cache the canonical decoded arrays + facet provenance (adaptSpectrum copies for the wire).
  cache.set(index, {
    mz: recon.mz, intensity: recon.intensity, msLevel,
    ...(recon.sourceUsed ? { sourceUsed: recon.sourceUsed } : {}),
    ...(recon.altAvailable != null ? { altAvailable: recon.altAvailable } : {}),
    ...(recon.mobility ? { mobility: recon.mobility } : {}),
  });
  return adaptSpectrum({
    index,
    id: recon.id,
    mz: recon.mz,
    intensity: recon.intensity,
    representation: recon.representation,
    ...(recon.sourceUsed ? { sourceUsed: recon.sourceUsed } : {}),
    ...(recon.altAvailable != null ? { altAvailable: recon.altAvailable } : {}),
    ...(recon.mobility ? { mobility: recon.mobility } : {}),
  });
}
