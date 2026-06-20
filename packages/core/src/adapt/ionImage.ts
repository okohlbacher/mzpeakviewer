// PURE adapter: an ion-image raster (per-pixel intensities) → the contract
// IonImageStats sent with a renderResult.
//
// Follows the capability.ts template: a pure function from a plain typed array to a
// wire type. No mzpeakts, no reader, no grid handle — the stats line is computed
// straight off the ion image the renderer produced.
//
// Stats semantics: nonzeroCount counts cells with value !== 0; min/max are taken over
// the finite, nonzero cells; an all-zero (or all-absent) image returns {0,0,0} rather
// than ±Infinity, so the UI never has to escape sentinel values.

import type { IonImageStats } from "@mzpeak/contracts";

/**
 * Compute the {nonzeroCount, min, max} summary over an ion-image raster.
 *
 * When a `presenceMask` is given, cells with `presenceMask[k] === 0` are ABSENT and
 * skipped, so a *present* pixel with a legitimate 0 intensity still counts toward
 * min/max (dropping the mask would be a real semantic bug — a present-with-zero pixel
 * would be wrongly treated as absent). `nonzeroCount` counts present finite cells with
 * value !== 0.
 *
 * Without a mask (no grid context) it falls back to treating 0 as absent/background
 * and excludes it from min/max. All-absent / empty input → {0, 0, 0} (no ±Infinity).
 */
export function computeIonImageStats(img: Float32Array, presenceMask?: Uint8Array): IonImageStats {
  let nonzeroCount = 0;
  let min = Infinity;
  let max = -Infinity;
  const n = presenceMask ? Math.min(img.length, presenceMask.length) : img.length;
  for (let i = 0; i < n; i++) {
    if (presenceMask && presenceMask[i] === 0) continue; // absent pixel
    const v = img[i]!; // Float32Array index in-bounds → always a number
    if (!Number.isFinite(v)) continue;
    if (!presenceMask && v === 0) continue; // no mask: treat background 0 as absent
    if (v !== 0) nonzeroCount++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) {
    return { nonzeroCount: 0, min: 0, max: 0 }; // no present finite cells → safe zeros
  }
  return { nonzeroCount, min, max };
}
