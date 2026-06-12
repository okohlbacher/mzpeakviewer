// Engine: chromatogram extraction (TIC / XIC / XIC-range / stored). Dispatches on the
// wire ChromRequest mode, drives the harvested Explorer read paths (extractChromatogram
// for tic/xic, getStoredChromatogram for stored), unpacks the result into parallel
// time/intensity sequences, and repacks via the pure adapt/chrom.ts adapter.
//
// Reader I/O harvested from mzPeakExplorer (src/reader/explorer/browse.ts). The wire
// shaping is the pure adaptChromatogram adapter — this only chooses the read path and
// flattens the point array.
import type { ChromRequest } from "@mzpeak/contracts";
import type { ChromatogramSeries } from "@mzpeak/contracts";
import { adaptChromatogram, type ChromInput } from "../adapt/chrom";
import type { Reader } from "../reader/explorer/open";
import {
  chromatogramIds,
  extractChromatogram,
  getStoredChromatogram,
} from "../reader/explorer/browse";
import type { ChromPoint } from "../reader/explorer/types";

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
 * Extract a chromatogram for the requested mode and repack into the wire
 * `ChromatogramSeries` (parallel Float32 time/intensity).
 *
 *  - `tic`      — total-ion chromatogram (no m/z window; intensity = per-spectrum TIC).
 *  - `xic`      — extracted-ion chromatogram over `mz ± tolDa`.
 *  - `xicRange` — extracted-ion chromatogram over `[mzLo, mzHi]` (center ± half-width).
 *  - `stored`   — a chromatogram the converter wrote, looked up by its native id.
 *
 * @throws if a `stored` request names an id that is not present in the file.
 */
export async function engineExtractChrom(
  reader: Reader,
  req: ChromRequest,
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

  const rt = req.rt ?? null;
  let kind: "tic" | "xic";
  let mz: number | null = null;
  let tolDa: number | null = null;

  if (req.mode === "tic") {
    kind = "tic";
  } else if (req.mode === "xic") {
    kind = "xic";
    mz = req.mz;
    tolDa = req.tolDa;
  } else {
    // xicRange — convert [mzLo, mzHi] to center ± half-width for extractChromatogram.
    kind = "xic";
    mz = (req.mzLo + req.mzHi) / 2;
    tolDa = (req.mzHi - req.mzLo) / 2;
  }

  const points = await extractChromatogram(reader, {
    mz,
    tolDa,
    timeRange: rt,
    useProfile: true,
  });
  const { time, intensity } = unpackPoints(points);
  return adaptChromatogram({ kind, id: null, time, intensity });
}
