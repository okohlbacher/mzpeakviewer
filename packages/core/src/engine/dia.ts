// Engine: DIA (data-independent acquisition) extracted-fragment chromatograms.
//
// A DIA run cycles MS1 → a fixed set of wide MS2 isolation windows → repeat. To extract
// a fragment chromatogram for a peptide precursor we must (a) find the isolation window
// that contains the precursor m/z and (b) sum the fragment m/z over ONLY the MS2 spectra
// of that window (summing across all MS2 would fold in fragments co-produced in other
// windows). This is the engine half of manual fragment-transition extraction.
//
// Window membership comes from the per-MS2-spectrum precursor isolation window
// (MS:1000827 target / MS:1000828 lower offset / MS:1000829 upper offset), read from the
// IN-MEMORY spectrum metadata (no signal I/O). The window→indices map is built once per
// file and cached (WeakMap by reader). MS-level is read columnar (the makeMs1Only path).
//
// PERF: building the map reads metadata for every MS2 spectrum once (cached thereafter).
// For a large DIA run that's a one-time cost on first extraction. A columnar precursor
// read would be faster; deferred until measured to matter.
import type { ChromatogramSeries } from "@mzpeak/contracts";
import { adaptChromatogram } from "../adapt/chrom";
import { extractChromatogram } from "../reader/explorer/browse";
import type { Reader } from "../reader/openUrl";
import type { ChromContext } from "./chrom";

const MSLEVEL_COL = "MS_1000511_ms_level";
const IW_TARGET = "MS_1000827_isolation_window_target_mz";
const IW_LOWER = "MS_1000828_isolation_window_lower_offset";
const IW_UPPER = "MS_1000829_isolation_window_upper_offset";

/** A distinct DIA isolation window + the absolute indices of its MS2 spectra. */
export type DiaWindow = {
  /** Lower / upper m/z bound of the isolation window (target ∓ offset). */
  lo: number;
  hi: number;
  /** Isolation target m/z (window center as recorded). */
  target: number;
  /** hi − lo. */
  width: number;
  /** Absolute spectrum indices acquired in this window, ascending. */
  indices: number[];
};

/** Per-MS2 isolation-window record before grouping. */
export type WindowRecord = { index: number; target: number; lower: number; upper: number };

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  return null;
}

/**
 * Group per-spectrum window records into the distinct DIA windows. Pure (no reader) so
 * it is unit-testable. Windows are keyed by their (lo, hi) bounds rounded to 4 decimals
 * so floating jitter doesn't split one window into many; indices stay ascending because
 * the records are visited in ascending index order. When the lower/upper offsets are
 * absent (some converters omit them) the half-width is inferred from the median spacing
 * of distinct targets so the windows still tile.
 */
export function groupWindows(records: WindowRecord[]): DiaWindow[] {
  if (records.length === 0) return [];
  const haveOffsets = records.every((r) => r.lower > 0 || r.upper > 0);
  let halfFallback = 0;
  if (!haveOffsets) {
    const targets = [...new Set(records.map((r) => r.target))].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < targets.length; i++) gaps.push(targets[i]! - targets[i - 1]!);
    gaps.sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 0;
    halfFallback = median / 2;
  }
  const byKey = new Map<string, DiaWindow>();
  for (const r of records) {
    const lo = r.target - (r.lower > 0 ? r.lower : halfFallback);
    const hi = r.target + (r.upper > 0 ? r.upper : halfFallback);
    const key = `${lo.toFixed(4)}:${hi.toFixed(4)}`;
    let win = byKey.get(key);
    if (!win) {
      win = { lo, hi, target: r.target, width: hi - lo, indices: [] };
      byKey.set(key, win);
    }
    win.indices.push(r.index);
  }
  return [...byKey.values()].sort((a, b) => a.lo - b.lo);
}

/** The window(s) whose [lo, hi] contains the precursor m/z (≥1 with overlapping schemes). */
export function windowsForPrecursor(windows: DiaWindow[], precursorMz: number): DiaWindow[] {
  return windows.filter((w) => precursorMz >= w.lo && precursorMz <= w.hi);
}

/** Read the isolation window for spectrum `index` from in-memory metadata, or null. */
function readWindow(reader: Reader, index: number): WindowRecord | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec = (reader.spectrumMetadata as any)?.get?.(index);
  const prec = rec?.precursors?.[0];
  const iw = prec?.isolation_window ?? prec?.isolationWindow;
  if (!iw) return null;
  const target = num(iw[IW_TARGET] ?? iw.target);
  if (target == null) return null;
  const lower = num(iw[IW_LOWER] ?? iw.lowerOffset) ?? 0;
  const upper = num(iw[IW_UPPER] ?? iw.upperOffset) ?? 0;
  return { index, target, lower, upper };
}

const windowMapCache = new WeakMap<object, DiaWindow[]>();

/**
 * Build (and cache) the DIA window map: the distinct isolation windows + the MS2 spectra
 * acquired in each. MS-level is read columnar; isolation windows from the in-memory
 * precursor metadata. Cached per reader so repeated extractions (one per transition) pay
 * the build cost once. Returns an empty list for a non-DIA / windowless file.
 */
export function buildDiaWindowMap(reader: Reader): DiaWindow[] {
  const cached = windowMapCache.get(reader as object);
  if (cached) return cached;
  const sm = reader.spectrumMetadata;
  const n = sm?.length ?? 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msCol = (sm as any)?.spectra?.getChild?.(MSLEVEL_COL) ?? null;
  const records: WindowRecord[] = [];
  for (let i = 0; i < n; i++) {
    const lvl = num(msCol?.get?.(i));
    // DIA fragment windows are the MS2 (>=2) spectra; MS1 survey scans carry no window.
    if (lvl == null || lvl < 2) continue;
    const w = readWindow(reader, i);
    if (w) records.push(w);
  }
  const windows = groupWindows(records);
  windowMapCache.set(reader as object, windows);
  return windows;
}

/**
 * Extract a single fragment-ion chromatogram for a DIA precursor: sum `mz ± tolDa` over
 * the MS2 spectra whose isolation window contains `precursorMz`, vs retention time. The
 * caller (Chromatograms view) issues one request per transition and overlays the result.
 *
 * Returns an empty `xic` series when no isolation window contains the precursor (e.g. a
 * non-DIA file, or a precursor outside the acquired m/z range) — the view shows "no
 * window" rather than a misleading whole-file sum.
 */
export async function engineDiaXic(
  reader: Reader,
  req: { precursorMz: number; mz: number; tolDa: number; rt?: [number, number] },
  ctx?: ChromContext,
): Promise<ChromatogramSeries> {
  const windows = buildDiaWindowMap(reader);
  const matched = windowsForPrecursor(windows, req.precursorMz);
  if (matched.length === 0) {
    return adaptChromatogram({ kind: "xic", id: null, time: [], intensity: [] });
  }
  // Union of member indices across all matching windows (overlapping/staggered schemes).
  const members = new Set<number>();
  for (const w of matched) for (const i of w.indices) members.add(i);

  const counts = ctx?.representationCounts;
  const useProfile = counts ? (counts.profile ?? 0) >= (counts.centroid ?? 0) : true;
  const points = await extractChromatogram(reader, {
    mz: req.mz,
    tolDa: req.tolDa,
    timeRange: req.rt ?? null,
    useProfile,
  });
  const time: number[] = [];
  const intensity: number[] = [];
  for (const p of points) {
    if (!members.has(p.index)) continue;
    time.push(p.time);
    intensity.push(p.intensity);
  }
  return adaptChromatogram({ kind: "xic", id: null, time, intensity });
}
