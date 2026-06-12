// buildTic — the pure TIC (total-ion-current) aggregation transform (IMAGE-01).
//
// Mirrors src/imaging/grid.ts: a named pure export, no side effects, importing
// ONLY plain types. This is a NEW layer ABOVE both src/reader/ and src/imaging/.
// It NEVER touches Arrow, bigint, or mzpeakts beyond the SINGLE documented
// boundary conversion `Number(point.index)` at the first op (Pitfall 1, D-03).
// Orientation is OWNED upstream by grid.ts: the cell key formula
// `key = y0*width + x0` is reused by inverting `coordToSpectrumIndex` — buildTic
// introduces NO transpose/flip of its own (C2 MANDATORY, IMAGE-04).
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
 * Sum each spectrum's full intensity array onto its grid cell, producing a dense
 * `Float32Array` TIC raster (length `grid.width * grid.height`, row-major).
 *
 * - Cell index reuses grid.ts's `key = y0*width + x0` by inverting
 *   `coordToSpectrumIndex` (spectrumIndex → key). No re-derivation, no flip.
 * - `point.index` (a `bigint` from the reader) is converted with `Number()` as
 *   the FIRST op — a `Map.get(bigint)` would miss a `number` key.
 * - Points whose spectrum index is not on the grid (absent / off-grid) are
 *   skipped silently. Points with no intensity array contribute nothing.
 * - Non-finite intensity elements (NaN/Infinity) are treated as 0 (T-03-01).
 *
 * Absent cells stay 0 here; the absent-vs-zero DISTINCTION is a render concern
 * owned by rasterizeTic via `presenceMask` (D-09).
 */
export function buildTic(xic: XicLike, grid: ImagingGrid): Float32Array {
  const tic = new Float32Array(grid.width * grid.height);

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
      // Strict numeric guard (T-03-01, Codex round2 #4): ONLY genuine finite
      // `number` elements contribute. A non-number element — including a
      // numeric-looking string like "1000" from a mis-typed file column — is
      // treated as 0 rather than silently coerced into the TIC integrity total.
      sum += typeof v === "number" && Number.isFinite(v) ? v : 0;
    }
    tic[key] = sum;
  }

  return tic;
}
