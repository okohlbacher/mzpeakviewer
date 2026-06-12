// Typed postMessage protocol for the mzPeakWorker boundary.
//
// CONTRACT: only serializable/transferable types appear here.
// No Reader, no Arrow Table, no mzpeakts internals cross this boundary.
//
// WorkerRequest  — messages posted from the main thread to the Worker.
// WorkerResponse — messages posted from the Worker to the main thread.
//
// All types are pure type/interface declarations — no runtime code in this file.

import type { LoadStage, ManifestEntry, FileMeta, FileStats, Capabilities, UnsupportedFinding, SpectrumArrays } from "../reader/types";
import type { ReaderErrorClass } from "../reader/errors";
import type { ImagingGrid } from "../imaging/types";
import type { OpticalImageMeta } from "../imaging/optical";

// ---------------------------------------------------------------------------
// Inbound (main thread → Worker)
// ---------------------------------------------------------------------------

/** One channel in a multi-channel overlay request (BL-02). */
export type ChannelRequest = {
  /** m/z center in Da */
  mz: number;
  /** half-window in Da */
  tolDa: number;
};

/**
 * Discriminated union of all messages the main thread sends to the Worker.
 *
 * - loadUrl / loadFile: open a file and run the full load pipeline
 *   (ZIP → manifest → metadata → grid → TIC → result)
 * - renderIonImage: extract XIC for a given m/z window and return a Float32Array
 * - selectSpectrum: retrieve the mz/intensity arrays for one spectrum by index
 * - renderMultiChannel: extract XIC for up to 3 channels simultaneously (BL-02)
 * - meanSpectrum: compute the mean spectrum across all pixels (BL-03)
 * - roiSpectrum: compute the mean spectrum for a subset of pixel indices (BL-06)
 *
 * requestId on renderIonImage / renderMultiChannel enables stale-response
 * cancellation on the main thread (Pattern 5 from RESEARCH.md — generation counter).
 */
export type WorkerRequest =
  | { type: "loadUrl"; url: string }
  | { type: "loadFile"; bytes: ArrayBuffer; name: string }
  | { type: "renderIonImage"; mz: number; tolDa: number; requestId: number }
  // selectId monotonically orders rapid clicks; the worker echoes it so the main
  // thread can discard out-of-order / superseded spectrum responses.
  | { type: "selectSpectrum"; index: number; selectId: number }
  // channels is position-aligned (length up to 3); a null entry = disabled
  // channel, so the result images stay aligned to R/G/B positions.
  | { type: "renderMultiChannel"; channels: (ChannelRequest | null)[]; requestId: number }
  | { type: "meanSpectrum" }
  | { type: "roiSpectrum"; spectrumIndices: number[] }
  // ADD-01: lazily decode an embedded optical TIFF (ZIP member) to RGBA. `gen`
  // is the load generation (echoed back) so results from a previous file are
  // dropped rather than cached into the newly-loaded file.
  // preloadMaxBytes (optional): when set, this is a BACKGROUND preload — the worker
  // decodes only if the member's stored size ≤ this cap, else replies
  // opticalImageSkipped (a user-initiated request omits it and decodes up to the
  // hard MAX_OPTICAL_BYTES cap).
  | { type: "getOpticalImage"; archivePath: string; gen: number; preloadMaxBytes?: number }
  // Caching policy from the UI/URL: whether to preload the index in the background,
  // and a hard cache size limit in bytes (0 = automatic / device-aware).
  | { type: "setCacheConfig"; preloadEnabled: boolean; cacheLimitBytes: number };

// ---------------------------------------------------------------------------
// Outbound (Worker → main thread)
// ---------------------------------------------------------------------------

/**
 * Discriminated union of all messages the Worker sends to the main thread.
 *
 * - progress: intermediate stage tick during the load pipeline
 * - loadResult: successful imaging file load — all fields for imaging mode
 * - noImaging: successful non-imaging file load — metadata only, no grid/tic
 * - renderResult: Float32Array of per-pixel intensity values (or null on error);
 *   stats is null when ionImage is null; requestId echoes the request for stale
 *   response detection
 * - spectrumResult: mz/intensity arrays for one spectrum
 * - error: any failure during load, render, or spectrum fetch — carries the
 *   serialized StoreError shape (classifyError runs inside the Worker)
 */
export type WorkerResponse =
  // Posted once, after the Worker's onmessage handler is registered (past the
  // top-level-await WASM init). The main thread buffers load requests until this
  // arrives so a fast load can't be dropped during worker init (see store.ts).
  | { type: "ready" }
  | { type: "progress"; stage: LoadStage }
  | { type: "loadResult"; result: LoadResult }
  | { type: "noImaging"; result: NonImagingResult }
  | {
      type: "renderResult";
      ionImage: Float32Array | null;
      stats: IonImageStats | null;
      requestId: number;
    }
  // Incremental progress while a (potentially slow, network-bound) ion / multi-
  // channel render streams row groups. requestId echoes the originating render so
  // stale progress is ignored.
  | { type: "renderProgress"; requestId: number; done: number; total: number }
  // Posted when an index build commits (fits the budget) — the UI shows a
  // "buffering spectra" hint until ionIndexReady.
  | { type: "ionIndexPreloading" }
  // Posted when a build ends without producing a cache (too big / open failed /
  // superseded) — clears the "buffering" hint.
  | { type: "ionIndexPreloadAborted" }
  // Posted once the in-memory ion-image index finishes building (after the first
  // full data pass). Tells the UI that subsequent ion images are instant + exact.
  | { type: "ionIndexReady"; points: number }
  | { type: "spectrumResult"; spectrum: SpectrumArrays; selectId: number }
  | { type: "multiChannelResult"; channels: (Float32Array | null)[]; requestId: number }
  | { type: "meanSpectrumResult"; spectrum: SpectrumArrays }
  // ADD-01: decoded optical image (native pixel grid, RGBA) or a decode failure.
  // `gen` echoes the request's load generation for stale-result rejection.
  | { type: "opticalImageResult"; archivePath: string; gen: number; width: number; height: number; rgba: Uint8ClampedArray }
  | { type: "opticalImageError"; archivePath: string; gen: number; message: string }
  // A background preload was skipped because the member exceeds the preload cap
  // (or its size is unknown). NOT an error — the image is still decodable on demand.
  | { type: "opticalImageSkipped"; archivePath: string; gen: number }
  | {
      type: "error";
      class: ReaderErrorClass;
      message: string;
      findings?: UnsupportedFinding[];
    };

// ---------------------------------------------------------------------------
// Result payloads
// ---------------------------------------------------------------------------

/**
 * Result object emitted on a successful imaging file load.
 *
 * All fields are plain serializable/transferable values:
 * - manifest, fileMeta, stats, capabilities: plain JSON-safe objects
 * - grid: ImagingGrid — SERIALIZATION NOTE: ImagingGrid contains a
 *   Map<number, number> (coordToSpectrumIndex) and a Uint8Array (presenceMask).
 *   Both survive structured clone (Maps are cloneable; TypedArrays are
 *   cloneable). The Map is deep-cloned (not zero-copy); the presenceMask
 *   Uint8Array is structured-cloned (small, ~35 KB). presenceMask.buffer is
 *   intentionally NOT transferred — the Worker retains a valid presenceMask
 *   for subsequent renderIonImage calls.
 * - tic: Float32Array — transfer tic.buffer zero-copy (Pitfall 2 / Pattern 3)
 * - mixedRepresentationWarning: optional human-readable diagnostic string
 */
/**
 * Fast-path load: manifest and imaging flag are known immediately from
 * mzpeak_index.json (606 bytes). fileMeta, stats, and grid are populated
 * lazily — null until the first renderIonImage call triggers full reader init.
 */
export type LoadResult = {
  manifest: ManifestEntry[];
  fileMeta: FileMeta | null;
  stats: FileStats | null;
  capabilities: Capabilities;
  grid: ImagingGrid | null;
  tic: Float32Array | null;
  mixedRepresentationWarning: string | null;
  /** Total archive size in bytes (zip reader size) — for the File overview. */
  fileSize?: number | null;
  /**
   * ADD-01 / imaging-spec v0.5: descriptive metadata for embedded optical images
   * (TIFF ZIP members), parsed from `metadata.imaging.images[]`. The pixel data
   * is decoded lazily on demand via the getOpticalImage request. [] when none.
   */
  opticalImages?: OpticalImageMeta[];
};

/**
 * Result object emitted on a successful non-imaging file load (D-05 / D-06).
 *
 * No grid, no tic — the file has no spatial coordinates. The main thread sets
 * stage: 'no-imaging' and keeps metadata panel, manifest, and spectrum browser
 * accessible while hiding the TIC/ion-image canvas area.
 */
export type NonImagingResult = {
  manifest: ManifestEntry[];
  fileMeta: FileMeta | null;
  stats: FileStats | null;
  capabilities: Capabilities;
  fileSize?: number | null;
};

/** State for a multi-channel overlay (BL-02). */
export type MultiChannelState = {
  channels: (ChannelRequest | null)[];  // length 3, null = channel disabled
  images: (Float32Array | null)[];      // length 3
};

/**
 * Ion image intensity statistics sent alongside renderResult.
 *
 * Mirrors the ionImageStats field shape in src/state/store.ts so the main
 * thread can spread this directly into the store state update.
 */
export type IonImageStats = {
  nonzeroCount: number;
  min: number;
  max: number;
};
