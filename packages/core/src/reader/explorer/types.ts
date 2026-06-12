// HARVESTED (trimmed) from mzPeakExplorer/src/reader/types.ts (read-only source).
// Only the reader-boundary types used by the harvested open/summary/browse modules
// are kept; the unused Structure/Study/Imaging types were intentionally dropped.

/** One entity row from `mzpeak_index.json`. */
export type ManifestEntry = {
  name: string;
  entityType: string;
  dataKind: string;
};

/** profile / centroid, derived from MS:1000525. */
export type Representation = "profile" | "centroid" | null;

/**
 * OpenMS FileInfo-style aggregate readout. Derived from the eagerly-loaded
 * metadata tables — no signal arrays are read to compute it. (Trimmed: the
 * imaging discovery block + layout/encoding fields are not needed by the LC
 * engine slice, so they are omitted here.)
 */
export type FileSummary = {
  fileName: string;
  fileSize: number | null;
  numSpectra: number;
  numChromatograms: number;
  numEntities: number;
  /** spectra count per MS level, e.g. { 1: 120, 2: 880 }. */
  msLevelCounts: Record<number, number>;
  representationCounts: { profile: number; centroid: number; unknown: number };
  /** [min, max] over per-spectrum scan windows, or null when not derivable. */
  mzRange: [number, number] | null;
  /** [min, max] retention time (seconds) over all spectra, or null. */
  rtRange: [number, number] | null;
  isImaging: boolean;
  /** Best-effort instrument model name from the instrument configuration. */
  instrument: string | null;
};

/** A lightweight per-spectrum index row used by the Browse navigator. */
export type SpectrumIndexRow = {
  index: number;
  id: string;
  msLevel: number | null;
  representation: Representation;
  /** retention time in seconds, or null when the file has no time column. */
  time: number | null;
  /** total ion current from MS:1000285 if promoted, else null. */
  tic: number | null;
};

/** A fully reconstructed single spectrum's signal arrays + identity. */
export type SpectrumArrays = {
  index: number;
  id: string;
  msLevel: number | null;
  representation: Representation;
  time: number | null;
  mz: Float64Array;
  intensity: Float32Array;
};

/** One point of an extracted-ion / total-ion chromatogram. */
export type ChromPoint = { time: number; index: number; intensity: number };

/** A stored chromatogram (e.g. the TIC written by the converter). */
export type StoredChromatogram = {
  index: number;
  id: string;
  time: Float64Array;
  intensity: Float32Array;
};
