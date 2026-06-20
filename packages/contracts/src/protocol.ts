// Superset worker protocol — the typed postMessage boundary for @mzpeak/core.
//
// CONTRACT (types only): only serializable/transferable values cross this
// boundary. No Reader, no Arrow Table, no parquet handle, no WASM memory — those
// stay inside the worker. The engine returns plain typed
// arrays / ImageData-like RGBA / plain JSON only.
//
// This union covers both the imaging/worker messages and the data-access messages
// (archiveList, parquetFooter, deepColumn, sampleColumn, scanBreakdown,
//  extractChrom, studyMeta).
//
// Every long-running request carries a `requestId`; the matching response echoes
// it for stale-response rejection and the `cancel` message targets it. The
// per-message clone/transfer/cancellation/paging rules are encoded in
// `MESSAGE_POLICY` below so they are testable, not just prose.

import type {
  Manifest,
  FileMeta,
  FileStats,
  BrowseIndex,
  SpectrumArrays,
  WavelengthSpectrumArrays,
  WavelengthBrowseIndex,
  WavelengthMatrix,
  IonImageStats,
  ImagingGridWire,
  OpticalImageMeta,
  ChromatogramSeries,
  ChromatogramInfo,
  ParquetFooter,
  ColumnPage,
  ColumnSample,
  ArchiveMemberList,
  StudyMeta,
  ReaderErrorClass,
  UnsupportedFinding,
} from "./wire";
import type { CapabilityModel, Presence } from "./capability";

// ---------------------------------------------------------------------------
// Inbound (main thread → worker)
// ---------------------------------------------------------------------------

/** One channel of a multi-channel ion-image overlay. */
export type ChannelRequest = { mz: number; tolDa: number; color?: string };

/**
 * Where a file's bytes come from.
 *  - `url`  : zip.js reads it via HTTP RANGE requests (only metadata + needed pages).
 *  - `file` : a local File/Blob, read LAZILY via zip.js BlobReader (Blob.slice on demand) —
 *             same range-read discipline as `url`, never a whole-file read. The Blob is
 *             structured-cloned BY REFERENCE across the worker boundary (no byte copy), so
 *             even a multi-GB archive opens in metadata-time with no whole-file memory cost.
 */
export type OpenSource =
  | { kind: "url"; url: string }
  | { kind: "file"; blob: Blob; name: string };

/** Chromatogram extraction mode. */
export type ChromRequest =
  | { mode: "tic"; rt?: [number, number] }
  // xic: sum mz ± tolDa per spectrum vs RT. `msLevel` (optional) limits the sum to spectra
  // of that MS level (e.g. a peak picked in an MS2 spectrum → MS2-only XIC); omitted = all.
  | { mode: "xic"; mz: number; tolDa: number; rt?: [number, number]; msLevel?: number }
  | { mode: "xicRange"; mzLo: number; mzHi: number; rt?: [number, number] }
  // DIA fragment XIC: sum mz ± tolDa over the MS2 spectra whose isolation window contains
  // `precursorMz` (one transition per request; the view overlays several).
  | { mode: "diaXic"; precursorMz: number; mz: number; tolDa: number; rt?: [number, number] }
  | { mode: "stored"; id: string };

export type WorkerRequest =
  // --- lifecycle -----------------------------------------------------------
  // open implies close of any prior reader: single open file per session.
  | { type: "open"; requestId: number; source: OpenSource }
  | { type: "close" }
  | { type: "setCacheConfig"; preloadEnabled: boolean; cacheLimitBytes: number }
  // Cancels an in-flight request by id (allows multiple requests in flight).
  | { type: "cancel"; cancelId: number }

  // --- spectra / aggregate browse ------------------------------------------
  // selectId monotonically orders rapid clicks; the worker echoes it.
  | { type: "selectSpectrum"; index: number; selectId: number }
  // Time-sliced aggregate pass: MS-level counts, mz/rt range, browse index.
  | { type: "scanBreakdown"; requestId: number }
  | { type: "meanSpectrum"; requestId: number }
  | { type: "roiSpectrum"; spectrumIndices: number[]; requestId: number }

  // --- UV/VIS wavelength spectra (SEPARATE from MS spectra) -----------------
  // Lazy per-wavelength-spectrum browse index (built on first UV access).
  | { type: "wavelengthBrowse"; requestId: number }
  // Dense time × wavelength matrix (built lazily on first PDA-view access).
  | { type: "wavelengthMatrix"; requestId: number }
  // Select by zero-based ARRAY POSITION; selectId orders rapid clicks (echoed),
  // mirroring selectSpectrum's stale-drop model.
  | { type: "selectWavelengthSpectrum"; index: number; selectId: number }

  // --- chromatograms -------------------------------------------------------
  | { type: "extractChrom"; chrom: ChromRequest; requestId: number }
  // List the file's stored chromatograms + their metadata (Chromatograms view).
  | { type: "chromatogramList"; requestId: number }

  // --- archive / parquet structure (Structure tab) -------------------------
  | { type: "archiveList"; requestId: number }
  | { type: "parquetFooter"; archivePath: string; requestId: number }
  // Paged deep column read; offset/limit page large columns (no 256 MB clone).
  | { type: "deepColumn"; archivePath: string; column: string; offset: number; limit: number; requestId: number }
  | { type: "sampleColumn"; archivePath: string; column: string; n: number; requestId: number }
  // Raw member bytes, capped; the result ArrayBuffer is TRANSFERRED, never cloned.
  | { type: "archiveMemberBytes"; archivePath: string; maxBytes: number; requestId: number }

  // --- study metadata (SDRF/ISA) -------------------------------------------
  | { type: "studyMeta"; requestId: number }

  // --- imaging -------------------------------------------------------------
  | { type: "renderIonImage"; mz: number; tolDa: number; requestId: number }
  | { type: "renderMultiChannel"; channels: (ChannelRequest | null)[]; requestId: number }
  // gen = load generation, echoed so results from a previous file are dropped.
  | { type: "getOpticalImage"; archivePath: string; gen: number; preloadMaxBytes?: number };

// ---------------------------------------------------------------------------
// Outbound (worker → main thread)
// ---------------------------------------------------------------------------

export type WorkerResponse =
  // Posted once after the worker registers onmessage (past WASM top-level await).
  // The main thread buffers requests until this lands so a fast open isn't dropped.
  | { type: "ready" }
  // Unified open result — capabilities drive the whole shell. grid/tic are null
  // for non-imaging files. tic.buffer is TRANSFERRED.
  | {
      type: "opened";
      requestId: number;
      capabilities: CapabilityModel;
      manifest: Manifest;
      fileMeta: FileMeta | null;
      stats: FileStats | null;
      grid: ImagingGridWire | null;
      tic: Float32Array | null;
      opticalImages: OpticalImageMeta[];
      fileSize: number | null;
      mixedRepresentationWarning: string | null;
    }
  // spectrum mz/intensity buffers TRANSFERRED; selectId echoed for ordering.
  | { type: "spectrumResult"; spectrum: SpectrumArrays; selectId: number }
  // stats = aggregates; browse = the per-spectrum columnar index (typed arrays transfer);
  // ticColumn resolves CapabilityModel.chromatograms.ticColumn (was "unknown" at open).
  | { type: "scanBreakdownResult"; requestId: number; stats: FileStats; browse: BrowseIndex; ticColumn: Presence }
  | { type: "meanSpectrumResult"; requestId: number; spectrum: SpectrumArrays }
  // UV/VIS — browse arrays transfer; wavelength/intensity buffers transfer (selectId echoed).
  | { type: "wavelengthBrowseResult"; requestId: number; browse: WavelengthBrowseIndex }
  | { type: "wavelengthMatrixResult"; requestId: number; matrix: WavelengthMatrix }
  | { type: "wavelengthSpectrumResult"; spectrum: WavelengthSpectrumArrays; selectId: number }
  | { type: "chromResult"; requestId: number; series: ChromatogramSeries }
  | { type: "chromatogramListResult"; requestId: number; chromatograms: ChromatogramInfo[] }
  | { type: "archiveListResult"; requestId: number; members: ArchiveMemberList }
  | { type: "parquetFooterResult"; requestId: number; footer: ParquetFooter }
  // Paged: `page.values.buffer` TRANSFERRED; `hasMore` signals further pages.
  | { type: "deepColumnResult"; requestId: number; page: ColumnPage }
  | { type: "sampleColumnResult"; requestId: number; sample: ColumnSample }
  // member bytes TRANSFERRED (up to the request's maxBytes cap).
  | { type: "archiveMemberBytesResult"; requestId: number; archivePath: string; bytes: ArrayBuffer; truncated: boolean }
  | { type: "studyMetaResult"; requestId: number; study: StudyMeta }
  // imaging --------------------------------------------------------------
  // ionImage.buffer TRANSFERRED; stats null when ionImage null.
  | { type: "renderResult"; requestId: number; ionImage: Float32Array | null; stats: IonImageStats | null }
  | { type: "renderProgress"; requestId: number; done: number; total: number }
  // Progressive PREVIEW of a cold ion render: a partial image emitted periodically as the
  // build streams, so the UI shows it filling in (perceived speed). ionImage.buffer TRANSFERRED.
  | { type: "renderPreview"; requestId: number; ionImage: Float32Array; stats: IonImageStats }
  | { type: "multiChannelResult"; requestId: number; channels: (Float32Array | null)[] }
  // Progressive PREVIEW of a cold RGB render: partial channel images (copies) emitted as the
  // single streamed build fills in. Non-null channel buffers TRANSFERRED.
  | { type: "multiChannelPreview"; requestId: number; channels: (Float32Array | null)[] }
  | { type: "ionIndexReady"; points: number }
  // rgba.buffer TRANSFERRED; gen echoed for stale-result rejection.
  | { type: "opticalImageResult"; archivePath: string; gen: number; width: number; height: number; rgba: Uint8ClampedArray }
  | { type: "opticalImageError"; archivePath: string; gen: number; message: string }
  // control --------------------------------------------------------------
  | { type: "cancelled"; cancelId: number }
  // `requestId` correlates a request-failure; `selectId` correlates a selectSpectrum
  // failure (selects are selectId-keyed, not requestId-keyed). Neither set = a global
  // error (e.g. open/WASM init) the client surfaces on its error channel.
  | { type: "error"; requestId?: number; selectId?: number; class: ReaderErrorClass; message: string; findings?: UnsupportedFinding[] };

// ---------------------------------------------------------------------------
// Per-message policy (the machine-readable clone/transfer/cancellation contract)
// ---------------------------------------------------------------------------

export type RequestType = WorkerRequest["type"];

/**
 * Cancellation semantics. "Every long read is abortable" is NOT
 * backed by the underlying readers today: neither mzpeakts path threads an
 * `AbortSignal` into in-flight Parquet/ZIP reads. The honest contract is per-op:
 *  - `abort`     — a true hard stop is possible (AbortController-backed fetch /
 *                  range read); the worker must wire one in and stop work.
 *  - `stale-drop`— no hard stop; the worker runs to a bounded chunk point and the
 *                  result is SUPPRESSED on the main thread by requestId. This is
 *                  a generation-counter model — explicitly NOT a hard
 *                  abort (heavy work may still complete in the worker).
 *  - `none`      — fast/lifecycle; not cancellable.
 * A `stale-drop` op should only be upgraded to `abort` where it actually wires an
 * AbortController; until then the label tells the truth.
 */
export type CancellationMode = "abort" | "stale-drop" | "none";

/**
 * Per-request policy. The engine and adapters MUST honor this:
 *  - `cancellation`: see {@link CancellationMode}.
 *  - `transfersResult`: the response carries a typed array / ArrayBuffer that is
 *    moved via the postMessage transfer list, never structured-cloned.
 *  - `paged`: the request takes offset/limit (or is otherwise chunked) so a large
 *    member never crosses the boundary in one clone.
 *  - `sizeCapBytes`: hard cap on the payload the worker will return for this read.
 */
export type MessagePolicy = {
  cancellation: CancellationMode;
  transfersResult: boolean;
  paged: boolean;
  sizeCapBytes?: number;
};

/** 256 MiB — the archive-member read cap. */
export const MAX_MEMBER_BYTES = 256 * 1024 * 1024;

export const MESSAGE_POLICY: Record<RequestType, MessagePolicy> = {
  // Network-bound opens use an AbortController-backed fetch → true abort.
  open: { cancellation: "abort", transfersResult: true, paged: false },
  close: { cancellation: "none", transfersResult: false, paged: false },
  setCacheConfig: { cancellation: "none", transfersResult: false, paged: false },
  cancel: { cancellation: "none", transfersResult: false, paged: false },
  // Rapid clicks: stale spectra are dropped by selectId, not hard-aborted.
  selectSpectrum: { cancellation: "stale-drop", transfersResult: true, paged: false },
  scanBreakdown: { cancellation: "stale-drop", transfersResult: true, paged: false },
  meanSpectrum: { cancellation: "stale-drop", transfersResult: true, paged: false },
  // UV/VIS — mirror the MS browse/select policies (stale-drop, transfers typed arrays).
  wavelengthBrowse: { cancellation: "stale-drop", transfersResult: true, paged: false },
  wavelengthMatrix: { cancellation: "stale-drop", transfersResult: true, paged: false },
  selectWavelengthSpectrum: { cancellation: "stale-drop", transfersResult: true, paged: false },
  roiSpectrum: { cancellation: "stale-drop", transfersResult: true, paged: false },
  // Chromatogram extraction streams row groups → abortable at chunk boundaries.
  extractChrom: { cancellation: "abort", transfersResult: true, paged: false },
  chromatogramList: { cancellation: "stale-drop", transfersResult: false, paged: false },
  archiveList: { cancellation: "stale-drop", transfersResult: false, paged: false },
  parquetFooter: { cancellation: "stale-drop", transfersResult: false, paged: false },
  deepColumn: { cancellation: "abort", transfersResult: true, paged: true },
  sampleColumn: { cancellation: "stale-drop", transfersResult: true, paged: false },
  archiveMemberBytes: { cancellation: "abort", transfersResult: true, paged: false, sizeCapBytes: MAX_MEMBER_BYTES },
  studyMeta: { cancellation: "stale-drop", transfersResult: false, paged: false },
  // Ion-image renders stream row groups → abortable; multi-channel likewise.
  renderIonImage: { cancellation: "abort", transfersResult: true, paged: false },
  renderMultiChannel: { cancellation: "abort", transfersResult: true, paged: false },
  getOpticalImage: { cancellation: "stale-drop", transfersResult: true, paged: false },
};

/** Narrowing helper for response handling in the adapters. */
export function isErrorResponse(r: WorkerResponse): r is Extract<WorkerResponse, { type: "error" }> {
  return r.type === "error";
}
