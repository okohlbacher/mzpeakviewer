// Engine: chromatogram extraction (TIC / XIC / XIC-range / stored). Dispatches on the
// wire ChromRequest mode, drives the harvested Explorer read paths (extractChromatogram
// for tic/xic, getStoredChromatogram for stored), unpacks the result into parallel
// time/intensity sequences, and repacks via the pure adapt/chrom.ts adapter.
//
// Reader I/O harvested from mzPeakExplorer (src/reader/explorer/browse.ts). The wire
// shaping is the pure adaptChromatogram adapter — this only chooses the read path and
// flattens the point array.
//
// Source choice + TIC semantics mirror the two read-only references:
//   - mzPeakExplorer/src/state/store.ts (runXic :475 useProfile, showTic/buildTic :507/:888)
//   - mzPeakIV/src/worker/mzPeakWorker.ts (:1458 majority-source pick `profile >= centroid`)
// Adversarial-review fixes:
//   F1 — never hard-code `useProfile: true`; pick profile vs peaks by the MAJORITY
//        representation so a centroid-only file reads spectra_peaks, not spectra_data.
//   F2 — `tic` mode prefers the per-spectrum (promoted) TIC from the scan rows, is
//        MS1-only, and only falls back to a whole-file extractXIC (also MS1-filtered).
import type { ChromRequest } from "@mzpeak/contracts";
import type { ChromatogramSeries, ChromatogramInfo } from "@mzpeak/contracts";
import { adaptChromatogram, type ChromInput } from "../adapt/chrom";
import { plainify } from "../reader/fileMeta";
import type { Reader } from "../reader/openUrl";
import {
  chromatogramIds,
  extractChromatogram,
  getStoredChromatogram,
} from "../reader/explorer/browse";
import type { ChromPoint, SpectrumIndexRow } from "../reader/explorer/types";
import { engineDiaXic } from "./dia";

/**
 * Optional precomputed context the dispatcher may pass through from a prior
 * `engineScanBreakdown` (the scan rows + representation counts). When present it lets
 * the TIC path build straight from the promoted per-spectrum TIC column (no signal
 * I/O) and lets the source pick honor the file's actual representation mix without a
 * re-scan. All fields are optional so a caller without a cached scan still works
 * (the chrom path then reads conservatively as profile, matching Explorer's default).
 */
export type ChromContext = {
  /** Per-spectrum scan rows (index/msLevel/time/tic/representation). */
  rows?: readonly SpectrumIndexRow[];
  /** Aggregate representation counts; drives the majority source pick. */
  representationCounts?: { profile: number; centroid: number; unknown?: number };
};

/** Spectra past this count are too expensive to sum in the browser for a TIC fallback
 *  (mirrors Explorer's AUTO_SCAN_LIMIT guard in buildTic). */
const AUTO_SCAN_LIMIT = 50_000;

// CV accessions for the chromatogram summary fields (promoted columns).
const CHROM_TYPE_ACC = "MS_1000626_chromatogram_type";
const POLARITY_ACC = "MS_1000465_scan_polarity";
const NPOINTS_ACC = "MS_1003060_number_of_data_points";

/** Finite number or null. */
function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Recursively find the first finite number under a key naming the accession `frag`
 *  (e.g. "1000827"). FALLBACK only — used when the reader's typed field is absent (m/z
 *  encoded as a promoted column rather than a typed Precursor/SelectedIon field). The
 *  match is ANCHORED to an accession boundary (`MS_<frag>_` / `_<frag>_`) so a future
 *  accession that merely embeds the digits can't win a bare-substring false positive. */
function findNumberByKeyFragment(node: unknown, frag: string, depth = 0): number | null {
  if (node == null || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const v of node) {
      const r = findNumberByKeyFragment(v, frag, depth + 1);
      if (r != null) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const named = k.startsWith(`MS_${frag}_`) || k.includes(`_${frag}_`) || k === `MS_${frag}`;
      if (named && typeof v === "number" && Number.isFinite(v)) return v;
      const r = findNumberByKeyFragment(v, frag, depth + 1);
      if (r != null) return r;
    }
  }
  return null;
}

/**
 * List the file's STORED chromatograms with summary fields + a full CV-resolvable
 * metadata tree (chromatogram CV params, precursor isolation window, product/selected
 * ion — i.e. SRM/MRM transitions). Reads the eagerly-loaded chromatogram metadata only;
 * no signal I/O. The summary fields drive the Chromatograms list; `meta` feeds the
 * CV-aware TreeView detail panel.
 */
export function engineChromatogramList(reader: Reader): ChromatogramInfo[] {
  const cm = reader.chromatogramMetadata;
  const n = cm?.length ?? 0;
  const out: ChromatogramInfo[] = [];
  for (let i = 0; i < n; i++) {
    const rec = cm!.get(i) as unknown as {
      id?: unknown; index?: unknown; params?: unknown;
      precursors?: { isolationWindow?: { target?: unknown } }[];
      selectedIons?: { mz?: unknown }[];
      meta?: unknown;
    };
    const meta = plainify({
      id: rec.id,
      index: rec.index,
      params: rec.params,
      precursors: rec.precursors,
      selectedIons: rec.selectedIons,
      promotedColumns: rec.meta,
    });
    const promoted = (rec.meta ?? {}) as Record<string, unknown>;
    const polRaw = promoted[POLARITY_ACC];
    const typeRaw = promoted[CHROM_TYPE_ACC];
    const nPtsRaw = promoted[NPOINTS_ACC];
    out.push({
      index: i,
      id: String(rec.id ?? i),
      typeAccession: typeof typeRaw === "string" ? typeRaw : null,
      polarity: polRaw === -1 ? "-" : polRaw === 1 ? "+" : null,
      nPoints:
        typeof nPtsRaw === "number" ? nPtsRaw : typeof nPtsRaw === "bigint" ? Number(nPtsRaw) : null,
      // Prefer the reader's typed fields (isolation-window target / selected-ion m/z);
      // fall back to the promoted-column accession search only when those are absent.
      precursorMz:
        finiteOrNull(rec.precursors?.[0]?.isolationWindow?.target) ??
        findNumberByKeyFragment(plainify(rec.precursors), "1000827"),
      productMz:
        finiteOrNull(rec.selectedIons?.[0]?.mz) ??
        findNumberByKeyFragment(plainify(rec.selectedIons), "1000744"),
      meta,
    });
  }
  return out;
}

/** Split a ChromPoint[] into parallel time/intensity arrays (index-aligned). */
function unpackPoints(points: ChromPoint[]): { time: number[]; intensity: number[] } {
  const n = points.length;
  const time = new Array<number>(n);
  const intensity = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    time[i] = p.time;
    intensity[i] = p.intensity;
  }
  return { time, intensity };
}

/**
 * F1 — choose the signal source (profile → spectra_data, peaks → spectra_peaks) by the
 * MAJORITY representation, exactly as IV's render path does (mzPeakWorker.ts:1458
 * `useProfile = profile >= centroid`). With no counts available default to profile —
 * the conservative Explorer default — rather than silently mis-routing a centroid file.
 */
function pickUseProfile(ctx?: ChromContext): boolean {
  const counts = ctx?.representationCounts;
  if (!counts) return true;
  return (counts.profile ?? 0) >= (counts.centroid ?? 0);
}

/** MS1 rows if any carry msLevel 1, else all rows (mirrors Explorer's `ticRows`). */
function ticRows(rows: readonly SpectrumIndexRow[]): SpectrumIndexRow[] {
  const ms1 = rows.filter((r) => r.msLevel === 1);
  return ms1.length > 0 ? ms1 : [...rows];
}

/**
 * F2 (cheap path) — build the TIC from the promoted per-spectrum TIC column already in
 * the scan rows (MS:1000285), MS1-only, no signal I/O. Mirrors Explorer's `cheapTic`:
 * returns null when ANY contributing row lacks a finite TIC (a real TIC would then need
 * a whole-file read). Optional `timeRange` is a post-filter (the column is metadata).
 */
function cheapTic(
  rows: readonly SpectrumIndexRow[],
  timeRange: [number, number] | null,
): ChromPoint[] | null {
  const use = ticRows(rows);
  if (use.length === 0) return null;
  if (!use.every((r) => r.tic != null && Number.isFinite(r.tic))) return null;
  const pts = use
    .map((r) => ({
      index: r.index,
      time: r.time ?? r.index,
      intensity: r.tic as number,
    }))
    .sort((a, b) => a.time - b.time);
  return timeRange
    ? pts.filter((p) => p.time >= timeRange[0] && p.time <= timeRange[1])
    : pts;
}

/**
 * F2 (full path) — TIC for `tic` mode. Prefer the cheap promoted-TIC column from the
 * scan rows; only fall back to a whole-file `extractXIC(null,null)` (then MS1-filtered)
 * when no promoted TIC exists, and refuse that fallback past AUTO_SCAN_LIMIT spectra
 * (mirrors Explorer's `buildTic`). The fallback's source is the majority representation
 * (F1). Returns null when the fallback is refused (caller surfaces the size guard).
 */
async function buildTic(
  reader: Reader,
  ctx: ChromContext | undefined,
  timeRange: [number, number] | null,
): Promise<ChromPoint[] | null> {
  const rows = ctx?.rows;
  if (rows && rows.length > 0) {
    const cheap = cheapTic(rows, timeRange);
    if (cheap) return cheap;
    if (rows.length > AUTO_SCAN_LIMIT) return null; // too expensive to sum
  }

  const useProfile = pickUseProfile(ctx);
  const all = await extractChromatogram(reader, {
    mz: null,
    tolDa: null,
    timeRange,
    useProfile,
  });
  // MS1-filter the summed trace when the scan rows tell us which spectra are MS1.
  if (rows && rows.length > 0) {
    const ms1 = new Set(rows.filter((r) => r.msLevel === 1).map((r) => r.index));
    if (ms1.size > 0) return all.filter((p) => ms1.has(p.index));
  }
  return all;
}

/**
 * Extract a chromatogram for the requested mode and repack into the wire
 * `ChromatogramSeries` (parallel Float32 time/intensity).
 *
 *  - `tic`      — total-ion chromatogram (MS1-only; prefers the promoted per-spectrum
 *                 TIC column, falls back to a whole-file summed read).
 *  - `xic`      — extracted-ion chromatogram over `mz ± tolDa`.
 *  - `xicRange` — extracted-ion chromatogram over `[mzLo, mzHi]` (center ± half-width).
 *  - `stored`   — a chromatogram the converter wrote, looked up by its native id.
 *
 * @param ctx Optional precomputed scan context (rows + representation counts). The
 *   dispatcher passes the cached `engineScanBreakdown` result so the TIC path can use
 *   the promoted-TIC column and the source pick can honor the representation mix.
 * @throws if a `stored` request names an id that is not present in the file.
 */
export async function engineExtractChrom(
  reader: Reader,
  req: ChromRequest,
  ctx?: ChromContext,
): Promise<ChromatogramSeries> {
  if (req.mode === "stored") {
    const match = chromatogramIds(reader).find((c) => c.id === req.id);
    if (!match) {
      throw new Error(`No stored chromatogram with id "${req.id}"`);
    }
    const stored = await getStoredChromatogram(reader, match.index);
    const input: ChromInput = {
      kind: "stored",
      id: req.id,
      time: stored?.time ?? new Float64Array(0),
      intensity: stored?.intensity ?? new Float32Array(0),
    };
    return adaptChromatogram(input);
  }

  if (req.mode === "diaXic") {
    return engineDiaXic(reader, req, ctx);
  }

  const rt = req.rt ?? null;

  if (req.mode === "tic") {
    const points = (await buildTic(reader, ctx, rt)) ?? [];
    const { time, intensity } = unpackPoints(points);
    return adaptChromatogram({ kind: "tic", id: null, time, intensity });
  }

  let mz: number;
  let tolDa: number;
  if (req.mode === "xic") {
    mz = req.mz;
    tolDa = req.tolDa;
  } else {
    // xicRange — convert [mzLo, mzHi] to center ± half-width for extractChromatogram.
    mz = (req.mzLo + req.mzHi) / 2;
    tolDa = (req.mzHi - req.mzLo) / 2;
  }

  const points = await extractChromatogram(reader, {
    mz,
    tolDa,
    timeRange: rt,
    useProfile: pickUseProfile(ctx),
  });
  const { time, intensity } = unpackPoints(points);
  return adaptChromatogram({ kind: "xic", id: null, time, intensity });
}
