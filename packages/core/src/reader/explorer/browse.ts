// Signal access for the Browse tab: single-spectrum reconstruction, XIC extraction,
// and stored-chromatogram access. All return plain typed arrays / POJOs — no Arrow,
// no bigint upward.
//
// `getSpectrumArrays` is the golden REFERENCE the engine's reconstruction is
// asserted value-equal against (engine/imaging.golden.test) — the reference
// SOURCE ORDER (profile → centroids → profile) the engine must reproduce byte-for-byte.
// The per-row decode of each facet is shared with the engine (`engine/spectrum
// readFacetSignal`): a grid-encoded facet stores its m/z as an integer axis beside a
// null-filled `mz` (read back as 0), so the codec — not the verbatim `mz` — is the truth.
import type { Reader } from "./open";
import { recRepresentation } from "./cv";
import type { ChromPoint, SpectrumArrays, StoredChromatogram } from "./types";
import { assertNoGridAxis } from "../arrays";
import { readFacetSignal, readImsCalibration, resolveFacetGridMz, type RawSpectrum as EngineRawSpectrum } from "../../engine/spectrum";

const MZ_KEY = "m/z array";
const INTENSITY_KEY = "intensity array";
const TIME_KEY = "time array";

/**
 * Drop non-finite (x, y) pairs and guarantee ascending x — downstream plotting,
 * binary-search hover, and zoom clamp all assume sorted finite x-values. Fast
 * path: when the input is already finite + sorted + equal-length (the normal
 * case for real data), the inputs are returned unchanged with no copy.
 */
export function sanitizePairs(
  x: Float64Array,
  y: Float32Array,
): { x: Float64Array; y: Float32Array } {
  const n = Math.min(x.length, y.length);
  let clean = x.length === y.length;
  for (let i = 0; i < n && clean; i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || (i > 0 && xi < x[i - 1]!)) {
      clean = false;
    }
  }
  if (clean) return { x, y };

  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(x[i]!) && Number.isFinite(y[i]!)) idx.push(i);
  }
  idx.sort((a, b) => x[a]! - x[b]!);
  const nx = new Float64Array(idx.length);
  const ny = new Float32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    const j = idx[i]!;
    nx[i] = x[j]!;
    ny[i] = y[j]!;
  }
  return { x: nx, y: ny };
}

type RawSpectrum = EngineRawSpectrum & {
  msLevel?: number | null;
  time?: number | null;
  meta?: unknown;
  isProfile?: boolean;
};

/**
 * Read + reconstruct spectrum `index` into plain typed arrays — the golden parity
 * reference reconstruction for the engine. Prefers the profile data-array source,
 * falls back to centroids (spectra_peaks), then to data-arrays again, sanitizing
 * the result. Each facet is decoded through the engine's `readFacetSignal` (per-facet
 * grid resolver + ims-compact calibration, BigInt axes coerced), so a grid-encoded facet
 * yields reconstructed m/z here exactly as in the Spectra view; a grid axis with no
 * resolver fails loud (`assertNoGridAxis` / `UnresolvedGridAxisError`), never zeros.
 */
export async function getSpectrumArrays(
  reader: Reader,
  index: number,
): Promise<SpectrumArrays> {
  const spectrum = (await reader.getSpectrum(index)) as RawSpectrum | null;
  if (!spectrum) throw new Error(`No spectrum at index ${index}`);

  const id = String(spectrum.id);
  const representation = recRepresentation(spectrum);
  const time =
    typeof spectrum.time === "number" && Number.isFinite(spectrum.time)
      ? spectrum.time
      : null;
  const msLevel =
    typeof spectrum.msLevel === "number" ? spectrum.msLevel : null;

  // Resolve the per-facet grid / ims-compact codecs once; with NO resolver at all a grid axis is
  // unreadable — fail loud up front (the per-facet reader fails loud for the partial case).
  const grid = resolveFacetGridMz(reader, index);
  const cal = readImsCalibration(reader);
  if (!grid.profile && !grid.centroid && !cal) assertNoGridAxis(spectrum, index);
  // Prefer the profile data-array source; fall back to centroids (spectra_peaks), then to the
  // data arrays again for a centroid-declared spectrum whose peaks facet is empty.
  const sig =
    (representation !== "centroid" ? readFacetSignal(spectrum, index, "profile", grid, cal) : null) ??
    readFacetSignal(spectrum, index, "centroid", grid, cal) ??
    readFacetSignal(spectrum, index, "profile", grid, cal);
  if (!sig) throw new Error(`Spectrum ${index} has no reconstructable m/z + intensity arrays`);

  // Defensively drop non-finite points and enforce ascending m/z; a length mismatch
  // is reconciled here too.
  const clean = sanitizePairs(sig.mz, sig.intensity);
  return { index, id, msLevel, representation, time, mz: clean.x, intensity: clean.y };
}

type XicPoint = {
  index: bigint | number;
  time: number | null;
  /** The integer grid axis of a grid-encoded facet is `Int32Array` or (Int64) `BigInt64Array`. */
  dataArrays: Record<string, ArrayLike<number> | ArrayLike<bigint> | ArrayLike<string> | undefined>;
};

/** Per-spectrum integer-axis → m/z map for a grid-encoded facet (engine/spectrum `GridMz`),
 *  or null when that spectrum's axis is unresolvable (e.g. missing per-spectrum coefficients). */
export type XicGridResolver = (spectrumIndex: number) => ((axis: number) => number) | null;

// mzpeakts array_name of the integer grid axis (`tof_index`, MS:1000519) as packTableIntoDataArrays
// keys it in the bulk XIC stream (same key as in getSpectrum's dataArrays).
const GRID_AXIS_KEY = "tof_index";
const axisNum = (v: unknown): number =>
  typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : NaN;

/**
 * Sum the in-window intensity of ONE grid-facet spectrum read WITHOUT the reader's m/z slice:
 * the m/z of each row is the grid map of its integer axis (authoritative whenever the row's f64
 * `mz` is the null-fill 0 / absent), else the row's real f64 `mz` (the per-spectrum fallback
 * column). Returns null when no row falls inside the window — mirroring the reader's own
 * `betweenSorted` slice, which yields NO point for such a spectrum — and also when the rows
 * are unmappable (an axis with no resolver): a gap, never a false zero.
 */
function sumGridWindow(p: XicPoint, lo: number, hi: number, resolve: ((axis: number) => number) | null): number | null {
  const da = p.dataArrays;
  const inten = da[INTENSITY_KEY] as ArrayLike<number> | undefined;
  const axis = da[GRID_AXIS_KEY] as ArrayLike<number | bigint> | undefined;
  const mzArr = da[MZ_KEY] as ArrayLike<number> | undefined;
  if (!inten || (!axis && !mzArr)) return null;
  let sum = 0, hit = false;
  for (let i = 0; i < inten.length; i++) {
    const f = mzArr ? axisNum(mzArr[i]) : NaN;
    const m = axis && resolve && (f === 0 || !Number.isFinite(f)) ? resolve(axisNum(axis[i])) : f;
    if (!Number.isFinite(m) || m < lo || m > hi) continue;
    hit = true;
    const v = inten[i];
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return hit ? sum : null;
}

/**
 * Extract an ion chromatogram: for each spectrum in the (optional) time range,
 * sum the intensity within the (optional) m/z window. With both ranges null this
 * is the total-ion chromatogram. `useProfile` routes to spectra_data vs
 * spectra_peaks.
 *
 * `gridMz` (engine/chrom `gridXicResolver`) marks the facet being read as GRID-ENCODED
 * (SciEX/Agilent/Shimadzu `tof_index`): the reader's own m/z slice keys on the facet's
 * sorting column `mz`, which such a facet either lacks or null-fills (mzpeakts then throws
 * "Could not find … in Schema" or slices nothing), so the m/z window is instead applied here,
 * per row, on the reconstructed axis. Point-layout facets read the same bytes either way (the
 * reader's slice is post-read); a TIC (no window) is unaffected.
 */
export async function extractChromatogram(
  reader: Reader,
  opts: {
    mz?: number | null;
    tolDa?: number | null;
    timeRange?: [number, number] | null;
    useProfile?: boolean;
    gridMz?: XicGridResolver | null;
  } = {},
): Promise<ChromPoint[]> {
  const { mz = null, tolDa = null, timeRange = null, useProfile = true, gridMz = null } = opts;
  const mzRange =
    mz != null && tolDa != null
      ? { start: mz - tolDa, end: mz + tolDa }
      : null;
  // App-side RT is SECONDS; the file's time column is MINUTES (mzPeak/mzML scan-start-time
  // convention, unit UO:0000031 — same convention the wavelength path converts). The reader
  // compares against raw file values, so the window converts s→min going in and every point
  // converts min→s coming out. This is the ONE boundary where MS times enter the app.
  const tRange =
    timeRange != null ? { start: timeRange[0] / 60, end: timeRange[1] / 60 } : null;

  // Grid facet + m/z window: collect every row (null range) and window on the grid axis here.
  const gridWindow = mzRange && gridMz ? mzRange : null;
  const xic = await reader.extractXIC(tRange, gridWindow ? null : mzRange, useProfile);
  if (!xic) return [];

  const out: ChromPoint[] = [];
  for (const p of xic.points as XicPoint[]) {
    let sum = 0;
    if (gridWindow) {
      const s = sumGridWindow(p, gridWindow.start, gridWindow.end, gridMz!(Number(p.index)));
      if (s === null) continue; // nothing in the window (or unmappable) → no point, as the reader's slice does
      sum = s;
    } else {
      const arr = p.dataArrays[INTENSITY_KEY];
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i];
          if (typeof v === "number" && Number.isFinite(v)) sum += v;
        }
      }
    }
    out.push({
      index: Number(p.index),
      // minutes → seconds (see tRange note above); index fallback stays unitless.
      time: typeof p.time === "number" ? p.time * 60 : Number(p.index),
      intensity: sum,
    });
  }
  out.sort((a, b) => a.time - b.time);
  // Always enforce the RT window locally with inclusive bounds: the reader's
  // time→index range can over-include the first point past `end`, and an out-of-
  // run window resolves to a null range (= the whole run) — both would otherwise
  // leak points outside the requested window.
  return timeRange
    ? out.filter((p) => p.time >= timeRange[0] && p.time <= timeRange[1])
    : out;
}

/** List + read stored chromatograms (e.g. the TIC the converter wrote). */
export async function getStoredChromatogram(
  reader: Reader,
  index: number,
): Promise<StoredChromatogram | null> {
  const chrom = (await reader.getChromatogram(index)) as
    | { id: unknown; dataArrays?: Record<string, ArrayLike<number>> }
    | null
    | undefined;
  if (!chrom || !chrom.dataArrays) return null;
  const da = chrom.dataArrays;
  const t = da[TIME_KEY];
  const inten = da[INTENSITY_KEY];
  if (!t || !inten) return null;
  // Drop non-finite pairs and sort by time (clicking maps time → nearest spectrum).
  const clean = sanitizePairs(Float64Array.from(t), Float32Array.from(inten));
  // Stored chromatogram time axis is file MINUTES → wire SECONDS (wire.ts contract).
  const timeSec = clean.x.map((v) => v * 60);
  return { index, id: String(chrom.id), time: timeSec, intensity: clean.y };
}

export function chromatogramIds(reader: Reader): { index: number; id: string }[] {
  const cm = reader.chromatogramMetadata;
  const n = cm?.length ?? 0;
  const out: { index: number; id: string }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ index: i, id: String(cm!.get(i).id) });
  }
  return out;
}
