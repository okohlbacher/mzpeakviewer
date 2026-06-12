// mzPeakWorker.ts — Worker entry point for the mzPeak read-and-compute pipeline.
//
// All mzpeakts/reader imports live HERE only — the Worker boundary is the new
// encapsulation wall. The existing "no mzpeakts outside src/reader/" rule still
// applies; the Worker is part of src/reader's execution context.
//
// The main thread is left stateless with respect to file I/O. The Reader handle
// lives here, never crosses to the main thread.
//
// DO NOT: import from ../state/store, instantiate `new Worker(...)` in this file.

import { ZipStorage } from "mzpeakts";
import { Uint8ArrayWriter, HttpReader } from "@zip.js/zip.js";

// forceRangeRequests: the CDN (data.mzpeak.org) serves correct 206 range responses
// but omits `Accept-Ranges` on them, which makes zip.js throw "HTTP Range not
// supported". Range works (206 + Content-Range), so force it. useRangeHeader makes
// HttpReader behave like the range reader.
const RANGE_OPTS = { useRangeHeader: true, forceRangeRequests: true } as const;
import { ParquetFile, readParquet } from "parquet-wasm";
import { tableFromIPC } from "apache-arrow";
import { buildMiniParquet, type ColChunk } from "./parquetMini";
import { decodeFooter, readParquetFooter } from "./parquetFooter";
import { openReaderFromStore, type Reader } from "../reader/openUrl";
import {
  fileMeta as readFileMeta,
  manifest as readManifest,
  spectrumMeta,
} from "../reader/fileMeta";
import { computeStats, computeCapabilities } from "../reader/stats";
import { getSpectrumArraysFor } from "../reader/arrays";
import { extractCoords, readGridGeometry } from "../reader/scanCoords";
import { buildImagingGrid } from "../imaging/grid";
import { parseOpticalImages, decodeTiff, MAX_OPTICAL_BYTES } from "../imaging/optical";
import { buildIonImage, computeIonImageStats } from "../compute/ionImage";
import { UnsupportedEncodingError } from "../reader/errors";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import type { FileStats, LoadStage, ManifestEntry } from "../reader/types";
import type { ImagingGrid } from "../imaging/types";

// ---------------------------------------------------------------------------
// postMessage helpers
//
// In this tsconfig the DOM lib types `self` as `Window & typeof globalThis`.
// The DOM lib's postMessage overloads are:
//   (message, targetOrigin, transfer?)  ← the "window cross-frame" overload
//   (message, options?)                 ← WindowPostMessageOptions
// Neither matches the Worker's actual runtime signature:
//   (message, transfer: Transferable[]) ← DedicatedWorkerGlobalScope
// We cast through `unknown` to avoid the mismatch without pulling in the
// WebWorker lib (which conflicts with DOM in this single-tsconfig setup).
// ---------------------------------------------------------------------------

type WorkerSelf = { postMessage(message: unknown, transfer?: Transferable[]): void };
const workerSelf = self as unknown as WorkerSelf;

function send(message: WorkerResponse): void {
  workerSelf.postMessage(message);
}

function sendTransfer(message: WorkerResponse, transfer: Transferable[]): void {
  workerSelf.postMessage(message, transfer);
}

// ---------------------------------------------------------------------------
// Module-scope Worker state (Pitfall 5 — NEVER reinitialize inside onmessage)
// These persist across calls so renderIonImage and selectSpectrum can access
// the live Reader handle without the main thread holding any reference to it.
//
// Two-phase lazy loading:
//   Phase 1 (loadUrl/loadFile): ZipStorage only — reads mzpeak_index.json (fast)
//   Phase 2 (first renderIonImage): full MzPeakReader init + grid (user-triggered)
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeZipStorage: ZipStorage<any> | null = null;
// Source URL for the current load (null for local/blob loads). Used to spin up
// INDEPENDENT readers (own HTTP connection each) for parallel row-group reads —
// the object-storage endpoint throttles per-connection, so independent
// connections scale aggregate throughput.
let activeSourceUrl: string | null = null;

/**
 * In-memory EXACT ion-image index, built once on the first ion-image request by
 * a single full pass over spectra_data. Every point that maps onto the grid is
 * flattened into three parallel typed arrays (m/z, pixel, intensity). Subsequent
 * ion images — for ANY m/z window — are an in-memory scan: no network, no Parquet
 * decode, exact (no binning). The read of the data file (the slow, network-bound
 * step) happens exactly once per load instead of once per render.
 */
let activeIonCache: {
  mz: Float64Array;
  pix: Uint16Array | Int32Array;
  inten: Float32Array;
} | null = null;
/** spectrum_index → pixel (grid key), captured when the index is built. Lets the
 *  per-pixel SPECTRUM be served from the same in-memory index (no slow re-read). */
let activeIonCacheSiToPix: Map<number, number> | null = null;
/** Set when the dataset exceeds the cache budget — fall back to per-render streaming. */
let ionCacheTooBig = false;
/**
 * Memory budget for the in-memory index. Per point we store m/z (f64, 8 B — exact,
 * so spectra served from the index match the file) + pixel (u16 when the grid
 * ≤ 65 535 cells, else i32) + intensity (f32, 4 B) ≈ 14 B. Datasets whose point
 * count exceeds this budget stream per render instead (correctness identical).
 */
const MAX_CACHE_BYTES = 900_000_000; // ~900 MB → ~64M points at 14 B/point (auto default)
/** Absolute ceiling on an explicit user-set cache limit, so a typo can't request
 *  an absurd allocation (the build's try/catch still degrades to streaming). */
const ABS_MAX_CACHE_BYTES = 4_000_000_000; // 4 GB
// Bumped on every runFastLoad. Async background work (the deferred buildGridFast
// loadResult) captures the value at start and refuses to post once superseded by
// a newer load, so a slow background grid can't bleed into a freshly opened file
// (Codex r4-#2).
let loadSeq = 0;
let activeReader: Reader | null = null;
let activeStats: FileStats | null = null;
let activeGrid: ImagingGrid | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Small await so staged-progress transitions are observable in the UI rather
 * than collapsing into a single synchronous frame (LOAD-03).
 * setTimeout is available in Workers; requestAnimationFrame is NOT.
 */
const yieldFrame = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Emit a progress stage tick to the main thread.
 * The main thread onmessage handler routes this to useStore.setState({ stage }).
 */
function postProgress(stage: LoadStage): void {
  send({ type: "progress", stage });
}

/**
 * Serialize the thrown error and send it to the main thread.
 * Error instances cannot cross the Worker boundary via structured clone with
 * reliable instanceof checks — emit a plain discriminated object instead.
 * Replicates the classifyError logic from store.ts lines 49-61.
 */
function postError(err: unknown): void {
  if (err instanceof UnsupportedEncodingError) {
    send({
      type: "error",
      class: "unsupported-encoding",
      message: err.message,
      findings: err.findings,
    });
  } else {
    const message = err instanceof Error ? err.message : String(err);
    // A failed cross-origin/Range fetch surfaces as a TypeError "Failed to fetch"
    // (Chrome) / "NetworkError"/"Load failed" (Firefox/Safari) — it's a network or
    // CORS problem, NOT a corrupt file. Classify it so the UI can guide the user.
    const isNetwork =
      err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message);
    send({
      type: "error",
      class: isNetwork ? "network" : "corrupt",
      message,
    });
  }
}

// ---------------------------------------------------------------------------
// Fast-path load — reads ONLY mzpeak_index.json (606 bytes)
// ---------------------------------------------------------------------------

/**
 * Extract a ManifestEntry array from ZipStorage.fileIndex.
 * The fileIndex is populated by ZipStorage.fromUrl/fromBlob (fast path — no
 * Parquet data read). entityType and dataKind are enum strings, compatible
 * with our plain-string ManifestEntry type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function manifestFromStore(store: ZipStorage<any>): ManifestEntry[] {
  return store.fileIndex.files.map(
    (f: { name: string; entityType: string; dataKind: string }) => ({
      name: f.name,
      entityType: f.entityType,
      dataKind: f.dataKind,
    }),
  );
}

/**
 * Open the spectra "data arrays" Parquet member of the active archive as a
 * ParquetFile, or null when the archive/member is unavailable. Shared by every
 * point-layout read (ion image, multi-channel, per-pixel + ROI spectra).
 */
async function openSpectraDataParquet(): Promise<ParquetFile | null> {
  if (!activeZipStorage) return null;
  const entry = activeZipStorage.fileIndex.files.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f: any) => f.entityType === "spectrum" && f.dataKind === "data arrays",
  );
  if (!entry) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await activeZipStorage.open((entry as any).name);
  if (!blob) return null;
  return ParquetFile.fromFile(blob as unknown as Blob);
}

/**
 * Like openSpectraDataParquet, but for URL sources it builds a FRESH ZipStorage
 * (its own HttpRangeReader = its own HTTP connection). The endpoint throttles
 * per-connection (~0.65 MB/s) while aggregate scales with connections, so giving
 * each parallel row-group reader an independent connection scales throughput.
 * Local/blob sources reuse the shared in-memory reader (no connection to scale).
 */
async function openIndependentSpectraParquet(): Promise<ParquetFile | null> {
  if (!activeSourceUrl) return openSpectraDataParquet(); // local: in-memory
  try {
    const store = new ZipStorage(new HttpReader(activeSourceUrl, RANGE_OPTS));
    await store.init();
    const entry = store.fileIndex.files.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f: any) => f.entityType === "spectrum" && f.dataKind === "data arrays",
    );
    if (!entry) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blob = await store.open((entry as any).name);
    if (!blob) return null;
    return ParquetFile.fromFile(blob as unknown as Blob);
  } catch {
    return null;
  }
}

/**
 * Extract the `point.{spectrum_index,mz,intensity}` Arrow child vectors from a
 * row-group table, or null when the table is malformed / missing a column.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pointVecs(table: any): { si: any; mz: any; inten: any } | null {
  const p = table.getChild("point");
  const si = p?.getChild("spectrum_index");
  const mz = p?.getChild("mz");
  const inten = p?.getChild("intensity");
  return si && mz && inten ? { si, mz, inten } : null;
}

/**
 * Fast load: opens the ZIP and reads ONLY mzpeak_index.json (~600 bytes).
 * No Parquet data is read. Emits loadResult immediately with manifest +
 * capabilities.isImaging; fileMeta/stats/grid/tic are all null (lazy).
 *
 * For imaging files: the main thread shows the controls panel and waits for
 * the user to click "Show Ion Image" before any heavy Parquet work happens.
 *
 * For non-imaging files: emits noImaging immediately so the user sees the
 * metadata/spectrum browser; the full reader is initialized lazily on the
 * first selectSpectrum call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runFastLoad(store: ZipStorage<any>): Promise<void> {
  const mySeq = ++loadSeq; // capture this load's generation for async self-guards
  const manifest = manifestFromStore(store);
  const isImaging = store.fileIndex.metadata?.imaging?.is_imaging === true;
  // Total .mzpeak size — the zip Reader knows it (URL: HEAD/Content-Range; local:
  // blob size). Surfaced in the File overview.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileSize = (typeof (store.reader as any)?.size === "number"
    ? (store.reader as any).size
    : null) as number | null;

  // Minimal capabilities from the manifest — layout/encodings unknown until
  // full reader init, which is deferred to the first renderIonImage call.
  const capabilities = {
    isImaging,
    layout: "point" as const,  // assume point; corrected on full init
    encodings: [] as string[],
    unsupported: [] as { code: string; label: string }[],
  };

  postProgress("manifest");
  await yieldFrame();
  postProgress("metadata");
  await yieldFrame();

  if (!isImaging) {
    // Send the manifest immediately (fast — index only) so the UI is responsive,
    // then background-init the full reader to populate fileMeta + stats +
    // capabilities. For a non-imaging file there is no deferred "render ion
    // image" trigger, so the inspection panels would otherwise stay empty — the
    // user just wants to browse metadata + spectra right away. The store's
    // noImaging handler MERGES, so this second message fills in the details.
    send({ type: "noImaging", result: { manifest, fileMeta: null, stats: null, capabilities, fileSize } });
    void (async () => {
      if (!activeZipStorage) return;
      try {
        const reader = await openReaderFromStore(activeZipStorage);
        const manifestEntries = readManifest(reader);
        const fileMeta = readFileMeta(reader);
        const stats = computeStats(reader, manifestEntries);
        const fullCaps = computeCapabilities(reader, manifestEntries);
        if (mySeq !== loadSeq) return; // superseded by a newer load
        activeReader = reader;
        activeStats = stats;
        send({
          type: "noImaging",
          result: {
            manifest: manifestEntries,
            fileMeta,
            stats,
            capabilities: { ...fullCaps, isImaging: false },
            fileSize,
          },
        });
      } catch (e) {
        console.warn("[runFastLoad] non-imaging full metadata load failed:", e);
      }
    })();
    return;
  }

  // ADD-01: parse embedded optical-image metadata from the index JSON (cheap —
  // already in memory). Pixel data is decoded lazily via getOpticalImage.
  const opticalImages = parseOpticalImages(store.fileIndex.metadata?.imaging);

  // Imaging: send lightweight loadResult immediately, then kick off buildGridFast
  // in the background to populate grid+TIC+stats without waiting for user click.
  send({
    type: "loadResult",
    result: {
      manifest,
      fileMeta: null,
      stats: null,
      capabilities,
      grid: null,
      tic: null,
      mixedRepresentationWarning: null,
      opticalImages,
      fileSize,
    },
  });

  // Background: build grid + TIC from metadata Parquet column chunks (~650 KB fetch).
  // When complete, sends a second loadResult with grid+tic+stats so the TIC
  // image appears automatically without the user clicking "Show Ion Image".
  buildGridFast().then((result) => {
    if (mySeq !== loadSeq) return; // superseded by a newer load — drop stale grid
    if (!result || !activeZipStorage) return;
    const tic: Float32Array | null = result.tic ?? null;
    const transferList: Transferable[] = [];
    if (tic) transferList.push(tic.buffer);
    sendTransfer({
      type: "loadResult",
      result: {
        manifest: manifestFromStore(activeZipStorage),
        fileMeta: null,
        stats: result.stats,
        capabilities,
        grid: result.grid,
        tic,
        mixedRepresentationWarning: null,
      },
    }, transferList);

    // TIC overview is now up → proactively buffer the spectra in the background
    // (if the index fits the device-aware memory budget) so pixel spectra and ion
    // images are instant when the user gets to them.
    maybePreloadIonIndex(mySeq);
  }).catch((e) => console.warn("[runFastLoad] background buildGridFast failed:", e));
}

// ---------------------------------------------------------------------------
// Fast grid build — direct Parquet column chunk reads (~188 KB total)
// ---------------------------------------------------------------------------

async function buildGridFast(): Promise<{ grid: ImagingGrid; stats: FileStats; tic: Float32Array | null } | null> {
  if (!activeZipStorage) { return null; }
  try {
    // BUG FIX: spectrumMetadata() returns ParquetFile (not RemoteBlob).
    // Use open(name) to get the actual RemoteBlob with .start/.size properties.
    const metaEntry = activeZipStorage.fileIndex.files.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f: any) => f.entityType === "spectrum" && f.dataKind === "metadata",
    );
    if (!metaEntry) { return null; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metaBlob = await activeZipStorage.open((metaEntry as any).name);
    if (!metaBlob) { return null; }

    // Use RemoteBlob.slice().arrayBuffer() directly — works for both URL and
    // local file loads (HttpRangeReader and BlobReader respectively).
    const blobLike = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      size: (metaBlob as any).size as number,
      slice: (s: number, e: number) => ({
        arrayBuffer: async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const slice = (metaBlob as any).slice(s, e);
          const buf = await slice.arrayBuffer() as ArrayBuffer;
          return buf;
        },
      }),
    };

    const footerBytes = await readParquetFooter(blobLike);
    const colInfoMap = decodeFooter(footerBytes);

    const targetPaths = [
      ["scan", "IMS_1000050_position_x"],
      ["scan", "IMS_1000051_position_y"],
      ["spectrum", "MS_1000285_total_ion_current_unit_MS_1000131"],
      ["spectrum", "MS_1000527_highest_observed_mz_unit_MS_1000040"],
      ["spectrum", "MS_1000528_lowest_observed_mz_unit_MS_1000040"],
    ];
    const pathTypes: Record<string, number> = {
      "scan.IMS_1000050_position_x": 2,
      "scan.IMS_1000051_position_y": 2,
      "spectrum.MS_1000285_total_ion_current_unit_MS_1000131": 4,
      "spectrum.MS_1000527_highest_observed_mz_unit_MS_1000040": 5,
      "spectrum.MS_1000528_lowest_observed_mz_unit_MS_1000040": 5,
    };

    // Fetch one column's compressed chunk by schema path, or null when absent.
    const fetchChunk = async (path: string[]): Promise<ColChunk | null> => {
      const dotPath = path.join(".");
      const colInfo = colInfoMap.get(dotPath);
      if (!colInfo) return null;
      const fetchStart = colInfo.dictPageOffset > 0
        ? Math.min(colInfo.dictPageOffset, colInfo.dataPageOffset)
        : colInfo.dataPageOffset;
      const dataPageOffsetInChunk = colInfo.dataPageOffset - fetchStart;
      const buf = await blobLike.slice(fetchStart, fetchStart + colInfo.compressedSize).arrayBuffer();
      // Use type/codec/encodings from footer — don't hardcode.
      const enc = colInfo.encodings.length > 0
        ? colInfo.encodings
        : (colInfo.dictPageOffset > 0 ? [0, 3, 8] : [0, 3]);
      return {
        path,
        parquetType: colInfo.parquetType > 0 ? colInfo.parquetType : (pathTypes[dotPath] ?? 5),
        codec: colInfo.codec,
        encodings: enc,
        data: new Uint8Array(buf),
        numValues: colInfo.numValues || 0,
        uncompressedSize: colInfo.uncompressedSize,
        dataPageOffsetInChunk,
      };
    };

    const chunks: ColChunk[] = [];
    for (const path of targetPaths) {
      const c = await fetchChunk(path);
      if (c) chunks.push(c);
    }
    if (chunks.length < 2) { return null; }

    const totalRows = chunks[0].numValues;
    const miniParquet = buildMiniParquet(chunks, totalRows);
    const rawTable = readParquet(miniParquet);
    const table = tableFromIPC(rawTable.intoIPCStream());

    const nRows = table.numRows;
    if (nRows === 0) { return null; }

    const xArr: number[] = new Array(nRows);
    const yArr: number[] = new Array(nRows);
    const ticArr: number[] = new Array(nRows);
    let globalMinMz = Infinity, globalMaxMz = -Infinity;
    for (let r = 0; r < nRows; r++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = table.get(r) as any;
      const scan = row?.scan; const spec = row?.spectrum;
      xArr[r] = Number(scan?.IMS_1000050_position_x ?? 0);
      yArr[r] = Number(scan?.IMS_1000051_position_y ?? 0);
      ticArr[r] = Number(spec?.MS_1000285_total_ion_current_unit_MS_1000131 ?? 0);
      const lo = Number(spec?.MS_1000528_lowest_observed_mz_unit_MS_1000040 ?? 0);
      const hi = Number(spec?.MS_1000527_highest_observed_mz_unit_MS_1000040 ?? 0);
      if (lo > 0 && lo < globalMinMz) globalMinMz = lo;
      if (hi > globalMaxMz) globalMaxMz = hi;
    }

    // spectrumIndices[r] = the joined spectrum index for scan row r (Pattern 1).
    // Default to row order, then override from the source_index column when it can
    // be read — scan rows are NOT guaranteed in spectrum order (Codex r4-#1). The
    // read is ISOLATED in its own mini-Parquet + try/catch so any decode issue
    // falls back to row order rather than breaking the whole grid build.
    const spectrumIndices = Array.from({ length: nRows }, (_, i) => i);
    try {
      const siChunk = await fetchChunk(["scan", "source_index"]);
      if (siChunk && siChunk.numValues >= nRows) {
        const siTable = tableFromIPC(
          readParquet(buildMiniParquet([siChunk], siChunk.numValues)).intoIPCStream(),
        );
        const mapped: number[] = new Array(nRows);
        let ok = siTable.numRows >= nRows;
        for (let r = 0; ok && r < nRows; r++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = siTable.get(r) as any;
          const n = Number(row?.scan?.source_index ?? row?.source_index);
          if (Number.isFinite(n) && n >= 0) mapped[r] = n;
          else ok = false;
        }
        if (ok) for (let r = 0; r < nRows; r++) spectrumIndices[r] = mapped[r];
      }
    } catch {
      /* keep row-order fallback */
    }

    const coords = xArr.map((x, i) => ({ x, y: yArr[i] }));
    // Read geometry from fileIndex.metadata.imaging (coordinate_base, pixel counts).
    // Accept both the nested `pixel_count: {x,y}` discovery-block form (used by the
    // full reader + tests) and the legacy flat pixel_count_x/y (Codex r4-#4).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imgMeta = (activeZipStorage?.fileIndex?.metadata?.imaging ?? {}) as any;
    const pc = imgMeta?.pixel_count;
    const pcX = Number(pc?.x ?? imgMeta?.pixel_count_x);
    const pcY = Number(pc?.y ?? imgMeta?.pixel_count_y);
    const geometry = imgMeta ? {
      pixelCount:
        Number.isFinite(pcX) && Number.isFinite(pcY) && pcX > 0 && pcY > 0
          ? { x: pcX, y: pcY }
          : null,
      pixelSizeUm: null,
      coordinateBase: (imgMeta.coordinate_base as number) ?? 1,
      geometrySource: "discovery-block" as const,
    } : null;
    const grid = buildImagingGrid(coords, spectrumIndices, geometry, "promoted-columns");
    if (!grid) { return null; }

    const base = grid.coordinateBase ?? 1;
    const tic = new Float32Array(grid.width * grid.height);
    for (let i = 0; i < nRows; i++) {
      const x0 = xArr[i] - base, y0 = yArr[i] - base;
      const key = y0 * grid.width + x0;
      if (key >= 0 && key < tic.length) tic[key] = ticArr[i];
    }

    const stats: FileStats = {
      numSpectra: nRows, numEntities: nRows,
      mzRange: Number.isFinite(globalMinMz) ? [globalMinMz, globalMaxMz] : null,
      msLevels: [1],
      spectraPerLevel: { 1: nRows }, // imaging fast path is MS1-per-pixel
      representationCounts: { profile: 0, centroid: nRows },
    };

    activeGrid = grid;
    activeStats = stats;  // set so fast render path has access to representationCounts
    return { grid, stats, tic };
  } catch (e) {
    const errMsg = e instanceof Error ? `${e.name}: ${e.message}
${(e as Error).stack?.split("\n").slice(0,3).join(" | ")}` : String(e);
    console.error("[BGF] EXCEPTION:", errMsg);
    send({ type: "error", class: "corrupt", message: `[buildGridFast] ${errMsg}` });
    return null;
  }
}


// ---------------------------------------------------------------------------
// Lazy full-reader init — triggered by first renderIonImage / selectSpectrum
// ---------------------------------------------------------------------------

/**
 * Initialize the full MzPeakReader from the cached ZipStorage and build the
 * imaging grid. This is the slow step (reads spectra_metadata.parquet).
 * Called lazily on the first renderIonImage message.
 *
 * Posts a 'grid' progress tick so the UI shows a loading state.
 * Returns false and posts an error if initialization fails.
 */
async function initReaderAndGrid(): Promise<boolean> {
  if (!activeZipStorage) return false;

  postProgress("grid");
  await yieldFrame();

  try {
    // This reads spectra_metadata.parquet fully — the slow step (~553 MB for HR2MSI).
    const reader = await openReaderFromStore(activeZipStorage);
    const manifestEntries = readManifest(reader);
    const fileMeta = readFileMeta(reader);
    const stats = computeStats(reader, manifestEntries);
    const capabilities = computeCapabilities(reader, manifestEntries);

    const cr = extractCoords(reader);
    const geometry = readGridGeometry(reader);
    const grid = cr
      ? buildImagingGrid(cr.coords, cr.spectrumIndices, geometry, cr.strategy)
      : null;

    if (grid === null) {
      postError(
        new Error(
          "Imaging file detected but spatial pixel grid could not be reconstructed. " +
            "The coordinate columns may be empty or malformed.",
        ),
      );
      return false;
    }

    activeReader = reader;
    activeStats = stats;
    activeGrid = grid;

    // Send updated metadata/stats now that the full reader is ready.
    send({
      type: "loadResult",
      result: {
        manifest: manifestEntries,
        fileMeta,
        stats,
        capabilities,
        grid,
        tic: null,
        mixedRepresentationWarning: null,
      },
    });

    return true;
  } catch (err) {
    postError(err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Fast XIC — compute ion image directly from spectra_data.parquet
// ---------------------------------------------------------------------------

/**
 * Compute an XIC ion image from spectra_data.parquet WITHOUT reading the
 * 553 MB spectra_metadata.parquet or initializing the full MzPeakReader.
 *
 * spectra_data.parquet is only 208 KB compressed (39 row groups, ~5 KB each).
 * Each row: point.spectrum_index, point.mz, point.intensity.
 *
 * Algorithm:
 *   For each row group (processed one at a time, ~20 MB uncompressed):
 *     - Filter rows where mzStart ≤ mz ≤ mzEnd
 *     - Accumulate intensity per spectrum_index into a Float32Array
 *   Map spectrum_index → grid cell via activeGrid.coordToSpectrumIndex
 *   Return the ion image Float32Array.
 *
 * Total data read: 208 KB (vs 553 MB for full reader init). ~10-30× faster.
 */
/**
 * How many independent reader handles overlap row-group fetches (network-bound).
 * Build-configurable via VITE_RG_CONCURRENCY for tuning/benchmarking; defaults to
 * 4 (the proven value — higher gave no live gain, see commit history).
 */
const RG_CONCURRENCY = Math.max(1, Number(import.meta.env.VITE_RG_CONCURRENCY) || 8);

/**
 * Stream every row group of spectra_data.parquet, invoking `onTable` for each.
 *
 * The remote read is network-bound, and reading row groups serially leaves the
 * link idle between fetches. We open several INDEPENDENT ParquetFile handles and
 * stripe the row groups across them, so up to RG_CONCURRENCY fetches are in flight
 * at once. JS is single-threaded, so the wasm decode + your synchronous `onTable`
 * accumulation never actually overlap — only the network fetches do — which keeps
 * shared-accumulator updates race-free. Posts renderProgress per processed group.
 *
 * @returns false when the data file can't be opened.
 */
async function forEachSpectraRowGroup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onTable: (table: any) => void,
  requestId?: number,
): Promise<boolean> {
  const probe = await openIndependentSpectraParquet();
  if (!probe) return false;
  const nRG = probe.metadata().numRowGroups();
  const conc = Math.max(1, Math.min(RG_CONCURRENCY, nRG));
  const extra = await Promise.all(
    Array.from({ length: conc - 1 }, () => openIndependentSpectraParquet()),
  );
  const handles = [probe, ...extra].filter((p): p is NonNullable<typeof probe> => !!p);

  let done = 0;
  await Promise.all(
    handles.map(async (pf, w) => {
      for (let rg = w; rg < nRG; rg += handles.length) {
        const table = tableFromIPC((await pf.read({ rowGroups: [rg] })).intoIPCStream());
        onTable(table); // synchronous → race-free against the other handles
        done++;
        if (requestId !== undefined)
          send({ type: "renderProgress", requestId, done, total: nRG });
      }
    }),
  );
  return true;
}

/**
 * Build the in-memory ion-image index with ONE full pass over spectra_data.
 * Returns true if the index is ready (already built, or built now); false if the
 * dataset is too large to cache (caller should stream per render instead).
 *
 * The point→pixel map is precomputed by inverting the grid's coord→spectrum_index
 * map; points whose spectrum isn't on the grid are skipped. Sizing is read from
 * Parquet metadata FIRST (cheap, no data read) so over-budget files never trigger
 * a wasted streaming pass here.
 */
// User/URL-configurable caching policy (set via the setCacheConfig message; see
// the store + SettingsView). cfgCacheLimitBytes === 0 means "auto" (device-aware).
let cfgPreloadEnabled = true;
let cfgCacheLimitBytes = 0;

/**
 * Effective cache budget in bytes. If the user pinned an explicit limit it wins
 * (bounded by a sane absolute ceiling); otherwise it's the smaller of the hard cap
 * and a fraction of device RAM. navigator.deviceMemory (GiB, Chromium; capped at 8
 * for privacy) lets us be conservative on low-memory devices: a 2 GB machine gets
 * ~400 MB, an 8 GB+ machine the full cap.
 */
function cacheBudgetBytes(): number {
  if (cfgCacheLimitBytes > 0) {
    return Math.min(cfgCacheLimitBytes, ABS_MAX_CACHE_BYTES); // explicit user limit
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dm = (self.navigator as any)?.deviceMemory;
  if (typeof dm === "number" && dm > 0) {
    return Math.min(MAX_CACHE_BYTES, Math.floor(dm * 1e9 * 0.2)); // ≤ 20% of RAM
  }
  return MAX_CACHE_BYTES;
}

// Single-flight guard: the background preload and an on-demand render must never
// build the index twice. A second caller joins the in-flight build's promise.
let ionCacheBuildPromise: Promise<boolean> | null = null;

function tryBuildIonCache(requestId?: number): Promise<boolean> {
  if (activeIonCache) return Promise.resolve(true);
  if (ionCacheTooBig || !activeGrid) return Promise.resolve(false);
  if (ionCacheBuildPromise) return ionCacheBuildPromise; // join in-flight build
  ionCacheBuildPromise = buildIonCacheInner(requestId)
    .then((ok) => {
      // Clear any "buffering" hint if the build didn't produce a cache (too big,
      // open failed, or superseded). Idempotent — a no-op if never shown.
      if (!ok) send({ type: "ionIndexPreloadAborted" });
      return ok;
    })
    .finally(() => {
      ionCacheBuildPromise = null;
    });
  return ionCacheBuildPromise;
}

async function buildIonCacheInner(requestId?: number): Promise<boolean> {
  if (activeIonCache) return true;
  if (ionCacheTooBig || !activeGrid) return false;
  const mySeq = loadSeq; // abort if a newer file load supersedes this build

  const probe = await openIndependentSpectraParquet();
  if (!probe) return false;
  const meta = probe.metadata();
  let nPoints = 0;
  const nRG = meta.numRowGroups();
  for (let rg = 0; rg < nRG; rg++) nPoints += meta.rowGroup(rg).numRows();

  // Pixel index fits in u16 when the grid has ≤ 65 535 cells (the usual case);
  // otherwise fall back to i32. Per-point bytes = 8 (m/z f64) + (2|4) (pixel) + 4 (int).
  const nPix = activeGrid.width * activeGrid.height;
  const useU16 = nPix <= 0xffff;
  const bytesPerPoint = 8 + (useU16 ? 2 : 4) + 4;
  // HARD SIZE LIMIT: never build an index larger than the (device-aware) budget.
  // nPoints is the total row count (an upper bound on on-grid points), read cheaply
  // from metadata so an over-budget file never allocates anything — it streams.
  if (!Number.isFinite(nPoints) || nPoints <= 0 || nPoints * bytesPerPoint > cacheBudgetBytes()) {
    ionCacheTooBig = true;
    return false;
  }

  // Pre-allocate the index arrays ONCE at the budget-bounded size and fill them
  // directly with a running write offset (no per-row-group chunks, no concat) so
  // peak memory equals the final index — not ~2× it. If even this allocation
  // fails on a memory-constrained device, degrade gracefully to streaming.
  let mzBuf: Float64Array;
  let pixBuf: Uint16Array | Int32Array;
  let inBuf: Float32Array;
  try {
    mzBuf = new Float64Array(nPoints);
    pixBuf = useU16 ? new Uint16Array(nPoints) : new Int32Array(nPoints);
    inBuf = new Float32Array(nPoints);
  } catch {
    ionCacheTooBig = true; // can't allocate the index — stream per render instead
    return false;
  }

  // Committed to building (fits budget + allocated) → announce the buffering so
  // the UI can show the "buffering spectra…" hint. Cleared by ionIndexReady (done)
  // or ionIndexPreloadAborted (see tryBuildIonCache) on failure/supersede.
  send({ type: "ionIndexPreloading" });

  // Invert grid: spectrum_index -> pixel (grid key).
  const siToPix = new Map<number, number>();
  for (const [gridKey, si] of activeGrid.coordToSpectrumIndex) siToPix.set(si, gridKey);

  let w = 0; // write cursor; w never exceeds nPoints (on-grid points ≤ total)
  const ok = await forEachSpectraRowGroup((table) => {
    const v = pointVecs(table);
    if (!v) return;
    const mzArr = v.mz.toArray() as ArrayLike<number>;
    const siArr = v.si.toArray() as ArrayLike<number | bigint>;
    const inArr = v.inten.toArray() as ArrayLike<number>;
    const n = mzArr.length;
    for (let r = 0; r < n; r++) {
      const pix = siToPix.get(Number(siArr[r]));
      if (pix === undefined) continue; // point's spectrum is off-grid
      if (w >= nPoints) break; // hard guard: never write past the allocation
      mzBuf[w] = mzArr[r] as number;
      pixBuf[w] = pix;
      inBuf[w] = inArr[r] as number;
      w++;
    }
  }, requestId);
  if (!ok) return false;
  if (mySeq !== loadSeq) return false; // a newer load superseded us — don't commit

  // subarray() returns a view (no copy); on-grid points are usually ≈ all points,
  // so the unused tail (if any) is negligible and still within budget.
  activeIonCache = {
    mz: mzBuf.subarray(0, w),
    pix: pixBuf.subarray(0, w),
    inten: inBuf.subarray(0, w),
  };
  activeIonCacheSiToPix = siToPix; // enables instant per-pixel spectra
  send({ type: "ionIndexReady", points: w });
  return true;
}

/**
 * Background preload: once the TIC overview is up, proactively build the in-memory
 * index (streaming spectra_data) IF it fits the device-aware memory budget — so by
 * the time the user clicks a pixel or requests an ion image, it's already buffered.
 * Fire-and-forget; single-flighted with on-demand builds; no render-progress spam
 * (no requestId). Guarded by loadSeq so a superseded load aborts. Emits
 * ionIndexPreloading at start so the UI can show an unobtrusive "buffering" hint.
 */
function maybePreloadIonIndex(mySeq: number): void {
  if (!cfgPreloadEnabled) return; // background preload disabled by the user
  if (mySeq !== loadSeq) return; // superseded
  if (!activeGrid || activeIonCache || ionCacheTooBig || ionCacheBuildPromise) return;
  void tryBuildIonCache(); // no requestId → silent background build (emits its own
  // ionIndexPreloading once it commits to building, so a too-small budget can't
  // leave a stuck "buffering" hint).
}

/**
 * Serve one pixel's spectrum directly from the in-memory index — exact m/z (f64),
 * no network, no Parquet decode. Returns false if the index isn't built or the
 * spectrum_index isn't on the grid (caller falls back to readFastSpectrum).
 */
function spectrumFromCache(index: number, selectId: number): boolean {
  if (!activeIonCache || !activeIonCacheSiToPix) return false;
  const pixel = activeIonCacheSiToPix.get(index);
  if (pixel === undefined) return false;

  const { mz, pix, inten } = activeIonCache;
  // Collect this pixel's points, then sort by m/z for the plot.
  const idxs: number[] = [];
  for (let i = 0; i < pix.length; i++) if (pix[i] === pixel) idxs.push(i);
  if (idxs.length === 0) return false;
  idxs.sort((a, b) => mz[a] - mz[b]);

  const mzArr = new Float64Array(idxs.length);
  const intArr = new Float32Array(idxs.length);
  for (let k = 0; k < idxs.length; k++) {
    mzArr[k] = mz[idxs[k]];
    intArr[k] = inten[idxs[k]];
  }
  sendTransfer(
    { type: "spectrumResult", spectrum: { index, id: `scan=${index + 1}`, mz: mzArr, intensity: intArr }, selectId },
    [mzArr.buffer, intArr.buffer],
  );
  return true;
}

/** Exact ion image for one window, scanned from the in-memory index. */
function ionImageFromCache(mzStart: number, mzEnd: number): Float32Array {
  const { mz, pix, inten } = activeIonCache!;
  const img = new Float32Array(activeGrid!.width * activeGrid!.height);
  for (let i = 0; i < mz.length; i++) {
    const m = mz[i];
    if (m < mzStart || m > mzEnd) continue;
    img[pix[i]] += inten[i];
  }
  return img;
}

/** Exact multi-channel ion images, single scan of the in-memory index. */
function multiIonImagesFromCache(
  windows: ({ start: number; end: number } | null)[],
): (Float32Array | null)[] {
  const { mz, pix, inten } = activeIonCache!;
  const nPix = activeGrid!.width * activeGrid!.height;
  const imgs = windows.map((w) => (w ? new Float32Array(nPix) : null));
  for (let i = 0; i < mz.length; i++) {
    const m = mz[i];
    const p = pix[i];
    const val = inten[i];
    for (let c = 0; c < windows.length; c++) {
      const w = windows[c];
      if (!w || m < w.start || m > w.end) continue;
      imgs[c]![p] += val;
    }
  }
  return imgs;
}

async function computeIonImageFast(
  mzStart: number,
  mzEnd: number,
  requestId?: number,
): Promise<Float32Array | null> {
  if (!activeZipStorage || !activeGrid) return null;

  // Fast path: the in-memory index serves any window instantly + exactly. The
  // first request builds it (one full pass); later requests are cache hits.
  if (await tryBuildIonCache(requestId)) return ionImageFromCache(mzStart, mzEnd);

  // Fallback (dataset too large to cache): stream per render as before.
  // Accumulate intensity sums per spectrum_index across all row groups.
  // Use a Map for sparse accumulation (most spectra may have 0 signal in range).
  const intensitySum = new Map<number, number>();

  const ok = await forEachSpectraRowGroup((table) => {
    const v = pointVecs(table);
    if (!v) return;
    // Vectorized: pull each column as a typed array and index it directly —
    // per-element vec.get(r) over millions of points was the CPU bottleneck.
    const mzArr = v.mz.toArray() as ArrayLike<number>;
    const siArr = v.si.toArray() as ArrayLike<number | bigint>;
    const inArr = v.inten.toArray() as ArrayLike<number>;
    const nRows = mzArr.length;
    for (let r = 0; r < nRows; r++) {
      const mz = mzArr[r] as number;
      if (mz < mzStart || mz > mzEnd) continue;
      const si = Number(siArr[r]);
      intensitySum.set(si, (intensitySum.get(si) ?? 0) + (inArr[r] as number));
    }
  }, requestId);
  if (!ok) return null;

  // coordToSpectrumIndex maps gridKey → spectrumIndex.
  // We have intensitySum keyed by spectrumIndex → map into grid image.
  const img = new Float32Array(activeGrid.width * activeGrid.height);
  for (const [gridKey, spectrumIdx] of activeGrid.coordToSpectrumIndex) {
    const val = intensitySum.get(spectrumIdx) ?? 0;
    if (gridKey >= 0 && gridKey < img.length) img[gridKey] = val;
  }

  return img;
}

/**
 * Multi-channel ion images in a SINGLE pass over spectra_data.parquet.
 *
 * computeIonImageFast reads the whole file once per channel; doing that 3× for an
 * RGB overlay triples the (large, possibly network) read and made the overlay
 * appear to hang. This reads each row group ONCE and accumulates every channel's
 * windowed intensity together. Returns one image per input window, position-
 * aligned with `windows` (null in → null out), so an empty channel maps to null.
 */
async function computeMultiIonImagesFast(
  windows: ({ start: number; end: number } | null)[],
  requestId?: number,
): Promise<(Float32Array | null)[]> {
  const nullResult = () => windows.map(() => null);
  if (!activeZipStorage || !activeGrid) return nullResult();

  // Fast path: serve every channel from the in-memory index (instant + exact).
  if (await tryBuildIonCache(requestId)) return multiIonImagesFromCache(windows);

  // Fallback (dataset too large to cache): single streamed pass, all channels.
  // One sparse accumulator per non-null window.
  const sums = windows.map((w) => (w ? new Map<number, number>() : null));

  const ok = await forEachSpectraRowGroup((table) => {
    const v = pointVecs(table);
    if (!v) return;
    // Vectorized typed-array access (see computeIonImageFast).
    const mzArr = v.mz.toArray() as ArrayLike<number>;
    const siArr = v.si.toArray() as ArrayLike<number | bigint>;
    const inArr = v.inten.toArray() as ArrayLike<number>;
    const nRows = mzArr.length;
    for (let r = 0; r < nRows; r++) {
      const mz = mzArr[r] as number;
      let si = -1;
      let inten = 0;
      for (let c = 0; c < windows.length; c++) {
        const w = windows[c];
        if (!w || mz < w.start || mz > w.end) continue;
        if (si < 0) {
          si = Number(siArr[r]); // resolve once, only if a window matched
          inten = inArr[r] as number;
        }
        const m = sums[c]!;
        m.set(si, (m.get(si) ?? 0) + inten);
      }
    }
  }, requestId);
  if (!ok) return nullResult();

  const grid = activeGrid;
  return windows.map((w, c) => {
    const m = sums[c];
    if (!w || !m) return null;
    const img = new Float32Array(grid.width * grid.height);
    for (const [gridKey, spectrumIdx] of grid.coordToSpectrumIndex) {
      const v = m.get(spectrumIdx) ?? 0;
      if (gridKey >= 0 && gridKey < img.length) img[gridKey] = v;
    }
    return img;
  });
}

// ---------------------------------------------------------------------------
// Fast spectrum read — row-group skipping in spectra_data.parquet
// ---------------------------------------------------------------------------

/**
 * Read one spectrum directly from spectra_data.parquet using Parquet
 * row-group min/max statistics to skip irrelevant row groups.
 *
 * spectra_data.parquet has 39 row groups, each covering ~900 spectra with
 * spectrum_index min/max statistics. To read spectrum N:
 *   1. Read Parquet footer (~few KB range request) — get row group stats
 *   2. Find the row group where min ≤ N ≤ max  — O(39) linear search
 *   3. Read only that row group  (~12 MB) — 39× less than full file read
 *   4. Filter rows for spectrum_index == N, extract mz + intensity
 *
 * This is used when activeReader is null (before the full 553 MB metadata
 * read has been triggered) so pixel clicks are responsive from the start.
 */
async function readFastSpectrum(index: number, selectId: number): Promise<boolean> {
  if (!activeZipStorage) return false;
  try {
    const pf = await openSpectraDataParquet();
    if (!pf) return false;
    const meta = pf.metadata();
    const nRG = meta.numRowGroups();

    // Find row group containing this spectrum_index via min/max statistics.
    // statistics() returns `any` from parquet-wasm — access properties safely.
    let targetRG = -1;
    for (let rg = 0; rg < nRG; rg++) {
      const rgMeta = meta.rowGroup(rg);
      for (let col = 0; col < rgMeta.numColumns(); col++) {
        const colMeta = rgMeta.column(col);
        if (!colMeta.columnPath().join(".").includes("spectrum_index")) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stats = colMeta.statistics() as any;
        if (!stats) {
          // No stats — fall back to linear scan: assume ~893 spectra per row group
          targetRG = Math.min(Math.floor(index / 900), nRG - 1);
          break;
        }
        const minVal = Number(stats.minValue ?? stats.min_value ?? -Infinity);
        const maxVal = Number(stats.maxValue ?? stats.max_value ?? Infinity);
        if (index >= minVal && index <= maxVal) targetRG = rg;
        break;
      }
      if (targetRG >= 0) break;
    }

    if (targetRG < 0) {
      // Final fallback: try the last row group
      targetRG = nRG - 1;
    }

    // Read only the target row group.
    const rawTable = await pf.read({ rowGroups: [targetRG] });
    const table = tableFromIPC(rawTable.intoIPCStream());

    // Column-based extraction — far faster than row.get(r) for 1M-row tables.
    const v = pointVecs(table);
    if (!v) return false; // column structure doesn't match
    const { si: siVec, mz: mzVec, inten: intensVec } = v;

    const n = table.numRows;
    const mzValues: number[] = [];
    const intensityValues: number[] = [];

    for (let r = 0; r < n; r++) {
      // spectrum_index is Uint64 in Arrow (INT64 Parquet) → Number() safe for < 2^53
      const si = Number(siVec.get(r));
      if (si !== index) continue;
      mzValues.push(Number(mzVec.get(r)));
      intensityValues.push(Number(intensVec.get(r)));
    }

    if (mzValues.length === 0) {
      return false;
    }

    const mzArr = new Float64Array(mzValues);
    const intArr = new Float32Array(intensityValues);

    const spectrum = {
      index,
      id: `scan=${index + 1}`,
      mz: mzArr,
      intensity: intArr,
    };

    sendTransfer(
      { type: "spectrumResult", spectrum, selectId },
      [mzArr.buffer, intArr.buffer],
    );
    return true;
  } catch (e) {
    console.warn("[mzPeakWorker] readFastSpectrum FAILED:", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mean spectrum helpers — BL-03 and BL-06
// ---------------------------------------------------------------------------

/**
 * Import SpectrumArrays type locally (already in scope via reader/types import path).
 * We read spectra_data.parquet row groups and average across a sample of spectra.
 *
 * Strategy:
 *  - Open spectra_data.parquet (the same 208 KB file used by XIC and fast-spectrum).
 *  - Walk ALL row groups, collecting mz/intensity pairs into a per-bin map.
 *  - Use the first spectrum's mz values as a reference grid (centroid data only).
 *  - For each subsequent spectrum, bin each (mz, intensity) pair into the closest
 *    reference mz bin (within ±0.5 Da).
 *  - Return the mean intensity per bin across all sampled spectra.
 *
 * To keep this fast (no full 553 MB metadata read), we sample uniformly from the
 * spectra present in spectra_data.parquet (up to MAX_SAMPLES).
 */
async function computeMeanSpectrum(): Promise<{ index: number; id: string; mz: Float64Array; intensity: Float32Array } | null> {
  if (!activeZipStorage || !activeGrid) return null;
  return _computeMeanSpectrumFrom(null);
}

/**
 * Compute the mean spectrum for a specified subset of spectrum indices (BL-06).
 * Caps at 100 indices for performance; sorted to minimize row-group jumps.
 */
async function computeRoiMeanSpectrum(
  indices: number[],
): Promise<{ index: number; id: string; mz: Float64Array; intensity: Float32Array } | null> {
  if (!activeZipStorage) return null;
  const capped = indices.slice(0, 100).sort((a, b) => a - b);
  return _computeMeanSpectrumFrom(new Set(capped));
}

/**
 * Shared implementation: if `filterSet` is null → average all spectra (sampled);
 * if `filterSet` is a Set → average only those spectrum indices.
 */
async function _computeMeanSpectrumFrom(
  filterSet: Set<number> | null,
): Promise<{ index: number; id: string; mz: Float64Array; intensity: Float32Array } | null> {
  const MAX_SAMPLES = 300;
  try {
    const pf = await openSpectraDataParquet();
    if (!pf) return null;
    const meta = pf.metadata();
    const nRG = meta.numRowGroups();

    // For an ROI (filterSet), the selected spectrum indices span a bounded range;
    // skip row groups whose spectrum_index min/max lies entirely outside it so we
    // don't read the whole file (big win over the network).
    let fMin = Infinity;
    let fMax = -Infinity;
    if (filterSet) {
      for (const v of filterSet) {
        if (v < fMin) fMin = v;
        if (v > fMax) fMax = v;
      }
    }
    const rgInRange = (rg: number): boolean => {
      if (!filterSet) return true;
      try {
        const rgMeta = meta.rowGroup(rg);
        for (let col = 0; col < rgMeta.numColumns(); col++) {
          const cm = rgMeta.column(col);
          if (!cm.columnPath().join(".").includes("spectrum_index")) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const st = cm.statistics() as any;
          if (!st) return true; // no stats → cannot skip safely
          const mn = Number(st.minValue ?? st.min_value ?? -Infinity);
          const mx = Number(st.maxValue ?? st.max_value ?? Infinity);
          return mx >= fMin && mn <= fMax; // overlaps the ROI index range?
        }
      } catch {
        /* fall through → read it */
      }
      return true;
    };

    // Accumulate: mzBins (reference axis built from first spectrum seen),
    // intensitySum (sum per bin), countPerBin (number of spectra contributing).
    let refMz: Float64Array | null = null;
    const intensitySum: Map<number, number> = new Map(); // binIdx → sum
    const countPerBin: Map<number, number> = new Map();  // binIdx → count
    let sampledSpectra = 0;

    // Determine which spectrum_indices to include when filterSet is non-null.
    // For the global mean (filterSet === null), we'll subsample uniformly below.
    const filterArray = filterSet ? Array.from(filterSet).sort((a, b) => a - b) : null;

    for (let rg = 0; rg < nRG; rg++) {
      if (!rgInRange(rg)) continue; // ROI: skip row groups outside the index range
      const rawTable = await pf.read({ rowGroups: [rg] });
      const table = tableFromIPC(rawTable.intoIPCStream());

      const v = pointVecs(table);
      if (!v) continue;
      const { si: siVec, mz: mzVec, inten: intensVec } = v;

      const nRows = table.numRows;

      // Group rows by spectrum_index within this row group.
      const spectrumRows = new Map<number, { mzs: number[]; ins: number[] }>();
      for (let r = 0; r < nRows; r++) {
        const si = Number(siVec.get(r));
        // Filter check.
        if (filterArray !== null) {
          // Only include if in the filter set.
          if (!filterSet!.has(si)) continue;
        }
        if (!spectrumRows.has(si)) spectrumRows.set(si, { mzs: [], ins: [] });
        const entry = spectrumRows.get(si)!;
        entry.mzs.push(Number(mzVec.get(r)));
        entry.ins.push(Number(intensVec.get(r)));
      }

      // For global mean: subsample spectrum indices uniformly.
      let siList = Array.from(spectrumRows.keys());
      if (filterArray === null && siList.length > 0) {
        const remaining = MAX_SAMPLES - sampledSpectra;
        if (remaining <= 0) break;
        if (siList.length > remaining) {
          // Take evenly spaced subset.
          const step = siList.length / remaining;
          siList = Array.from({ length: remaining }, (_, i) => siList[Math.floor(i * step)]);
        }
      }

      for (const si of siList) {
        const entry = spectrumRows.get(si);
        if (!entry) continue;
        const { mzs, ins } = entry;
        if (mzs.length === 0) continue;

        // Build reference mz axis from the first spectrum encountered.
        if (refMz === null) {
          const sorted = mzs.map((m, i) => ({ m, v: ins[i] })).sort((a, b) => a.m - b.m);
          refMz = new Float64Array(sorted.map((s) => s.m));
          for (let bi = 0; bi < refMz.length; bi++) {
            intensitySum.set(bi, sorted[bi].v);
            countPerBin.set(bi, 1);
          }
          sampledSpectra++;
          continue;
        }

        // Bin each (mz, intensity) pair into the closest reference bin (±0.5 Da).
        for (let j = 0; j < mzs.length; j++) {
          const mzVal = mzs[j];
          const intVal = ins[j];
          // Binary search for the closest reference mz.
          let lo = 0;
          let hi = refMz.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (refMz[mid] < mzVal) lo = mid + 1;
            else hi = mid;
          }
          // lo is the first index with refMz[lo] >= mzVal; check lo-1 too.
          const bestIdx =
            lo > 0 && Math.abs(refMz[lo - 1] - mzVal) < Math.abs(refMz[lo] - mzVal)
              ? lo - 1
              : lo;
          if (Math.abs(refMz[bestIdx] - mzVal) <= 0.5) {
            intensitySum.set(bestIdx, (intensitySum.get(bestIdx) ?? 0) + intVal);
            countPerBin.set(bestIdx, (countPerBin.get(bestIdx) ?? 0) + 1);
          }
        }
        sampledSpectra++;
        if (filterArray === null && sampledSpectra >= MAX_SAMPLES) break;
      }
      if (filterArray === null && sampledSpectra >= MAX_SAMPLES) break;
    }

    if (refMz === null || sampledSpectra === 0) return null;

    // Build output: mean intensity per reference mz bin.
    const outIntensity = new Float32Array(refMz.length);
    for (let bi = 0; bi < refMz.length; bi++) {
      const cnt = countPerBin.get(bi) ?? 0;
      outIntensity[bi] = cnt > 0 ? (intensitySum.get(bi) ?? 0) / cnt : 0;
    }

    return {
      index: -1,
      id: filterSet ? `roi-mean(${filterSet.size})` : "mean",
      mz: refMz,
      intensity: outIntensity,
    };
  } catch (e) {
    console.warn("[mzPeakWorker] _computeMeanSpectrumFrom FAILED:", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// selectSpectrum helper — shared by both load path and explicit selectSpectrum msg
// ---------------------------------------------------------------------------

async function runSelectSpectrum(index: number, selectId: number): Promise<void> {
  if (!activeReader) return;
  try {
    const meta = spectrumMeta(activeReader, index);
    const spectrum = await getSpectrumArraysFor(
      activeReader,
      index,
      meta.representation,
    );
    // Transfer mz.buffer and intensity.buffer zero-copy.
    const transferList: Transferable[] = [
      spectrum.mz.buffer,
      spectrum.intensity.buffer,
    ];
    sendTransfer({ type: "spectrumResult", spectrum, selectId }, transferList);
  } catch (err) {
    postError(err);
  }
}

// ---------------------------------------------------------------------------
// Main Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent<WorkerRequest>): Promise<void> => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "setCacheConfig": {
        const wasDisabled = !cfgPreloadEnabled;
        cfgPreloadEnabled = msg.preloadEnabled;
        cfgCacheLimitBytes = Math.max(0, msg.cacheLimitBytes);
        // If preload was just turned ON and a file is loaded but not yet buffered,
        // start buffering now (don't wait for the next load).
        if (wasDisabled && cfgPreloadEnabled) maybePreloadIonIndex(loadSeq);
        break;
      }

      case "loadUrl": {
        // Reset ALL module-scope state before each new file load (Pitfall 5).
        activeZipStorage = null;
        activeReader = null;
        activeStats = null;
        activeGrid = null;
        activeIonCache = null;
        activeIonCacheSiToPix = null;
        ionCacheBuildPromise = null; // drop ref to any superseded in-flight build
        ionCacheTooBig = false;

        // FAST PATH: read only mzpeak_index.json (~600 bytes) via range request.
        // No Parquet data read here. Full reader init is deferred to first
        // renderIonImage / selectSpectrum call.
        //
        // NOTE: we deliberately do NOT use ZipStorage.fromUrl() — it attaches a
        // bogus `Access-Control-Allow-Origin: *` REQUEST header (that's a response
        // header; meaningless on a request). The browser then preflights with
        // `Access-Control-Request-Headers: access-control-allow-origin, range`,
        // which a correct CORS rule (allowing only Range) rejects → "Failed to
        // fetch". Build the reader ourselves with no extra headers so a minimal,
        // correct bucket CORS policy (GET + Range) is all that's needed.
        const store = new ZipStorage(new HttpReader(msg.url, RANGE_OPTS));
        await store.init();
        activeZipStorage = store;
        activeSourceUrl = msg.url;
        await runFastLoad(activeZipStorage);
        break;
      }

      case "loadFile": {
        // Reset ALL module-scope state before each new file load (Pitfall 5).
        activeZipStorage = null;
        activeReader = null;
        activeStats = null;
        activeGrid = null;
        activeIonCache = null;
        activeIonCacheSiToPix = null;
        ionCacheBuildPromise = null; // drop ref to any superseded in-flight build
        ionCacheTooBig = false;
        activeSourceUrl = null; // local/in-memory — independent connections N/A

        // File objects cannot cross the Worker boundary (Pitfall 3 / Pattern 4).
        // The main thread transfers the ArrayBuffer; reconstruct a Blob here.
        const blob = new Blob([msg.bytes]);
        // FAST PATH: BlobReader reads mzpeak_index.json only.
        activeZipStorage = await ZipStorage.fromBlob(blob);
        await runFastLoad(activeZipStorage);
        break;
      }

      case "renderIonImage": {
        const { mz, tolDa, requestId } = msg;
        if (!Number.isFinite(mz) || mz <= 0 || !Number.isFinite(tolDa) || tolDa <= 0) return;
        if (mz - tolDa < 0) return;

        const mzStart = mz - tolDa;
        const mzEnd = mz + tolDa;

        // FAST PATH: fetch only 5 column chunks (~650 KB) via targeted range requests,
        // decode with parquet-wasm, build grid + TIC from the decoded data.
        // No 553 MB download — only the needed leaf column bytes are fetched.
        if (!activeGrid) {
          const result = await buildGridFast();
          if (result) {
            const manifest = activeZipStorage ? manifestFromStore(activeZipStorage) : [];
            const tic: Float32Array | null = result.tic ?? null;
            const transferList: Transferable[] = [];
            if (tic) transferList.push(tic.buffer);
            // Send grid + TIC + stats — Image Info and TIC canvas populate immediately.
            sendTransfer({
              type: "loadResult",
              result: {
                manifest,
                fileMeta: null,
                stats: result.stats,
                capabilities: { isImaging: true, layout: "point" as const, encodings: [], unsupported: [] },
                grid: result.grid,
                tic,
                mixedRepresentationWarning: null,
              },
            }, transferList);
          }
        }

        if (activeGrid && !activeReader) {
          const ionImage = await computeIonImageFast(mzStart, mzEnd, requestId);
          const ionImageStats = ionImage ? computeIonImageStats(ionImage, activeGrid) : null;
          const transferList: Transferable[] = [];
          if (ionImage) transferList.push(ionImage.buffer);
          sendTransfer({ type: "renderResult", ionImage, stats: ionImageStats, requestId }, transferList);
          // TIC is already sent via buildGridFast's loadResult — no recompute needed.
          break;
        }

        // FALLBACK: full reader (553 MB) — only if fast path unavailable.
        if (!activeReader) {
          const ok = await initReaderAndGrid();
          if (!ok) return;
        }

        if (!activeReader || !activeGrid || !activeStats) return;

        const { profile, centroid } = activeStats.representationCounts;
        const useProfile = profile >= centroid;
        const mzRange = { start: mzStart, end: mzEnd };
        const xic = await activeReader.extractXIC(null, mzRange, useProfile);
        const ionImage = xic ? buildIonImage(xic, activeGrid) : null;
        const ionImageStats = ionImage ? computeIonImageStats(ionImage, activeGrid) : null;

        const transferList: Transferable[] = [];
        if (ionImage) transferList.push(ionImage.buffer);
        sendTransfer({ type: "renderResult", ionImage, stats: ionImageStats, requestId }, transferList);
        break;
      }

      case "selectSpectrum": {
        // Instant path: once the in-memory index exists, serve the pixel's
        // spectrum from it (no network re-read — critical for remote files where
        // a single row-group read is ~tens of seconds over a throttled link).
        if (spectrumFromCache(msg.index, msg.selectId)) break;

        if (!activeReader) {
          // Fast path: read from spectra_data.parquet using row-group skipping.
          // ~12 MB per spectrum vs 553 MB for full reader init. Works immediately
          // after the fast overview builds the grid.
          const ok = await readFastSpectrum(msg.index, msg.selectId);
          if (ok) break; // spectrum sent — skip full reader init for now
          // Fast path failed — fall through to full reader init (slow but reliable)
          if (activeZipStorage) {
            try {
              const reader = await openReaderFromStore(activeZipStorage);
              activeReader = reader;
              activeStats = computeStats(reader, readManifest(reader));
            } catch (err) {
              postError(err);
              return;
            }
          }
        }
        await runSelectSpectrum(msg.index, msg.selectId);
        break;
      }

      case "renderMultiChannel": {
        const { channels, requestId } = msg;
        // SINGLE pass over the file for all channels (was 3× full reads → slow).
        // Position-aligned with the (possibly null-containing) channels array.
        const windows = channels.map((ch) =>
          ch ? { start: ch.mz - ch.tolDa, end: ch.mz + ch.tolDa } : null,
        );
        const results = await computeMultiIonImagesFast(windows, requestId);
        const transferList: Transferable[] = results.flatMap((r) =>
          r ? [r.buffer] : [],
        );
        sendTransfer(
          { type: "multiChannelResult", channels: results, requestId },
          transferList,
        );
        break;
      }

      case "meanSpectrum": {
        const result = await computeMeanSpectrum();
        if (result) {
          sendTransfer(
            { type: "meanSpectrumResult", spectrum: result },
            [result.mz.buffer, result.intensity.buffer],
          );
        }
        break;
      }

      case "roiSpectrum": {
        const { spectrumIndices } = msg;
        const result = await computeRoiMeanSpectrum(spectrumIndices);
        if (result) {
          sendTransfer(
            { type: "meanSpectrumResult", spectrum: result },
            [result.mz.buffer, result.intensity.buffer],
          );
        }
        break;
      }

      case "getOpticalImage": {
        // ADD-01: read the optical TIFF ZIP member by name, decode to RGBA, and
        // transfer the pixel buffer back. Optical images are auxiliary — a missing
        // member or undecodable blob is a soft error, never fatal to the load.
        const { archivePath, gen } = msg;
        try {
          const store = activeZipStorage;
          if (!store) throw new Error("no archive open");
          // zip.js Entry is FileEntry | DirectoryEntry; only file entries have
          // getData. Narrow to a file entry exposing getData(writer).
          const entry = store.entries.find((e) => e.filename === archivePath) as
            | { directory?: boolean; uncompressedSize?: number; getData?: (w: unknown) => Promise<Uint8Array> }
            | undefined;
          if (!entry || entry.directory || typeof entry.getData !== "function")
            throw new Error(`ZIP member not found: ${archivePath}`);
          // Background preload: only decode members at/under the preload cap (and
          // whose size is known). Anything bigger/unknown is skipped — NOT an error;
          // it stays decodable on demand. A user request omits preloadMaxBytes.
          if (typeof msg.preloadMaxBytes === "number") {
            const known = typeof entry.uncompressedSize === "number";
            if (!known || (entry.uncompressedSize as number) > msg.preloadMaxBytes) {
              send({ type: "opticalImageSkipped", archivePath, gen });
              break;
            }
          }
          // Defense-in-depth: reject an oversized member BEFORE inflating it, so
          // a hostile index can't name a huge member and exhaust memory.
          if (typeof entry.uncompressedSize === "number" && entry.uncompressedSize > MAX_OPTICAL_BYTES)
            throw new Error(`optical member too large: ${entry.uncompressedSize} bytes`);
          const bytes: Uint8Array = await entry.getData(new Uint8ArrayWriter());
          const decoded = decodeTiff(bytes);
          sendTransfer(
            {
              type: "opticalImageResult",
              archivePath,
              gen,
              width: decoded.width,
              height: decoded.height,
              rgba: decoded.rgba,
            },
            [decoded.rgba.buffer],
          );
        } catch (err) {
          send({
            type: "opticalImageError",
            archivePath,
            gen,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
    }
  } catch (err) {
    postError(err);
  }
};

// Ready handshake. With vite-plugin-top-level-await, this module's top-level code
// (including the `self.onmessage = …` assignment above) runs INSIDE an async
// wrapper that first awaits the WASM top-level-await imports. A load message
// posted by the main thread before that wrapper resolves arrives before
// `onmessage` is registered and is dropped — a race that deterministically hangs
// fast programmatic loads (e.g. setInputFiles immediately after page open). By
// posting `ready` here — AFTER onmessage is registered — the main thread can
// buffer load requests until the worker is provably listening. (See store.ts.)
send({ type: "ready" });
