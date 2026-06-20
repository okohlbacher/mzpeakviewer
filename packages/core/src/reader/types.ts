// Plain, UI-facing types for the reader boundary. Nothing here references
// apache-arrow, mzpeakts internals, or `bigint`: the reader/ folder is the ONLY
// place that touches the unstable format.

/** One entity from `mzpeak_index.json`. */
export type ManifestEntry = {
  name: string;
  entityType: string;
  dataKind: string;
};

/** File-level metadata groups. */
export type FileMeta = {
  fileDescription: unknown;
  instrumentConfigurations: unknown[];
  software: unknown[];
  run: unknown;
  samples: unknown[];
};

/** Per-file aggregate stats. */
export type FileStats = {
  numSpectra: number;
  numEntities: number;
  mzRange: [number, number] | null;
  msLevels: number[];
  spectraPerLevel?: Record<number, number>;
  representationCounts: { profile: number; centroid: number };
};

/** A finding for an encoding/storage feature mzpeakts cannot decode. */
export type UnsupportedFinding = { code: string; label: string };

/** Capability readout. */
export type Capabilities = {
  layout: "point" | "chunked" | "mixed";
  encodings: string[];
  isImaging: boolean;
  unsupported: UnsupportedFinding[];
};

/**
 * Spectrum representation derived from MS:1000525 —
 * MS:1000128 = profile, MS:1000127 = centroid.
 */
export type SpectrumRepresentation = "profile" | "centroid" | null;

/** Plain per-spectrum metadata accessor result. */
export type SpectrumMeta = {
  index: number;
  id: string;
  msLevel: number | null;
  representation: SpectrumRepresentation;
};

/** Reconstructed signal arrays for one spectrum (point layout). */
export type SpectrumArrays = {
  index: number;
  id: string;
  mz: Float64Array;
  intensity: Float32Array;
};
