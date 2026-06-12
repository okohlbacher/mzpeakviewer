// PURE adapter: IV's in-memory ImagingGrid → the contract ImagingGridWire.
//
// Follows the capability.ts template: a pure function from plain, already-extracted
// data (NO mzpeakts handle, NO reader internals) to a wire type. The reader-I/O that
// reconstructs the grid lives in the handler; this file only RESHAPES.
//
// IV's ImagingGrid (mzPeakIV src/imaging/types.ts) carries a `Map<number,number>`
// `coordToSpectrumIndex`. Its key encoding is `y0*width + x0` (row-major, 0-based,
// after subtracting coordinateBase) — see mzPeakIV src/imaging/types.ts:44 and the
// key write at src/imaging/grid.ts:116 (`const key = y0 * width + x0`). That is the
// SAME encoding the wire's `coordKey` documents, so flattening is a 1:1 copy of the
// Map entries into two parallel Int32Arrays — no re-derivation of x/y.

import type { ImagingGridWire } from "@mzpeak/contracts";

/**
 * Plain input mirroring IV's `ImagingGrid` (only the fields the wire needs). The
 * handler hands this over after grid reconstruction; the Map carries the sparse
 * coord→spectrum lookup, the mask is the dense presence raster.
 *
 * `coordToSpectrumIndex` accepts either the live `Map` (worker-side) or an array of
 * `[coordKey, spectrumIndex]` entries (already structured-cloned), so the adapter is
 * usable on both sides of the boundary.
 */
export type GridInput = {
  width: number;
  height: number;
  /**
   * IV's `ImagingGrid.coordinateBase` (src/imaging/types.ts:41) — the absolute IMS
   * position of local cell 0 (read from geometry, typically 1). The Map keys are
   * already 0-based local (`y0*width+x0`, after subtracting coordinateBase), so the
   * shell adds `coordinateBase` to recover absolute IMS coords. REQUIRED — defaulting
   * it to 0 silently offset every pixel by one (review).
   */
  coordinateBase: number;
  /** Explicit per-axis min coords; default to `coordinateBase` when absent. */
  originX?: number;
  originY?: number;
  /** Sparse coord→spectrum lookup. Key = y0*width + x0 (row-major, 0-based). */
  coordToSpectrumIndex: Map<number, number> | Array<[number, number]>;
  /** Dense presence raster, length width*height: 1 = filled, 0 = absent. */
  presenceMask: Uint8Array;
};

/**
 * Flatten IV's grid into the transfer-safe `ImagingGridWire`. The Map is unrolled
 * into two parallel Int32Arrays (`coordKey[i]` ↔ `spectrumIndex[i]`); the dense
 * `presenceMask` passes through unchanged. `originX`/`originY` carry `coordinateBase`
 * so the shell maps local cells back to absolute IMS positions.
 *
 * The output is structured-clone- and transfer-safe (no Map, no class instances):
 * the three typed arrays can be transferred across the worker boundary.
 */
export function flattenGrid(input: GridInput): ImagingGridWire {
  const entries =
    input.coordToSpectrumIndex instanceof Map
      ? input.coordToSpectrumIndex.entries()
      : input.coordToSpectrumIndex;

  // Materialize once so we can size the typed arrays exactly (Map has no index access).
  const pairs = Array.from(entries);
  const coordKey = new Int32Array(pairs.length);
  const spectrumIndex = new Int32Array(pairs.length);
  for (let i = 0; i < pairs.length; i++) {
    const [key, idx] = pairs[i]!;
    coordKey[i] = key;
    spectrumIndex[i] = idx;
  }

  return {
    width: input.width,
    height: input.height,
    originX: input.originX ?? input.coordinateBase,
    originY: input.originY ?? input.coordinateBase,
    coordKey,
    spectrumIndex,
    presenceMask: input.presenceMask,
  };
}

/**
 * Inverse of `flattenGrid`: rebuild the `coordKey → spectrumIndex` lookup Map the
 * shell side uses to resolve a clicked pixel back to its spectrum. Pairs the two
 * parallel arrays element-wise (truncating to the shorter, defensively).
 */
export function rebuildCoordMap(wire: ImagingGridWire): Map<number, number> {
  const map = new Map<number, number>();
  const n = Math.min(wire.coordKey.length, wire.spectrumIndex.length);
  for (let i = 0; i < n; i++) {
    map.set(wire.coordKey[i]!, wire.spectrumIndex[i]!);
  }
  return map;
}
