// The x axis MS chromatograms and the Browse index run along: retention time, or — for a run
// with no time axis — the spectrum index. One rule, shared by every producer of MS time values
// (the scan pass in summary.ts and the XIC extraction in browse.ts).
import type { Reader } from "./open";
import { getCol, numOrNull } from "./cv";

type ArrowCol = { get(i: number): unknown } | null;
type ArrowStructVec = { getChild?: (n: string) => ArrowCol } | null;

/**
 * Whether the run has a usable retention-time axis: at least two spectra with distinct finite
 * times. Imaging and other spatial runs often state no time at all (the converter writes 0 for
 * every spectrum, e.g. an imzML without scan start times), and plotting such a run against time
 * stacks every point at one x. Without an axis the spectrum INDEX (acquisition order — the pixel
 * scan order for imaging) stands in as the chromatogram x everywhere. File-wide and cached: a
 * windowed XIC that happens to hit one time must not change the decision.
 */
const timeAxisCache = new WeakMap<object, boolean>();
export function hasTimeAxis(reader: Reader): boolean {
  const key = reader as unknown as object;
  const cached = timeAxisCache.get(key);
  if (cached !== undefined) return cached;
  const vec = (reader.spectrumMetadata as unknown as { spectra?: ArrowStructVec })?.spectra ?? null;
  const timeCol = vec?.getChild ? getCol<ArrowCol>(vec, "time") : null;
  let first: number | null = null;
  let axis = false;
  // ponytail: no time column / exotic reader → assume an axis (the previous behaviour).
  if (!timeCol) axis = true;
  else
    for (let i = 0, n = reader.spectrumMetadata?.length ?? 0; i < n; i++) {
      const t = numOrNull(timeCol.get(i));
      if (t === null) continue;
      if (first === null) first = t;
      else if (t !== first) { axis = true; break; }
    }
  timeAxisCache.set(key, axis);
  return axis;
}

/** The x value of spectrum `index`: its retention time in SECONDS (the file stores MINUTES), or
 *  the index itself when the run has no time axis. Null when the run has an axis but this
 *  spectrum states no time. */
export function spectrumX(timeAxis: boolean, rawMinutes: number | null, index: number): number | null {
  if (!timeAxis) return index;
  return rawMinutes === null ? null : rawMinutes * 60;
}
