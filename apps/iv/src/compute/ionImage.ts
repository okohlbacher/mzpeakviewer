// buildIonImage — the pure ion-image aggregation transform (IMAGE-02).
//
// Mirrors src/compute/tic.ts: a named pure export, no side effects, importing
// ONLY plain types. This is a NEW layer ABOVE both src/reader/ and src/imaging/.
// It NEVER touches Arrow, bigint, or mzpeakts beyond the SINGLE documented
// boundary conversion `Number(point.index)` at the first op (Pitfall 1).
// Orientation is OWNED upstream by grid.ts: the cell key formula
// `key = y0*width + x0` is reused by inverting `coordToSpectrumIndex` — buildIonImage
// introduces NO transpose/flip of its own (C2 MANDATORY).
//
// NOTE: The reader already windows each spectrum's data arrays to [mzMin, mzMax]
// before returning the XIC (RESEARCH Pattern 1). buildIonImage does NOT filter
// m/z itself — it simply sums each (pre-windowed) point's intensity array onto
// its grid cell, exactly like buildTic.
import type { ImagingGrid } from "../imaging/types";

// Reuse the intensity column key verbatim from src/reader/arrays.ts (DATA-01).
const INTENSITY_KEY = "intensity array";

/**
 * Minimal structural shape of one XIC point. Declared locally so src/compute/
 * stays free of any vendor (`mzpeakts`/apache-arrow) import — `XICPoint.index`
 * is a `bigint` at the reader boundary; `dataArrays` is keyed by human-readable
 * CV name. We accept `bigint | number` and convert with `Number()`.
 */
interface XicPointLike {
  index: bigint | number;
  // The reader's `dataArrays` is keyed by CV name and can structurally carry
  // numeric OR string arrays (e.g. label columns). We accept both shapes so the
  // reader's `XIC` is assignable WITHOUT importing any Arrow/mzpeakts type here
  // (one-way boundary). Only the numeric intensity array is ever read below, and
  // the `Number.isFinite` guard coerces any non-number element to 0.
  dataArrays: Record<
    string,
    ArrayLike<number> | ArrayLike<string> | ArrayLike<bigint> | undefined
  >;
}

/** Minimal structural shape of an XIC (the `extractXIC` return). */
interface XicLike {
  points: XicPointLike[];
}

/**
 * Convert a ppm tolerance to Daltons at the given center m/z (D-03).
 *
 * Formula: tol_da = (mz * ppm) / 1e6.
 * Input validation is the store action's responsibility — this function is pure.
 */
export function ppmToDa(mz: number, ppm: number): number {
  return (mz * ppm) / 1e6;
}

/**
 * Sum each spectrum's (pre-windowed) intensity array onto its grid cell, producing
 * a dense `Float32Array` ion-image raster (length `grid.width * grid.height`,
 * row-major).
 *
 * The reader already sliced each spectrum's arrays to the m/z window before
 * returning — this function does NOT filter m/z. It is otherwise a near-clone
 * of `buildTic`:
 *
 * - Cell index reuses grid.ts's `key = y0*width + x0` by inverting
 *   `coordToSpectrumIndex` (spectrumIndex → key). No re-derivation, no flip.
 * - `point.index` (a `bigint` from the reader) is converted with `Number()` as
 *   the FIRST op — a `Map.get(bigint)` would miss a `number` key (Pitfall 1).
 * - Points whose spectrum index is not on the grid (absent / off-grid) are
 *   skipped silently. Points with no intensity array contribute nothing.
 * - Non-finite intensity elements (NaN/Infinity) are treated as 0 (T-04-02).
 *
 * Absent cells stay 0 here; the absent-vs-zero DISTINCTION is a render concern
 * owned by rasterizeImage via `presenceMask` (C8).
 */
export function buildIonImage(xic: XicLike, grid: ImagingGrid): Float32Array {
  const img = new Float32Array(grid.width * grid.height);

  // Invert the grid's coord→spectrum map once: spectrumIndex → cell key. This
  // REUSES grid.ts's key formula rather than re-deriving x/y (C2).
  const idxToKey = new Map<number, number>();
  for (const [key, sIdx] of grid.coordToSpectrumIndex) {
    idxToKey.set(sIdx, key);
  }

  for (const point of xic.points) {
    // Boundary conversion FIRST (Pitfall 1): bigint index → number.
    const sIdx = Number(point.index);
    const key = idxToKey.get(sIdx);
    if (key === undefined) continue; // off-grid / absent spectrum — skip, no throw.

    const arr = point.dataArrays[INTENSITY_KEY];
    if (!arr) continue; // no intensity array — contributes nothing (no NaN).

    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      // Strict numeric guard (T-04-02): ONLY genuine finite `number` elements
      // contribute. A non-number element — including a numeric-looking string
      // from a mis-typed file column — is treated as 0 rather than silently
      // coerced into the ion image total.
      sum += typeof v === "number" && Number.isFinite(v) ? v : 0;
    }
    img[key] = sum;
  }

  return img;
}

/**
 * Compute statistics over the PRESENT cells of an ion-image raster.
 *
 * Absent cells (presenceMask[k] === 0) are excluded from all statistics — they
 * represent missing pixels, not "pixels with zero signal". This matches the
 * exclusion logic in `percentile99` / `percentileClip` in rasterize.ts.
 *
 * Returns:
 * - `nonzeroCount`: number of present cells where value !== 0
 * - `min`: minimum value over present finite cells (0 if no present finite cells)
 * - `max`: maximum value over present finite cells (0 if no present finite cells)
 *
 * Both `min` and `max` return 0 (not Infinity/-Infinity) when no present finite
 * values are found — callers can safely render the stats line without escaping
 * sentinel values into the UI (D-11).
 */
export function computeIonImageStats(
  values: Float32Array,
  grid: ImagingGrid,
): { nonzeroCount: number; min: number; max: number } {
  const { presenceMask } = grid;
  let nonzeroCount = 0;
  let min = Infinity;
  let max = -Infinity;
  const n = Math.min(values.length, presenceMask.length);
  for (let k = 0; k < n; k++) {
    if (presenceMask[k] === 0) continue; // absent — not "present-with-zero"
    const v = values[k];
    if (!Number.isFinite(v)) continue;
    if (v !== 0) nonzeroCount++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Guard: if no present finite values, return safe zeros (not Infinity/-Infinity).
  if (!Number.isFinite(min)) {
    min = 0;
    max = 0;
  }
  return { nonzeroCount, min, max };
}
