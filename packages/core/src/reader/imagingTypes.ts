// Plain, UI-facing types for the imaging layer.
//
// CONTRACT: this file is the cross-phase vocabulary for the spatial pixel grid.
// Plan 02-03 (store wiring) and Phase 3 (TIC builder) consume `ImagingGrid` —
// specifically its `width`/`height`/`coordToSpectrumIndex`/`presenceMask` fields.
// Nothing here references apache-arrow, mzpeakts internals, or `bigint`: the
// imaging/ layer sits ABOVE the reader boundary and receives only plain numbers
// (02-CONTEXT D-08). The boundary is one-way — imaging/ never imports reader/.

/**
 * Grid geometry input to `buildImagingGrid`. Structurally identical to the object
 * `src/reader/scanCoords.ts` (plan 02-01) returns from `readGridGeometry`. Declared
 * here so the imaging layer owns the contract.
 *
 * - `pixelCount`: declared grid extent (IMS:1000042/43). Declared WINS over observed
 *   max coordinate (D-11/C4). `null` when neither discovery block nor run params
 *   declare it → fall back to max observed coordinate.
 * - `pixelSizeUm`: pixel aspect (IMS:1000046/47 µm). `null` → 1:1 (D-12/C5).
 * - `coordinateBase`: 1-based per spec (D-10/C3), but READ it — never hard-code −1.
 * - `geometrySource`: provenance for diagnostics.
 */
export interface GridGeometry {
  pixelCount: { x: number; y: number } | null;
  pixelSizeUm: { x: number; y: number } | null;
  coordinateBase: number;
  geometrySource: "discovery-block" | "run-params";
}

/** Which CoordSource strategy produced the coordinates (D-16). Surfaced in diagnostics. */
export type CoordSourceStrategy = "promoted-columns" | "cv-params" | "id-parse";

/**
 * Reconstructed spatial pixel grid (IMG-02). Sparse by construction: the
 * coord→spectrum lookup is a `Map`, and only the boolean presence mask is dense
 * (D-14/C8). NEVER a dense width*height spectrum-index array.
 */
export interface ImagingGrid {
  width: number;
  height: number;
  /** Read from geometry (D-10) — never hard-coded. */
  coordinateBase: number;
  /** IMS:1000046/47, or null → 1:1 (D-12). */
  pixelSizeUm: { x: number; y: number } | null;
  /** Sparse lookup (D-14) — Phase 3 needs this. Key = y0*width + x0 (row-major, 0-based). */
  coordToSpectrumIndex: Map<number, number>;
  /** Length width*height (D-14) — Phase 3 needs this. 1 = filled, 0 = empty. */
  presenceMask: Uint8Array;
  filledCount: number;
  totalCells: number;
  coordSourceStrategy: CoordSourceStrategy;
  diagnostics: GridDiagnostics;
}

/** Grid diagnostics (IMG-03): fill ratio, anomalies, provenance. */
export interface GridDiagnostics {
  spectrumCount: number;
  uniqueCoordCount: number;
  duplicateCount: number;
  /** totalCells − filledCount (sparse absent pixels). */
  missingCount: number;
  /** Coords skipped because they were non-finite (NaN/Infinity) or out of declared extent. */
  oobCount: number;
  extentSource: "declared" | "max-coord";
  geometrySource: "discovery-block" | "run-params" | "derived";
  /** C1/C4 columns-vs-discovery mismatch note, else null. */
  discoveryDisagreement: string | null;
}
