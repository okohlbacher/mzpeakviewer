// Wire payload types — the plain, structured-clone/transfer-safe shapes that cross
// the worker boundary. Deliberately NOT imported from mzpeakts or either reader:
// the contract is the wire format, decoupled from reader internals (Phase 0 may
// still be reshaping `DataArrays`). The engine maps reader output INTO these.
//
// Rule of thumb: every type here must survive `structuredClone` or be a transfer-
// able typed array. No Arrow vectors, no Maps-of-objects, no class instances with
// methods.

/** ZIP/archive member listing. */
export type ManifestEntry = {
  path: string;
  /** Logical role parsed from mzpeak_index.json (e.g. "spectra_data", "metadata"). */
  role?: string;
  /** Compressed/stored size in bytes, when known. */
  bytes?: number | null;
};
export type Manifest = ManifestEntry[];

/** Opaque, already-serialized file-level metadata trees (CV-aware rendering is UI). */
export type FileMeta = {
  fileDescription: unknown;
  instrumentConfigurations: unknown[];
  software: unknown[];
  run: unknown;
  samples: unknown[];
};

/** Aggregate statistics computed by the engine (Explorer scanBreakdown + IV stats). */
export type FileStats = {
  numSpectra: number;
  numEntities: number;
  mzRange: [number, number] | null;
  rtRange: [number, number] | null;
  msLevels: number[];
  spectraPerLevel?: Record<number, number>;
  representationCounts: { profile: number; centroid: number; unknown?: number };
  instrument?: string | null;
};

/** Profile vs centroid — the plot branches on this (peak labels, fill vs needles). */
export type SpectrumRepresentation = "profile" | "centroid" | null;

/** One spectrum's arrays (transfer mz + intensity buffers). */
export type SpectrumArrays = {
  index: number;
  id: string;
  mz: Float64Array;
  intensity: Float32Array;
  /**
   * Profile/centroid, when the engine knows it. The spectrum plot needs this to
   * render centroid as needles + pick top peaks vs profile as a filled trace
   * (Phase-2 ui-kit found the gap — it kept a local type carrying this). The
   * engine MUST populate it; `null`/absent = unknown (plot falls back to profile).
   */
  representation?: SpectrumRepresentation;
};

/** Ion-image intensity stats sent with renderResult. */
export type IonImageStats = { nonzeroCount: number; min: number; max: number };

/**
 * Imaging grid in transfer-safe form. IV's ImagingGrid carries a
 * `Map<number,number>` (coordToSpectrumIndex) which clones but is not zero-copy;
 * on the wire we flatten it to parallel typed arrays the worker can transfer and
 * the shell can rebuild a lookup from. presenceMask transfers as a Uint8Array.
 */
export type ImagingGridWire = {
  width: number;
  height: number;
  /** Min coords (1-based IMS positions) so the shell can offset into the grid. */
  originX: number;
  originY: number;
  /** Flattened coord→index lookup: coordKey[i] = y*width + x ; spectrumIndex[i]. */
  coordKey: Int32Array;
  spectrumIndex: Int32Array;
  /** 1 byte per cell: present(1)/absent(0). */
  presenceMask: Uint8Array;
};

/** Descriptor for an embedded optical image (decoded lazily via getOpticalImage). */
export type OpticalImageMeta = {
  archivePath: string;
  name?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
};

/** A chromatogram trace (TIC/XIC/stored). time = x (seconds), intensity = y. */
export type ChromatogramSeries = {
  kind: "tic" | "xic" | "stored";
  id?: string | null;
  time: Float32Array;
  intensity: Float32Array;
};

/** Parquet footer summary for the Structure tab. */
export type ParquetFooter = {
  archivePath: string;
  numRows: number;
  numRowGroups: number;
  columns: { name: string; type: string; logicalType?: string | null }[];
};

/** A page of a deeply-read parquet column. */
export type ColumnPage = {
  archivePath: string;
  column: string;
  offset: number;
  /** Stringified cell values for display (the engine renders typed → string). */
  values: Uint8Array; // length-prefixed UTF-8 blob; decoded by the shell adapter
  count: number;
  hasMore: boolean;
};

/** A small bounded sample of a column (for Structure previews). */
export type ColumnSample = {
  archivePath: string;
  column: string;
  preview: string[];
  totalRows: number;
};

/** Archive member list for the Structure tab (richer than Manifest). */
export type ArchiveMemberList = {
  members: { path: string; bytes: number; compressedBytes: number; isParquet: boolean }[];
};

/** SDRF/ISA study metadata (Explorer Summary ▸ Study). Opaque to the wire. */
export type StudyMeta = {
  sdrf?: unknown;
  isa?: unknown;
  present: boolean;
};

/** Error classes the reader can raise (carried across the boundary). */
export type ReaderErrorClass =
  | "network"
  | "cors"
  | "not-found"
  | "parse"
  | "unsupported"
  | "format"
  | "internal";

export type UnsupportedFinding = { code: string; label: string };

/** Coarse load-pipeline stages for the progress UI. */
export type LoadStage =
  | "fetching"
  | "unzipping"
  | "manifest"
  | "metadata"
  | "grid"
  | "tic"
  | "done";
