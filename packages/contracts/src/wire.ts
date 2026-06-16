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
  /** Per-MS-level representation breakdown — drives the Summary "MS levels" per-level
   *  mode badge. Optional → backward compatible: older engine output omits it and the
   *  Summary view falls back to count-only rows. Keys are MS levels (numbers), aligned
   *  with `spectraPerLevel`/`msLevels`. */
  representationPerLevel?: Record<number, { profile: number; centroid: number; unknown: number }>;
  instrument?: string | null;
};

/**
 * Per-spectrum browse index — columnar + transferable. The whole Browse list, the
 * MS-level filter, the cheap per-spectrum TIC, and `scan`/`spectrum` deep-link
 * resolution all read this (Phase-3 map, HIGH: it has no other wire carrier; it is
 * NOT derivable from `FileStats` aggregates). Parallel arrays, length = numSpectra;
 * the typed arrays transfer (a 10⁵-spectrum file is ~MBs, never structured-cloned).
 */
export type BrowseIndex = {
  /** Native spectrum id strings (carry the native scan number when present). */
  id: string[];
  /** MS level per spectrum (1, 2, …). */
  msLevel: Int16Array;
  /** Retention time in seconds; NaN where absent. */
  rt: Float32Array;
  /** Per-spectrum total ion current. */
  tic: Float32Array;
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
   * Profile/centroid — the spectrum plot renders centroid as needles + picks top
   * peaks, profile as a filled trace. REQUIRED and nullable (re-review): the engine
   * MUST always set it (`null` = genuinely unknown → plot falls back to profile), so
   * a wire spectrum is structurally assignable to ui-kit's plot input.
   */
  representation: SpectrumRepresentation;
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

/** One column's footer-level metadata (what the Structure tab renders per column). */
export type ParquetColumn = {
  name: string;
  /** Physical parquet type (e.g. INT64, BYTE_ARRAY, DOUBLE). */
  type: string;
  /** Logical/converted type (e.g. STRING, TIMESTAMP), when present. */
  logicalType?: string | null;
  /** Total values across row groups. */
  numValues?: number | null;
  /** Null count, when the footer carries it. */
  nullCount?: number | null;
  /** Compression codec (e.g. SNAPPY, ZSTD, UNCOMPRESSED). */
  codec?: string | null;
  compressedBytes?: number | null;
  uncompressedBytes?: number | null;
  /** Stringified footer min/max, when present. */
  min?: string | null;
  max?: string | null;
  // ── Deep footer stats (Explorer parity), aggregated across row groups ──────
  /** Page encodings used (e.g. ["PLAIN","RLE_DICTIONARY"]). */
  encodings?: string[] | null;
  /** Dictionary-encoded (has a dictionary page)? */
  dictionary?: boolean | null;
  /** Data-page count across row groups (from encoding_stats). */
  dataPages?: number | null;
  /** Dictionary-page count across row groups. */
  dictionaryPages?: number | null;
  /** Distinct count, when the footer carries it. */
  distinctCount?: number | null;
  /** Number of row groups that contain this column. */
  rowGroups?: number | null;
};

/** One row group's footprint — what reveals the monolithic-row-group anti-pattern. */
export type RowGroupSize = {
  /** Rows (= chunks, for the chunked data facet) in this row group. */
  rows: number;
  /** Uncompressed bytes in this row group (the decode cost a single random read pays). */
  bytes: number;
};

/** Parquet footer summary for the Structure tab (Phase-3 map: enriched per-column). */
export type ParquetFooter = {
  archivePath: string;
  numRows: number;
  numRowGroups: number;
  columns: ParquetColumn[];
  /** Writer signature from the footer (e.g. "parquet-mr", "mzpeak-rs"), when present. */
  createdBy?: string | null;
  /** Per-row-group uncompressed size + row count, in file order. Drives the row-group
   *  size distribution + the monolithic-group health badge (a 1×942 MB group reads as an
   *  obvious outlier vs uniform ~25 MB groups). Empty/absent when the footer can't be read. */
  rowGroupSizes?: RowGroupSize[];
  /** Whether the file carries a Parquet page (offset/column) index — i.e. whether a reader
   *  can seek WITHIN a row group to the page(s) for a target spectrum, instead of decoding
   *  the whole group. `null` when undetermined. */
  hasPageIndex?: boolean | null;
};

/**
 * A page of a deeply-read parquet column — actual VALUES for the Structure preview.
 *
 * SPIKE (Phase-3 / review CRITICAL): Explorer today overloads "deepColumn" to return
 * footer STATISTICS and "sampleColumn" to return a numeric HISTOGRAM — neither lines
 * up with paged values here. The Structure/Parquet workerization spike must reconcile
 * the three operations (footer stats → ParquetFooter columns above; paged values →
 * ColumnPage; histogram → ColumnSample.histogram) before the engine implements them.
 */
export type ColumnPage = {
  archivePath: string;
  column: string;
  offset: number;
  /** Stringified cell values for display (the engine renders typed → string). */
  values: Uint8Array; // length-prefixed UTF-8 blob; decoded by the shell adapter
  count: number;
  hasMore: boolean;
};

/** Computed numeric statistics over a column's sampled values. */
export type ColumnStats = {
  /** Numeric values seen in the sample (finite, non-null). */
  count: number;
  /** Nulls/non-numeric skipped in the sampled rows. */
  nulls: number;
  /** Rows actually read for the sample (≤ requested n, ≤ total rows). */
  sampled: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  stddev: number;
  p25: number;
  p75: number;
};

/** A small bounded sample of a column (for Structure previews + numeric histogram). */
export type ColumnSample = {
  archivePath: string;
  column: string;
  preview: string[];
  totalRows: number;
  /** Optional numeric histogram bins (Explorer's sampleColumn output). */
  histogram?: number[] | null;
  /** Min/max of the histogram domain (so the UI can label bin edges). */
  histRange?: [number, number] | null;
  /** Computed numeric stats over the sampled values (null for non-numeric columns). */
  stats?: ColumnStats | null;
};

/** Archive member list for the Structure tab (richer than Manifest). */
export type ArchiveMemberList = {
  members: {
    path: string;
    bytes: number;
    compressedBytes: number;
    isParquet: boolean;
    /** Logical role from mzpeak_index.json (e.g. "spectra_data", "metadata"). */
    kind?: string | null;
    isDirectory?: boolean;
  }[];
};

/** One isobaric (TMT/iTRAQ) channel assignment from the run's sample metadata. */
export type ChannelAssignment = {
  /** Sample-label value (MS:1002602), e.g. "TMT126". */
  channelLabel: string | null;
  /** Reporter-ion m/z (from the file, else resolved from the reagent table). */
  reporterMz: number | null;
  /** Channel role (sample | reference | pooled | carrier | …), when present. */
  role: string | null;
  /** sample_list id, when present. */
  sampleId: string | null;
  /** Source/sample name, when present. */
  sampleName: string | null;
  /** True when bound to the open run via run_sample_binding (else study-wide). */
  boundToThisRun: boolean;
};

/** SDRF/ISA study metadata (Explorer Summary ▸ Study) + resolved isobaric channels. */
export type StudyMeta = {
  sdrf?: unknown;
  isa?: unknown;
  present: boolean;
  /** Resolved isobaric channels for this run (empty for label-free files). */
  channels: ChannelAssignment[];
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
