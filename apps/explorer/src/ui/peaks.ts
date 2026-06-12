import type { SpectrumArrays } from "../reader/types";

/**
 * Indices of the top-`n` peaks within the m/z window [xmin, xmax].
 *
 * - Centroid spectra: every point is already a peak → take the `n` most intense
 *   points in the window.
 * - Profile spectra: take local maxima (strictly greater than both neighbours)
 *   then the `n` most intense of those.
 *
 * Returned indices are sorted by ascending m/z so callers can lay out labels
 * left-to-right.
 */
export function topPeakIndices(
  s: SpectrumArrays,
  xmin: number,
  xmax: number,
  n: number,
): number[] {
  const { mz, intensity, representation } = s;
  const cands: number[] = [];

  if (representation === "centroid") {
    for (let i = 0; i < mz.length; i++) {
      if (mz[i] >= xmin && mz[i] <= xmax && intensity[i] > 0) cands.push(i);
    }
  } else {
    for (let i = 1; i < mz.length - 1; i++) {
      if (mz[i] < xmin || mz[i] > xmax) continue;
      const v = intensity[i];
      if (v > 0 && v > intensity[i - 1] && v >= intensity[i + 1]) cands.push(i);
    }
  }

  cands.sort((a, b) => intensity[b] - intensity[a]);
  const top = cands.slice(0, n);
  top.sort((a, b) => mz[a] - mz[b]);
  return top;
}

/** Nearest peak index to a given m/z (used to snap the hover tooltip). */
export function nearestPeakIndex(s: SpectrumArrays, mzValue: number): number | null {
  const { mz } = s;
  if (mz.length === 0) return null;
  // mz is ascending — binary search for the closest.
  let lo = 0;
  let hi = mz.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (mz[mid] < mzValue) lo = mid;
    else hi = mid;
  }
  return mzValue - mz[lo] <= mz[hi] - mzValue ? lo : hi;
}
