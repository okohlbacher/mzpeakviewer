// HARVESTED (trimmed) from mzPeakExplorer/src/reader/browse.ts (read-only source).
// Signal access for the Browse tab: XIC extraction and stored-chromatogram access.
// All return plain typed arrays / POJOs — no Arrow, no bigint upward.
//
// Trimmed vs. upstream: getSpectrumMetadata (plainify dep) and getSpectrumArrays
// (single-spectrum reconstruction, owned by another module) are dropped — the LC
// chromatogram slice only needs the XIC / stored-chrom read paths.
import type { Reader } from "./open";
import type { ChromPoint, StoredChromatogram } from "./types";

const INTENSITY_KEY = "intensity array";
const TIME_KEY = "time array";

/**
 * Drop non-finite (x, y) pairs and guarantee ascending x — downstream plotting,
 * binary-search hover, and zoom clamp all assume sorted finite x-values. Fast
 * path: when the input is already finite + sorted + equal-length (the normal
 * case for real data), the inputs are returned unchanged with no copy.
 */
function sanitizePairs(
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
