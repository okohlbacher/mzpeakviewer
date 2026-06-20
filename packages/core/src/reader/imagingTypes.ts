// Plain, UI-facing types for the imaging layer.
//
// This file is the shared vocabulary for the spatial pixel grid. The store
// wiring and the TIC builder consume `ImagingGrid` — specifically its
// `width`/`height`/`coordToSpectrumIndex`/`presenceMask` fields. Nothing here
// references apache-arrow, mzpeakts internals, or `bigint`: the imaging/ layer
// sits ABOVE the reader boundary and receives only plain numbers. The boundary
// is one-way — imaging/ never imports reader/.

/**
 * Grid geometry input to `buildImagingGrid`. Structurally identical to the object
 * `scanCoords.ts` returns from `readGridGeometry`. Declared here so the imaging
 * layer owns the contract.
 *
 * - `pixelCount`: declared grid extent (IMS:1000042/43). Declared WINS over observed
 *   max coordinate. `null` when neither discovery block nor run params declare it →
 *   fall back to max observed coordinate.
 * - `pixelSizeUm`: pixel aspect (IMS:1000046/47 µm). `null` → 1:1.
 * - `coordinateBase`: 1-based per spec, but READ it — never hard-code −1.
 * - `geometrySource`: provenance for diagnostics.
 */
export interface GridGeometry {
  pixelCount: { x: number; y: number } | null;
  pixelSizeUm: { x: number; y: number } | null;
  coordinateBase: number;
  geometrySource: "discovery-block" | "run-params";
}

/** Which CoordSource strategy produced the coordinates. Surfaced in diagnostics. */
export type CoordSourceStrategy = "promoted-columns" | "cv-params" | "id-parse";

/**
 * Reconstructed spatial pixel grid. Sparse by construction: the coord→spectrum
 * lookup is a `Map`, and only the boolean presence mask is dense. NEVER a dense
 * width*height spectrum-index array.
 */
export interface ImagingGrid {
  width: number;
  height: number;
  /** Read from geometry — never hard-coded. */
  coordinateBase: number;
  /** IMS:1000046/47, or null → 1:1. */
  pixelSizeUm: { x: number; y: number } | null;
  /** Sparse lookup. Key = y0*width + x0 (row-major, 0-based). */
  coordToSpectrumIndex: Map<number, number>;
  /** Length width*height. 1 = filled, 0 = empty. */
  presenceMask: Uint8Array;
  filledCount: number;
  totalCells: number;
  coordSourceStrategy: CoordSourceStrategy;
  diagnostics: GridDiagnostics;
}

/** Grid diagnostics: fill ratio, anomalies, provenance. */
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
  /** Columns-vs-discovery mismatch note, else null. */
  discoveryDisagreement: string | null;
}
