// PURE adapter: an ion-image raster (per-pixel intensities) → the contract
// IonImageStats sent with a renderResult.
//
// Follows the capability.ts template: a pure function from a plain typed array to a
// wire type. No mzpeakts, no reader, no grid handle — the stats line is computed
// straight off the ion image the renderer produced.
//
// Mirrors mzPeakIV's `computeIonImageStats` (src/compute/ionImage.ts): nonzeroCount
// counts cells with value !== 0; min/max are taken over the finite, nonzero cells;
// an all-zero (or all-absent) image returns {0,0,0} rather than ±Infinity, so the UI
// never has to escape sentinel values.

import type { IonImageStats } from "@mzpeak/contracts";

/**
 * Compute the {nonzeroCount, min, max} summary over an ion-image raster.
 *
 * - `nonzeroCount`: count of finite cells whose value !== 0.
 * - `min`/`max`: minimum/maximum over the finite, nonzero cells.
 * - All-zero / empty input → {nonzeroCount: 0, min: 0, max: 0} (no Infinity leaks).
 *
 * Zero-valued cells are excluded from min/max because in an MSI ion image a 0 is an
 * absent/background pixel, not a meaningful low: clipping the display range to the
 * nonzero span is what the renderer wants. Non-finite cells (NaN/Infinity) are
 * skipped entirely.
 */
export function computeIonImageStats(img: Float32Array): IonImageStats {
  let nonzeroCount = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < img.length; i++) {
    const v = img[i]!; // Float32Array index in-bounds → always a number
    if (!Number.isFinite(v) || v === 0) continue; // skip absent/zero + non-finite
    nonzeroCount++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // No nonzero finite cells → safe zeros (not ±Infinity).
  if (nonzeroCount === 0) {
    return { nonzeroCount: 0, min: 0, max: 0 };
  }
  return { nonzeroCount, min, max };
}
