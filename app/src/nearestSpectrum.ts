/** The minimal shape this search reads — satisfied by both the MS `BrowseIndex` and the
 *  UV/VIS `WavelengthBrowseIndex` (which has no `msLevel`). */
type TimeIndex = { rt: ArrayLike<number>; msLevel?: ArrayLike<number> };

/**
 * Index of the spectrum whose retention time is closest to `timeSec`, optionally
 * restricted to a single MS level. Returns -1 when no spectrum qualifies (e.g. the
 * requested level is absent, or every retention time is non-finite).
 *
 * Used by any view that turns a time-axis click into a spectrum selection
 * (chromatogram cards, the UV/VIS heatmap and chromatogram).
 */
export function nearestSpectrumByTime(browse: TimeIndex, timeSec: number, msLevel?: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < browse.rt.length; i++) {
    if (msLevel != null && browse.msLevel?.[i] !== msLevel) continue;
    const d = Math.abs((browse.rt[i] ?? NaN) - timeSec);
    if (Number.isFinite(d) && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
