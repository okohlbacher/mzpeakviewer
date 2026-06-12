// Plain, UI-facing types for the reader boundary.
//
// CONTRACT: this file is the shared vocabulary for everything ABOVE src/reader/.
// Plans 01-02 and 01-03 (and Phases 2-5) build against these exact shapes.
// Nothing here references apache-arrow, mzpeakts internals, or `bigint` — the
// reader/ folder is the ONLY place that touches the unstable format
// (ARCHITECTURE anti-pattern 2: no Arrow / bigint leaks upward).

/** One entity from `mzpeak_index.json` (FMT-01). */
export type ManifestEntry = {
  name: string;
  entityType: string;
  dataKind: string;
};

/**
 * File-level metadata groups (FMT-02). Kept as `unknown` here because plan 01-01
 * only RENDERS them generically; later plans may narrow individual groups.
 */
export type FileMeta = {
  fileDescription: unknown;
  instrumentConfigurations: unknown[];
  software: unknown[];
  run: unknown;
  samples: unknown[];
};

/** Per-file aggregate stats (FMT-03). */
export type FileStats = {
  numSpectra: number;
  numEntities: number;
  mzRange: [number, number] | null;
  msLevels: number[];
  /** Spectrum count per MS level, e.g. {1: 34840, 2: 1200}. Optional — only the
   *  full reader path populates it; derive a single-level fallback from
   *  numSpectra+msLevels when absent. */
  spectraPerLevel?: Record<number, number>;
  /** Profile vs centroid breakdown (R-02b). Populated by computeStats. */
  representationCounts: { profile: number; centroid: number };
};

/** A finding for an encoding/storage feature mzpeakts cannot decode (DATA-02). */
export type UnsupportedFinding = { code: string; label: string };

/** Capability readout (FMT-04). Full detection lands in plan 01-03; 01-01 keeps the shape. */
export type Capabilities = {
  layout: "point" | "chunked" | "mixed";
  encodings: string[];
  isImaging: boolean;
  unsupported: UnsupportedFinding[];
};

/**
 * The spectrum-representation field promoted to the reader boundary (R-01a /
 * IMAGING-SPEC C6): derived from MS:1000525 — MS:1000128 = profile,
 * MS:1000127 = centroid. Phase 3 (DATA-03 signal-file routing) builds on this.
 */
export type SpectrumRepresentation = "profile" | "centroid" | null;

/**
 * Plain per-spectrum metadata accessor result. `representation` is REQUIRED here
 * so downstream phases never reopen the reader to derive it (R-01a binding).
 */
export type SpectrumMeta = {
  index: number;
  id: string;
  msLevel: number | null;
  representation: SpectrumRepresentation;
};

/** Reconstructed signal arrays for one spectrum (point layout, DATA-01). */
export type SpectrumArrays = {
  index: number;
  id: string;
  mz: Float64Array;
  intensity: Float32Array;
};

/** Coarse staged-load progress for LOAD-03 feedback. */
export type LoadStage =
  | "idle"
  | "zip-index"
  | "manifest"
  | "metadata"
  | "grid"
  | "tic" // Phase 3 TIC compute stage (D-02)
  | "ready"
  // D-06: valid non-imaging file — successful read, no spatial coords.
  | "no-imaging"
  | "error";
