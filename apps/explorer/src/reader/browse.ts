// Navigation + signal access for the Browse tab: a lightweight per-spectrum
// index, single-spectrum reconstruction, XIC extraction, and stored-chromatogram
// access. All return plain typed arrays / POJOs — no Arrow, no bigint upward.
import type { Reader } from "./open";
import { recRepresentation } from "./cv";
import { plainify } from "./plainify";
import type {
  ChromPoint,
  SpectrumArrays,
  StoredChromatogram,
} from "./types";

const MZ_KEY = "m/z array";
const INTENSITY_KEY = "intensity array";
const TIME_KEY = "time array";

/**
 * Drop non-finite (x, y) pairs and guarantee ascending x — the plot, the
 * binary-search hover, and the zoom clamp all assume sorted finite x-values
 * (CODEX-REVIEW browse). Fast path: when the input is already finite + sorted +
 * equal-length (the normal case for real data), the inputs are returned
 * unchanged with no copy.
 */
function sanitizePairs(
  x: Float64Array,
  y: Float32Array,
): { x: Float64Array; y: Float32Array } {
  const n = Math.min(x.length, y.length);
  let clean = x.length === y.length;
  for (let i = 0; i < n && clean; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i]) || (i > 0 && x[i] < x[i - 1])) {
      clean = false;
    }
  }
  if (clean) return { x, y };

  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) idx.push(i);
  }
  idx.sort((a, b) => x[a] - x[b]);
  const nx = new Float64Array(idx.length);
  const ny = new Float32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    nx[i] = x[idx[i]];
    ny[i] = y[idx[i]];
  }
  return { x: nx, y: ny };
}

/**
 * Full per-spectrum metadata for the selected spectrum, plainified for the
 * Metadata tree (CV params, scans + scan windows, precursors, and the promoted
 * column bag). Metadata-only — reads the already-loaded spectrum metadata table,
 * no signal I/O.
 */
export function getSpectrumMetadata(reader: Reader, index: number): unknown {
  const sm = reader.spectrumMetadata;
  if (!sm) return null;
  const rec = sm.get(index) as unknown as {
    id?: unknown;
    msLevel?: unknown;
    time?: unknown;
    parameters?: unknown;
    params?: unknown;
    scans?: unknown;
    precursors?: unknown;
    meta?: unknown;
  };
  return plainify({
    index,
    id: rec.id,
    msLevel: rec.msLevel,
    representation: recRepresentation(rec),
    time: rec.time,
    parameters: rec.parameters ?? rec.params,
    scans: rec.scans,
    precursors: rec.precursors,
    promotedColumns: rec.meta,
  });
}

type RawSpectrum = {
  id: unknown;
  msLevel?: number | null;
  time?: number | null;
  meta?: unknown;
  isProfile?: boolean;
  dataArrays?: Record<string, ArrayLike<number>> | undefined;
  centroids?: { mz: number; intensity: number }[] | undefined;
};

/** Read + reconstruct spectrum `index` into plain typed arrays. */
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

  let mz: Float64Array;
  let intensity: Float32Array;

  const da = spectrum.dataArrays;
  const centroids = spectrum.centroids;
  // Prefer the profile data-array source; fall back to centroids (spectra_peaks).
  if (representation !== "centroid" && da && da[MZ_KEY] && da[INTENSITY_KEY]) {
    mz = Float64Array.from(da[MZ_KEY]);
    intensity = Float32Array.from(da[INTENSITY_KEY]);
  } else if (centroids && centroids.length > 0) {
    const k = centroids.length;
    mz = new Float64Array(k);
    intensity = new Float32Array(k);
    for (let i = 0; i < k; i++) {
      mz[i] = centroids[i].mz;
      intensity[i] = centroids[i].intensity;
    }
  } else if (da && da[MZ_KEY] && da[INTENSITY_KEY]) {
    mz = Float64Array.from(da[MZ_KEY]);
    intensity = Float32Array.from(da[INTENSITY_KEY]);
  } else {
    throw new Error(`Spectrum ${index} has no reconstructable m/z + intensity arrays`);
  }

  // Defensively drop non-finite points and enforce ascending m/z (the plot +
  // hover binary-search assume it); a length mismatch is reconciled here too.
  const clean = sanitizePairs(mz, intensity);
  return { index, id, msLevel, representation, time, mz: clean.x, intensity: clean.y };
}

type XicPoint = {
  index: bigint | number;
  time: number | null;
  dataArrays: Record<string, ArrayLike<number> | ArrayLike<string> | undefined>;
};

/**
 * Extract an ion chromatogram: for each spectrum in the (optional) time range,
 * sum the intensity within the (optional) m/z window. With both ranges null this
 * is the total-ion chromatogram. `useProfile` routes to spectra_data vs
 * spectra_peaks.
 */
export async function extractChromatogram(
  reader: Reader,
  opts: {
    mz?: number | null;
    tolDa?: number | null;
    timeRange?: [number, number] | null;
    useProfile?: boolean;
  } = {},
): Promise<ChromPoint[]> {
  const { mz = null, tolDa = null, timeRange = null, useProfile = true } = opts;
  const mzRange =
    mz != null && tolDa != null
      ? { start: mz - tolDa, end: mz + tolDa }
      : null;
  const tRange =
    timeRange != null ? { start: timeRange[0], end: timeRange[1] } : null;

  const xic = await reader.extractXIC(tRange, mzRange, useProfile);
  if (!xic) return [];

  const out: ChromPoint[] = [];
  for (const p of xic.points as XicPoint[]) {
    const arr = p.dataArrays[INTENSITY_KEY];
    let sum = 0;
    if (arr) {
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (typeof v === "number" && Number.isFinite(v)) sum += v;
      }
    }
    out.push({
      index: Number(p.index),
      time: typeof p.time === "number" ? p.time : Number(p.index),
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
  return { index, id: String(chrom.id), time: clean.x, intensity: clean.y };
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
