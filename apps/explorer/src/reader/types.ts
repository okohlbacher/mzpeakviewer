// UI-facing types for the reader boundary.
//
// Everything ABOVE src/reader/ speaks only these plain shapes — no apache-arrow
// Vectors, no `bigint`, no mzpeakts internals leak upward. The reader/ folder is
// the only place that touches the (explicitly unstable) mzPeak format.

/** One entity row from `mzpeak_index.json`. */
export type ManifestEntry = {
  name: string;
  entityType: string;
  dataKind: string;
};

/** One member of the `.mzpeak` ZIP archive (Structure tab). */
/** Coarse classification of a ZIP member for the Structure tab. */
export type ArchiveKind = "parquet" | "image" | "sample-metadata" | "index" | "other";

export type ArchiveEntry = {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
  isParquet: boolean;
  /** What this member is (drives the kind label + open/download affordances). */
  kind: ArchiveKind;
};

/** The ZIP listing plus its rolled-up totals. */
export type ArchiveListing = {
  entries: ArchiveEntry[];
  totalCompressed: number;
  totalUncompressed: number;
};

/** Per-column footprint inside a parquet file (summed across row groups). */
export type ParquetColumn = {
  name: string;
  type: string;
  compressedSize: number;
  uncompressedSize: number;
  numValues: number;
  compression: string;
};

/** Deep per-column detail read from a parquet footer (hyparquet). */
export type DeepColumn = {
  path: string;
  physicalType: string;
  codec: string;
  encodings: string[];
  dictionary: boolean;
  dataPages: number;
  dictionaryPages: number;
  numValues: number;
  nullCount: number | null;
  distinctCount: number | null;
  min: string | null;
  max: string | null;
  compressed: number;
  uncompressed: number;
  rowGroups: number;
  /** A non-repeated leaf whose values can be sampled for a histogram. */
  scalar: boolean;
};

/** Internal table structure of one parquet member (from its footer metadata). */
export type ParquetInfo = {
  numRows: number;
  numColumns: number;
  numRowGroups: number;
  totalCompressed: number;
  totalUncompressed: number;
  columns: ParquetColumn[];
  createdBy: string | null;
};

/** The five file-level metadata groups, kept generic for the tree view. */
export type FileMeta = {
  fileDescription: unknown;
  instrumentConfigurations: unknown[];
  software: unknown[];
  dataProcessing: unknown[];
  run: unknown;
  samples: unknown[];
};

/** profile / centroid, derived from MS:1000525. */
export type Representation = "profile" | "centroid" | null;

/** One optical image embedded in an imaging archive (metadata.imaging.images[]). */
export type OpticalImage = {
  archivePath: string;
  sourceName: string | null;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  sha256: string | null;
};

/**
 * Parsed `metadata.imaging` discovery block (mzPeak imaging spec). All fields
 * beyond `isImaging` / `coordinateBase` are optional per the schema.
 */
export type ImagingInfo = {
  isImaging: boolean;
  coordinateBase: number | null;
  pixelCount: { x: number; y: number; z: number | null } | null;
  pixelCountSource: string | null;
  mzRange: [number, number] | null;
  pixelSizeUm: { x: number; y: number } | null;
  maxDimensionUm: { x: number; y: number } | null;
  scanPattern: string | null;
  scanType: string | null;
  lineScanDirection: string | null;
  linescanSequence: string | null;
  images: OpticalImage[];
};

/**
 * OpenMS FileInfo-style aggregate readout. Everything here is derived from the
 * eagerly-loaded metadata tables — no signal arrays are read to compute it.
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
  /** point / chunked / mixed, inferred from the array-index buffer formats. */
  layout: "point" | "chunked" | "mixed" | "unknown";
  /** unique array-encoding CURIEs found in the array index. */
  encodings: string[];
  isImaging: boolean;
  /** Parsed imaging discovery block when this is an imaging archive, else null. */
  imaging: ImagingInfo | null;
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

/** Reconstructed signal arrays for one spectrum. */
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

export type LoadStage = "idle" | "loading" | "ready" | "error";

// ---- Study sample-metadata (SDRF / ISA) — see docs/sdrf-sample-metadata-display-SPEC.md ----

/** A controlled-vocabulary reference; `prefix`/`accession` kept verbatim for display,
 *  `id` = `${PREFIX}:${accession}` (prefix upper-cased) for case-insensitive lookups. */
export type CvRef = { prefix: string; accession: string; id: string; label: string | null };

/** One SDRF/ISA cell, parsed from `NT=…;AC=…` grammar or a plain/reserved value. */
export type Cell = {
  raw: string;
  value: string | null;
  cv: CvRef | null;
  unit: CvRef | null;
  reserved: "not available" | "not applicable" | "anonymized" | "pooled" | null;
  /** Long-tail SDRF tokens (MT/TA/PP/…), kept verbatim; deferred from the dashboard. */
  extra: Record<string, string>;
};

export type LabelKind = "isobaric" | "silac" | "label-free" | "other";
export type ChannelRole =
  | "experimental" | "reference" | "carrier" | "norm" | "empty" | "unknown";

/** One SDRF relationship row, or an ISA assay-row projection. */
export type StudyRow = {
  sourceName: string;
  assayName: string | null;
  dataFile: string | null;
  label: string | null;
  labelKind: LabelKind;
  reporterMz: number | null;
  role: ChannelRole;
  poolMembers: string[];
  tag: CvRef | null;
  fraction: string | null;
  characteristics: Record<string, Cell>;
  factors: Record<string, Cell>;
  matchesThisFile: boolean;
};

export type StudyFactor = { name: string; levels: string[] };

/** One channel→sample assignment, read from the ENCODED projection
 *  (`sample_list` joined on `run_sample_binding`) — the authoritative, run-scoped
 *  source — or derived from matched SDRF rows in the blob-fallback path. */
export type ChannelAssignment = {
  /** MS:1002602 "sample label" value, e.g. "TMT126". */
  channelLabel: string | null;
  reporterMz: number | null;
  /** Producer channel-role value (sample | pooled | reference | carrier | …). */
  role: string | null;
  tag: CvRef | null;
  /** Projection sample_list id (e.g. "sample-70"); null in the blob path. */
  sampleId: string | null;
  /** Source/sample name (e.g. "P1_frac_8_run_2"). */
  sampleName: string | null;
  /** True when bound to the open run via run_sample_binding (or matched file). */
  boundToThisRun: boolean;
};

export type Investigation = {
  accession: string | null;
  title: string | null;
  description: string | null;
  contacts: string[];
  publications: string[];
  protocols: string[];
};

export type HashState = "verified" | "declared" | "mismatch" | "none";

export type StudyProvenance = {
  format: "sdrf" | "isa-tab" | "isa-json";
  sourceUri: string | null;
  embedScope: string | null;
  retrievedAt: string | null;
  sha256: string | null;
  hashState: HashState;
  /** Archive member the blob was read from. */
  member: string | null;
};

export type StudyLabeling = {
  kind: LabelKind;
  /** Nominal reagent plex when known (e.g. 10 for TMT 10-plex), else null. */
  plex: number | null;
  reagent: string | null; // "TMT" | "TMTpro" | "iTRAQ" | "SILAC" | null
};

export type StudyMetadata = {
  format: "sdrf" | "isa-tab" | "isa-json";
  /** Where the summary came from: the encoded projection (preferred) or a parse
   *  of the verbatim blob (fallback for files with no projection). */
  source: "projection" | "blob";
  investigation: Investigation;
  /** Channel→sample assignments (run-scoped); the dedicated channels view. */
  channels: ChannelAssignment[];
  /** The run id from run_sample_binding (projection), else null. */
  runId: string | null;
  rows: StudyRow[];
  factors: StudyFactor[];
  labeling: StudyLabeling;
  /** Three DISTINCT counts — never conflate (review §A-9). */
  counts: { sourceSamples: number; channels: number; dataFiles: number; rows: number };
  biology: { organisms: string[]; tissues: string[]; diseases: string[]; cellTypes: string[] };
  provenance: StudyProvenance;
  diagnostics: string[];
};
