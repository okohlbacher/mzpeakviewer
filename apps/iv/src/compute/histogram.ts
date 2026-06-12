// histogram.ts — BL-07: histogram equalization for Float32Array ion images.
//
// Pure compute module: no external dependencies, no side effects, no mutations of
// the input array. Equalization operates over present pixels only (presenceMask[k]
// === 1); absent pixels are always 0 in the output.

/** Controls which intensity remapping mode is applied to an ion image. */
export type HistogramMode = "none" | "equalize" | "clahe";

/**
 * Apply histogram equalization to a row-major Float32Array ion image.
 *
 * ### Modes
 *
 * - **`"none"`** — No transformation; returns a copy of the input unchanged.
 *
 * - **`"equalize"`** — Classical global histogram equalization over present
 *   pixels only:
 *   1. Collect all present non-zero values, sort ascending.
 *   2. Build a CDF (cumulative distribution) from the sorted values.
 *   3. Map each present pixel's value through the CDF to the range
 *      `[0, maxValue]`, preserving the original maximum so the output
 *      intensity scale is unchanged.
 *   4. Absent pixels remain 0 in the output.
 *   Zero-valued present pixels are left at 0 (they are excluded from the CDF
 *   but still written as 0 in the output, distinguishing "signal == 0" from
 *   "pixel absent").
 *
 * - **`"clahe"`** — Contrast-Limited Adaptive Histogram Equalization. Stub:
 *   currently delegates to the global equalization path.
 *   TODO: implement tile-based CLAHE with contrast limiting.
 *
 * ### Invariants
 * - Output maximum over present pixels equals input maximum over present pixels.
 * - The input array is never mutated; a new Float32Array is always returned.
 * - If there are no present pixels, or all present pixels are 0, the output
 *   is an all-zero copy of the input.
 *
 * @param image       Row-major Float32Array of length `width * height`.
 * @param presenceMask Uint8Array of the same length; 1 = pixel present.
 * @param mode        Equalization mode to apply.
 * @returns A new Float32Array of the same length; the input is never mutated.
 */
export function histogramEqualize(
  image: Float32Array,
  presenceMask: Uint8Array,
  mode: HistogramMode,
): Float32Array {
  // Early exit: no transformation requested.
  if (mode === "none") {
    return image.slice();
  }

  // CLAHE stub — delegates to global equalization.
  // TODO: implement tile-based CLAHE with contrast limiting.
  if (mode === "clahe") {
    return histogramEqualize(image, presenceMask, "equalize");
  }

  // --- "equalize" path ---

  const n = image.length;

  // 1. Collect present non-zero values and find the maximum over present pixels.
  let maxValue = 0;
  const presentNonzero: number[] = [];

  for (let k = 0; k < n; k++) {
    if (presenceMask[k] === 0) continue; // absent pixel
    const v = image[k];
    if (!Number.isFinite(v)) continue;
    if (v > maxValue) maxValue = v;
    if (v !== 0) presentNonzero.push(v);
  }

  // Guard: no signal — return an all-zero copy.
  if (presentNonzero.length === 0 || maxValue === 0) {
    return new Float32Array(n); // all zeros; absent pixels are implicitly 0
  }

  // 2. Sort values ascending for CDF construction.
  presentNonzero.sort((a, b) => a - b);

  const total = presentNonzero.length;

  /**
   * Map a present pixel value to its equalized output via the empirical CDF.
   *
   * The CDF rank is the number of non-zero present pixels with value ≤ v
   * (binary search). The rank is then linearly scaled to [0, maxValue], giving:
   *
   *   out = (rank / total) * maxValue
   *
   * This ensures the output maximum equals `maxValue` (the input max over
   * present pixels), satisfying the invariant.
   */
  function mapValue(v: number): number {
    if (v === 0) return 0; // zero-valued present pixels stay at 0

    // Binary search: find the number of elements ≤ v (upper bound).
    let lo = 0;
    let hi = total;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (presentNonzero[mid] <= v) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const rank = lo; // count of non-zero present values ≤ v

    return (rank / total) * maxValue;
  }

  // 3. Build the equalized output.
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (presenceMask[k] === 0) {
      // Absent pixel — stays 0 (already initialized).
      continue;
    }
    const v = image[k];
    out[k] = Number.isFinite(v) ? mapValue(v) : 0;
  }

  return out;
}
