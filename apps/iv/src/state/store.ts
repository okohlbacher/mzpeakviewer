import { create } from "zustand";

import { type Colormap } from "../ui/rasterize";
import type { ImagingGrid } from "../imaging/types";
import type { OpticalImageMeta, DecodedOptical } from "../imaging/optical";
import type { ReaderErrorClass } from "../reader/errors";
import { resolveLoadUrl } from "../reader/resolveUrl";
import type {
  Capabilities,
  FileMeta,
  FileStats,
  LoadStage,
  ManifestEntry,
  SpectrumArrays,
  UnsupportedFinding,
} from "../reader/types";
import type {
  WorkerRequest,
  WorkerResponse,
  LoadResult,
  NonImagingResult,
  ChannelRequest,
  MultiChannelState,
} from "../worker/protocol";
import type { HistogramMode } from "../compute/histogram";

/** Structured store error (R-03b). */
export type StoreError = {
  class: ReaderErrorClass;
  message: string;
  findings?: UnsupportedFinding[];
};

type State = {
  fileMeta: FileMeta | null;
  manifest: ManifestEntry[];
  stats: FileStats | null;
  capabilities: Capabilities | null;
  grid: ImagingGrid | null;
  /** TIC raster (length width*height) for the imaging grid; null when non-imaging or uncomputable (D-02). */
  tic: Float32Array | null;
  /** Total .mzpeak size in bytes (zip reader size); null until known. */
  fileSize: number | null;
  /** Original URL the current file was opened from (null for local files). Drives
   *  the deep-link "Copy link" button; kept as the user-supplied form (e.g. an
   *  `s3://` link stays `s3://`) so a copied link round-trips through resolveLoadUrl. */
  sourceUrl: string | null;
  /** Non-fatal notice for a deep-link target that couldn't be honored (e.g. a
   *  scan/ion/optical referenced in the URL that doesn't exist). The file still
   *  loads and the overview shows; this is surfaced as a dismissible banner. */
  deepLinkNotice: string | null;
  /** D-08 named warning: set only when a file mixes profile + centroid spectra. */
  mixedRepresentationWarning: string | null;
  stage: LoadStage;
  error: StoreError | null;
  selectedIndex: number | null;
  selectedSpectrum: SpectrumArrays | null;
  // Phase 4 additions — ion image, colormap, and scale state (IMAGE-02/IMAGE-03).
  mzWindow: { mz: number; tolDa: number } | null;
  ionImage: Float32Array | null;
  ionImageStats: { nonzeroCount: number; min: number; max: number } | null;
  colormap: Colormap;
  scale: "linear" | "log";
  percentile: number;
  /** Phase 5: true while a Worker renderIonImage request is in flight (D-02/D-03). */
  isRendering: boolean;
  /** Row-group progress while an ion / multi-channel render streams data; null when
   *  idle. Surfaced as a determinate "Rendering… N%" bar for slow remote files. */
  renderProgress: { done: number; total: number } | null;
  /** True once the worker's in-memory ion-image index is built — subsequent ion
   *  images are instant + exact (no re-read). Reset on each load. */
  ionIndexReady: boolean;
  /** Number of points held in the in-memory ion-image index (null until built). */
  ionIndexPoints: number | null;
  /** True while the index is being preloaded in the background (after the TIC
   *  overview), before it's ready. Drives an unobtrusive "buffering" hint. */
  ionIndexPreloading: boolean;
  /** True while a pixel/index spectrum read is in flight (instant from the index;
   *  up to ~tens of seconds on a cold remote read). Drives a loading hint. */
  spectrumLoading: boolean;
  /** BL-01: TIC normalization — divide each pixel's intensity by its TIC value. */
  ticNorm: boolean;
  /** BL-04: Gaussian smooth sigma in pixels (0 = disabled). */
  smoothSigma: number;
  /** BL-07: Histogram equalization mode. */
  histogramMode: HistogramMode;
  /** Global Δm/z (Da) applied when clicking a peak in the spectrum to render
   *  the ion image for that mass. Persisted in localStorage. */
  peakDeltaMass: number;
  /** Caching policy (persisted; presettable via ?preload= / ?cache= URL params).
   *  preloadEnabled: background-buffer the spectra index after the TIC overview.
   *  cacheLimitMB: in-memory cache hard limit in MB (0 = automatic/device-aware). */
  preloadEnabled: boolean;
  cacheLimitMB: number;
  /** BL-02: Multi-channel overlay state (RGB overlay of three m/z windows). */
  multiChannel: MultiChannelState | null;
  /** BL-03: Mean spectrum across all (or sampled) pixels. */
  meanSpectrum: SpectrumArrays | null;
  /** BL-06: Selected pixel indices for ROI spectrum. */
  roiIndices: number[] | null;
  /** ADD-01: optical-image descriptive metadata from metadata.imaging.images[]. */
  opticalImages: OpticalImageMeta[];
  /** ADD-01: decoded optical pixel data, keyed by archive_path (lazy). */
  opticalDecoded: Record<string, DecodedOptical>;
  /** ADD-01: optical decode errors, keyed by archive_path. */
  opticalErrors: Record<string, string>;
  /** ADD-01: the optical image currently shown (archive_path), or null. */
  selectedOpticalPath: string | null;
  /** Live zoom factor of the active image view (1 = fit), surfaced to the status
   *  bar. Published by ImagingPanel; reset to 1 on view change. */
  viewZoom: number;
};

type Actions = {
  openUrl: (url: string) => void;
  openFile: (file: File) => Promise<void>;
  selectSpectrum: (index: number) => void;
  // Phase 4 actions (IMAGE-02/IMAGE-03).
  renderIonImage: (mz: number, tolDa: number) => void;
  setColormapSettings: (colormap: Colormap, scale: "linear" | "log", percentile: number) => void;
  // BL-01/BL-04/BL-07: render modifier toggles.
  setTicNorm: (enabled: boolean) => void;
  setSmoothSigma: (sigma: number) => void;
  setHistogramMode: (mode: HistogramMode) => void;
  /** Set the global peak-click Δm/z (Da); persisted to localStorage. */
  setPeakDeltaMass: (delta: number) => void;
  /** Caching policy setters (persisted + pushed to the worker). */
  setPreloadEnabled: (enabled: boolean) => void;
  setCacheLimitMB: (mb: number) => void;
  /** Set/clear the non-fatal deep-link notice banner. */
  setDeepLinkNotice: (msg: string | null) => void;
  // BL-02: multi-channel overlay.
  renderMultiChannel: (channels: (ChannelRequest | null)[]) => void;
  // BL-03: mean spectrum across all pixels.
  requestMeanSpectrum: () => void;
  // BL-06: ROI spectrum for selected pixels.
  requestRoiSpectrum: (spectrumIndices: number[]) => void;
  clearRoi: () => void;
  // ADD-01: optical images.
  /** Select which optical image to display; lazily requests its decode. */
  setSelectedOpticalPath: (archivePath: string | null) => void;
  /** Request the worker decode an optical TIFF member (no-op if cached/in-flight). */
  requestOpticalImage: (archivePath: string) => void;
};

// ---------------------------------------------------------------------------
// Global settings persistence — localStorage ("local context of the browser").
// The display/render settings + the peak-click Δm/z survive reloads and are
// shared across files. Keyed + versioned so a schema change can't crash load.
// ---------------------------------------------------------------------------
const SETTINGS_KEY = "mzpeakiv.settings.v1";

type PersistedSettings = {
  colormap: Colormap;
  scale: "linear" | "log";
  percentile: number;
  ticNorm: boolean;
  smoothSigma: number;
  histogramMode: HistogramMode;
  peakDeltaMass: number;
  /** Background-preload the in-memory spectra index after the TIC overview. */
  preloadEnabled: boolean;
  /** In-memory cache hard limit in MB; 0 = automatic (device-aware). */
  cacheLimitMB: number;
};

const SETTINGS_DEFAULTS: PersistedSettings = {
  colormap: "viridis",
  scale: "linear",
  percentile: 0.99,
  ticNorm: true,
  smoothSigma: 0,
  histogramMode: "none",
  peakDeltaMass: 0.3,
  preloadEnabled: true,
  cacheLimitMB: 0,
};

function loadSettings(): PersistedSettings {
  if (typeof localStorage === "undefined") return { ...SETTINGS_DEFAULTS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...SETTINGS_DEFAULTS };
    return { ...SETTINGS_DEFAULTS, ...(JSON.parse(raw) as Partial<PersistedSettings>) };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

/** Read the current settings slice from the live store. */
function settingsSlice(): PersistedSettings {
  const s = useStore.getState();
  return {
    colormap: s.colormap,
    scale: s.scale,
    percentile: s.percentile,
    ticNorm: s.ticNorm,
    smoothSigma: s.smoothSigma,
    histogramMode: s.histogramMode,
    peakDeltaMass: s.peakDeltaMass,
    preloadEnabled: s.preloadEnabled,
    cacheLimitMB: s.cacheLimitMB,
  };
}

/** Persist the current settings slice to localStorage (called from setters). */
function persistSettings(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsSlice()));
  } catch {
    /* quota / private-mode — non-fatal */
  }
}

const persisted = loadSettings();

const initialState: State = {
  fileMeta: null,
  manifest: [],
  stats: null,
  capabilities: null,
  grid: null,
  tic: null,
  fileSize: null,
  sourceUrl: null,
  deepLinkNotice: null,
  mixedRepresentationWarning: null,
  stage: "idle",
  error: null,
  selectedIndex: null,
  selectedSpectrum: null,
  // Phase 4 defaults (D-08: Viridis default, D-10: linear default, D-09: 99th pct default).
  mzWindow: null,
  ionImage: null,
  ionImageStats: null,
  // Hydrated from localStorage (persisted global settings) with built-in defaults.
  colormap: persisted.colormap,
  scale: persisted.scale,
  percentile: persisted.percentile,
  // Phase 5 default.
  isRendering: false,
  renderProgress: null,
  ionIndexReady: false,
  ionIndexPoints: null,
  ionIndexPreloading: false,
  spectrumLoading: false,
  // BL defaults (persisted).
  ticNorm: persisted.ticNorm,
  smoothSigma: persisted.smoothSigma,
  histogramMode: persisted.histogramMode,
  peakDeltaMass: persisted.peakDeltaMass,
  preloadEnabled: persisted.preloadEnabled,
  cacheLimitMB: persisted.cacheLimitMB,
  multiChannel: null,
  meanSpectrum: null,
  roiIndices: null,
  opticalImages: [],
  opticalDecoded: {},
  opticalErrors: {},
  selectedOpticalPath: null,
  viewZoom: 1,
};

// ---------------------------------------------------------------------------
// Worker instantiation — module scope (Pitfall 5: NEVER inside an action body)
// The same Worker instance handles all load and render requests for the page's
// lifetime. Multiple calls to openUrl/openFile reuse the same Worker thread.
// ---------------------------------------------------------------------------
const worker = new Worker(
  new URL("../worker/mzPeakWorker.ts", import.meta.url),
  { type: "module" },
);

// Pending mzWindow — applied to state only when ionImage is confirmed non-null.
let currentMzWindow: { mz: number; tolDa: number } | null = null;
// Generation counter for stale renderResult responses (Pattern 5 / T-05-05).
// Incremented on each renderIonImage call; Worker echoes requestId in the
// response; mismatched IDs are silently discarded on the main thread.
let currentRequestId = 0;
// Last multi-channel channel list sent to the Worker, so the store can pair
// the echoed images with the originating ChannelRequest array on result.
let currentMcChannels: (ChannelRequest | null)[] = [];
// ADD-01: load generation — bumped ONLY on a new file load (NOT on renders, so
// it's distinct from currentRequestId). Optical decode requests carry it and the
// worker echoes it; results from a previous file are dropped on mismatch.
let currentLoadGen = 0;
// Monotonic id for spectrum selections — bumped on every selectSpectrum AND on
// every load, so out-of-order / cross-file spectrum responses are discarded
// (Codex r4-#3). Never reset, so a stale id can never collide with a live one.
let currentSelectId = 0;
// ADD-01: archive_paths with an in-flight getOpticalImage, to dedupe duplicate
// requests (StrictMode / effect re-runs) before the first response arrives.
const opticalInFlight = new Set<string>();

// ---------------------------------------------------------------------------
// Worker-ready handshake (fixes a worker-init race).
//
// With vite-plugin-top-level-await, the Worker registers its onmessage handler
// only AFTER its top-level-await WASM imports resolve. A load posted before that
// arrives with no handler and is silently dropped — which deterministically
// hangs a fast programmatic load (e.g. a load triggered a few ms after the page
// opens). The Worker posts `{type:"ready"}` once its handler is registered; we
// hold the single most-recent load thunk until then, replaying it on ready.
// Render/select messages are never buffered — they can only fire after a load
// has completed, by which point the Worker is long past ready.
// ---------------------------------------------------------------------------
let workerReady = false;
let pendingLoad: (() => void) | null = null;

function postLoadWhenReady(send: () => void): void {
  if (workerReady) send();
  else pendingLoad = send; // keep only the latest pending load
}

/** Optical images at/under this stored size are decoded in the background after
 *  load (subject to the global preload setting) so the Optical tab is instant. */
const OPTICAL_PRELOAD_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/** Background-decode every available optical image below the size cap (gated by the
 *  global preload setting). Idempotent — already-decoded / in-flight / errored
 *  members are skipped, so it's safe to call on each loadResult. */
function preloadOpticalImages(): void {
  const s = useStore.getState();
  if (!s.preloadEnabled) return;
  for (const im of s.opticalImages) {
    const p = im.archivePath;
    if (s.opticalDecoded[p] || s.opticalErrors[p] || opticalInFlight.has(p)) continue;
    opticalInFlight.add(p);
    worker.postMessage({
      type: "getOpticalImage",
      archivePath: p,
      gen: currentLoadGen,
      preloadMaxBytes: OPTICAL_PRELOAD_MAX_BYTES,
    } satisfies WorkerRequest);
  }
}

/** Push the current caching policy to the worker. No-op until the worker is ready
 *  (the `ready` handler sends the then-current config, incl. any URL/settings
 *  overrides applied before init), so this is always eventually consistent. */
function sendCacheConfig(): void {
  if (!workerReady) return;
  const s = useStore.getState();
  worker.postMessage({
    type: "setCacheConfig",
    preloadEnabled: s.preloadEnabled,
    cacheLimitBytes: Math.max(0, Math.round(s.cacheLimitMB * 1_000_000)),
  } satisfies WorkerRequest);
}

export const useStore = create<State & Actions>((set) => ({
  ...initialState,

  openUrl(url: string) {
    // Rewrite s3://bucket/key → the configured HTTPS endpoint (BL-S3); http(s)
    // passes through. A browser can only fetch over http(s).
    const resolved = resolveLoadUrl(url);
    currentRequestId = Date.now();
    currentLoadGen++;
    currentSelectId++;
    opticalInFlight.clear();
    // Reset file state but PRESERVE the user's global settings across loads.
    // Record the ORIGINAL url (not `resolved`) so a copied deep link round-trips.
    set({ ...initialState, ...settingsSlice(), stage: "zip-index", sourceUrl: url });
    postLoadWhenReady(() =>
      worker.postMessage({ type: "loadUrl", url: resolved } satisfies WorkerRequest),
    );
  },

  async openFile(file: File) {
    currentRequestId = Date.now();
    currentLoadGen++;
    currentSelectId++;
    opticalInFlight.clear();
    // Reset file state but PRESERVE the user's global settings across loads.
    set({ ...initialState, ...settingsSlice(), stage: "zip-index" });
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (err) {
      set({
        stage: "error",
        error: {
          class: "corrupt",
          message: `Could not read file: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
      return;
    }
    // Transfer ownership of the ArrayBuffer to the Worker (Pattern 4 / Pitfall 3).
    // File objects cannot cross the Worker boundary reliably — convert to ArrayBuffer
    // on the main thread first, then transfer the buffer zero-copy.
    const bytes = buffer;
    postLoadWhenReady(() =>
      worker.postMessage(
        { type: "loadFile", bytes, name: file.name } satisfies WorkerRequest,
        [bytes],
      ),
    );
  },

  selectSpectrum(index: number) {
    // Optimistic UI update — actual spectrum data arrives via 'spectrumResult'.
    // The Worker holds the active Reader; it performs the Parquet read. selectId
    // lets the result handler drop superseded responses (Codex r4-#3).
    const sid = ++currentSelectId;
    set({ selectedIndex: index, spectrumLoading: true });
    worker.postMessage({ type: "selectSpectrum", index, selectId: sid } satisfies WorkerRequest);
  },

  // Phase 4: render an m/z-windowed ion image (IMAGE-02).
  // This action now dispatches to the Worker instead of running inline.
  // setColormapSettings MUST NOT call extractXIC or reader (D-02/SC-5).
  renderIonImage(mz: number, tolDa: number) {
    // V5 input validation (ASVS L1): reject non-finite, non-positive, or negative-window inputs.
    // This is defense-in-depth — the Worker also validates (T-05-02).
    // NOTE: grid/stats are NOT checked here — they may be null (lazy load). The Worker
    // calls initReaderAndGrid() on the first renderIonImage if needed, then runs the XIC.
    if (!Number.isFinite(mz) || mz <= 0 || !Number.isFinite(tolDa) || tolDa <= 0) return;
    if (mz - tolDa < 0) return; // guard: negative mz start is non-physical (T-04-05)
    const rid = ++currentRequestId;
    // Optimistic mzWindow update for spectrum band highlighting (SPEC-02).
    // The ion image itself arrives via 'renderResult' when the Worker is done.
    // Store the pending mzWindow — only apply it to state when ionImage is confirmed non-null.
    // Setting mzWindow early causes amber band to appear when ion image comes back null.
    currentMzWindow = { mz, tolDa };
    set({ isRendering: true, renderProgress: null });
    worker.postMessage(
      { type: "renderIonImage", mz, tolDa, requestId: rid } satisfies WorkerRequest,
    );
  },

  // Phase 4: update colormap/scale/percentile settings (IMAGE-03).
  // Pure state mutation — no file I/O, no Worker message. The render effect in
  // ImagingPanel re-rasterizes the cached ionImage on colormap/scale change (D-02/SC-5).
  setColormapSettings(colormap: Colormap, scale: "linear" | "log", percentile: number) {
    set({ colormap, scale, percentile });
    persistSettings();
  },

  // BL-01: Toggle TIC normalization.
  setTicNorm(enabled: boolean) {
    set({ ticNorm: enabled });
    persistSettings();
  },

  // BL-04: Update Gaussian smooth sigma.
  setSmoothSigma(sigma: number) {
    set({ smoothSigma: sigma });
    persistSettings();
  },

  // BL-07: Update histogram equalization mode.
  setHistogramMode(mode: HistogramMode) {
    set({ histogramMode: mode });
    persistSettings();
  },

  // Global peak-click Δm/z (Da); persisted to localStorage.
  setPeakDeltaMass(delta: number) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    set({ peakDeltaMass: delta });
    persistSettings();
  },

  // Caching policy — persisted + pushed to the worker (takes effect immediately
  // where possible: enabling preload buffers the open file now; a new limit
  // applies to the next index build).
  setPreloadEnabled(enabled: boolean) {
    set({ preloadEnabled: enabled });
    persistSettings();
    sendCacheConfig();
  },
  setCacheLimitMB(mb: number) {
    const v = Number.isFinite(mb) && mb > 0 ? Math.floor(mb) : 0; // 0 = auto
    set({ cacheLimitMB: v });
    persistSettings();
    sendCacheConfig();
  },

  setDeepLinkNotice(msg: string | null) {
    set({ deepLinkNotice: msg });
  },

  // BL-02: Render an RGB multi-channel overlay.
  renderMultiChannel(channels: (ChannelRequest | null)[]) {
    const validChannels = channels.filter((ch): ch is ChannelRequest => ch !== null);
    if (validChannels.length === 0) return;
    currentMcChannels = channels;
    const rid = ++currentRequestId;
    set({ isRendering: true, renderProgress: null });
    // Send the FULL (position-aligned) array — the worker returns one image per
    // position (null for disabled channels) so R/G/B compositing stays aligned.
    worker.postMessage(
      { type: "renderMultiChannel", channels, requestId: rid } satisfies WorkerRequest,
    );
  },

  // BL-03: Request mean spectrum across all pixels.
  requestMeanSpectrum() {
    worker.postMessage({ type: "meanSpectrum" } satisfies WorkerRequest);
  },

  // BL-06: Request mean spectrum for a selected ROI.
  requestRoiSpectrum(spectrumIndices: number[]) {
    // Clear the single-pixel selection so the ROI mean spectrum takes the dock
    // (the result arrives as meanSpectrum). roiIndices drives the dock display.
    set({ roiIndices: spectrumIndices, selectedIndex: null, selectedSpectrum: null });
    worker.postMessage({ type: "roiSpectrum", spectrumIndices } satisfies WorkerRequest);
  },

  clearRoi() {
    set({ roiIndices: null });
  },

  // ADD-01: request the worker decode an optical TIFF member. No-op if already
  // decoded, errored, or in flight (dedupes StrictMode / effect re-runs).
  requestOpticalImage(archivePath: string) {
    const s = useStore.getState();
    if (s.opticalDecoded[archivePath] || s.opticalErrors[archivePath]) return;
    if (opticalInFlight.has(archivePath)) return;
    opticalInFlight.add(archivePath);
    worker.postMessage(
      { type: "getOpticalImage", archivePath, gen: currentLoadGen } satisfies WorkerRequest,
    );
  },

  // ADD-01: choose the displayed optical image; lazily trigger its decode.
  setSelectedOpticalPath(archivePath: string | null) {
    set({ selectedOpticalPath: archivePath });
    if (archivePath) useStore.getState().requestOpticalImage(archivePath);
  },
}));

// ---------------------------------------------------------------------------
// Worker onmessage handler — single source of truth for all state updates
// driven by Worker responses. Must be wired AFTER useStore is created so
// useStore.setState() is available.
//
// Zustand exposes setState on the store object itself — calling useStore.setState
// from outside create() is the idiomatic pattern for external event sources.
// ---------------------------------------------------------------------------
worker.onmessage = (e: MessageEvent<WorkerResponse>): void => {
  const msg = e.data;
  switch (msg.type) {
    case "ready": {
      // Worker's onmessage is registered — safe to deliver any buffered load.
      workerReady = true;
      // Push the current caching policy (incl. URL/settings overrides applied
      // before init) BEFORE replaying the buffered load, so the load's preload
      // decision uses it.
      sendCacheConfig();
      const load = pendingLoad;
      pendingLoad = null;
      load?.();
      break;
    }

    case "progress":
      useStore.setState({ stage: msg.stage });
      break;

    case "loadResult": {
      // Spread LoadResult fields into state; store no longer holds reader handle.
      // Worker is the sole owner of the live Reader after Plan 05-03.
      const r = msg.result as LoadResult;
      // Merge into existing state — only overwrite fields that are non-null in
      // the message, so the second loadResult (fast overview) doesn't clobber the
      // manifest or capabilities set by the first.
      const prev = useStore.getState();
      const opticalImages = r.opticalImages ?? prev.opticalImages;
      // Auto-select the first display-oriented image (skip derived-MS overviews)
      // so the Optical tab shows something on first open.
      const firstDisplay =
        opticalImages.find((im) => im.role !== "derived-MS-image") ?? opticalImages[0];
      useStore.setState({
        manifest: r.manifest ?? prev.manifest,
        fileMeta: r.fileMeta ?? prev.fileMeta,
        stats: r.stats ?? prev.stats,
        capabilities: r.capabilities ?? prev.capabilities,
        grid: r.grid ?? prev.grid,
        tic: r.tic ?? prev.tic,
        fileSize: r.fileSize ?? prev.fileSize,
        mixedRepresentationWarning:
          r.mixedRepresentationWarning ?? prev.mixedRepresentationWarning,
        opticalImages,
        selectedOpticalPath: prev.selectedOpticalPath ?? firstDisplay?.archivePath ?? null,
        stage: "ready",
        error: null,
        selectedIndex: prev.selectedIndex,
        selectedSpectrum: prev.selectedSpectrum,
      });
      // Background-decode optical images below the size cap so the Optical tab is
      // instant when the user gets to it (idempotent; respects the preload setting).
      preloadOpticalImages();
      break;
    }

    case "noImaging": {
      // D-04/D-06: valid non-imaging file — not an error. Set 'no-imaging' stage
      // so the UI shows the informational notice instead of ImagingPanel.
      // Merge: the second noImaging message (from computeFastOverview) adds stats
      // without resetting the manifest/capabilities set by the first message.
      const r = msg.result as NonImagingResult;
      const prevNI = useStore.getState();
      useStore.setState({
        manifest: r.manifest ?? prevNI.manifest,
        fileMeta: r.fileMeta ?? prevNI.fileMeta,
        stats: r.stats ?? prevNI.stats,
        capabilities: r.capabilities ?? prevNI.capabilities,
        fileSize: r.fileSize ?? prevNI.fileSize,
        grid: null,
        tic: null,
        stage: "no-imaging",
        error: null,
        selectedIndex: prevNI.selectedIndex,
        selectedSpectrum: prevNI.selectedSpectrum,
      });
      break;
    }

    case "ionIndexPreloading":
      // An index build committed — show the "buffering spectra" hint.
      useStore.setState({ ionIndexPreloading: true });
      break;

    case "ionIndexPreloadAborted":
      // Build ended without a cache (too big / failed) — clear the hint.
      useStore.setState({ ionIndexPreloading: false });
      break;

    case "ionIndexReady":
      // The in-memory ion-image index is built — later renders are instant + exact.
      useStore.setState({ ionIndexReady: true, ionIndexPoints: msg.points, ionIndexPreloading: false });
      break;

    case "renderProgress":
      // Determinate progress for a slow ion/multi render; ignore stale (Pattern 5).
      if (msg.requestId !== currentRequestId) break;
      useStore.setState({ renderProgress: { done: msg.done, total: msg.total } });
      break;

    case "renderResult":
      // Stale response guard (Pattern 5 / T-05-05).
      if (msg.requestId !== currentRequestId) break;
      useStore.setState({
        ionImage: msg.ionImage ?? null,
        ionImageStats: msg.stats ?? null,
        isRendering: false,
        renderProgress: null,
        // Only apply mzWindow when there's a real ion image — prevents the amber
        // band from showing on the spectrum when the image came back null (Codex #7).
        mzWindow: msg.ionImage ? currentMzWindow : null,
      });
      break;

    case "spectrumResult":
      // Discard superseded / cross-file responses (Codex r4-#3).
      if (msg.selectId !== currentSelectId) break;
      useStore.setState({
        selectedIndex: msg.spectrum.index,
        selectedSpectrum: msg.spectrum,
        spectrumLoading: false,
      });
      break;

    case "multiChannelResult":
      // Stale-response guard: reuse currentRequestId (shared counter).
      if (msg.requestId !== currentRequestId) break;
      useStore.setState({
        multiChannel: {
          channels: currentMcChannels,
          images: msg.channels,
        },
        isRendering: false,
        renderProgress: null,
      });
      break;

    case "meanSpectrumResult":
      useStore.setState({ meanSpectrum: msg.spectrum });
      break;

    case "opticalImageResult": {
      // ADD-01: drop results from a previous file load (stale generation) so a
      // late decode can't pollute the newly-loaded file's cache.
      if (msg.gen !== currentLoadGen) break;
      opticalInFlight.delete(msg.archivePath);
      const prevOpt = useStore.getState();
      useStore.setState({
        opticalDecoded: {
          ...prevOpt.opticalDecoded,
          [msg.archivePath]: { width: msg.width, height: msg.height, rgba: msg.rgba },
        },
      });
      break;
    }

    case "opticalImageError": {
      if (msg.gen !== currentLoadGen) break;
      opticalInFlight.delete(msg.archivePath);
      const prevOptE = useStore.getState();
      useStore.setState({
        opticalErrors: { ...prevOptE.opticalErrors, [msg.archivePath]: msg.message },
      });
      break;
    }

    case "opticalImageSkipped": {
      // A background preload skipped this member (too big / unknown size). NOT an
      // error — clear in-flight and, if the user is already viewing it, decode it
      // fully on demand (no preload cap) so their selection still resolves.
      if (msg.gen !== currentLoadGen) break;
      opticalInFlight.delete(msg.archivePath);
      const stOpt = useStore.getState();
      if (
        stOpt.selectedOpticalPath === msg.archivePath &&
        !stOpt.opticalDecoded[msg.archivePath] &&
        !stOpt.opticalErrors[msg.archivePath]
      ) {
        stOpt.requestOpticalImage(msg.archivePath);
      }
      break;
    }

    case "error":
      // CRITICAL (Pitfall 7 / T-05-06): isRendering MUST be cleared on error,
      // or the 'Show Ion Image' button is permanently disabled after any Worker error.
      useStore.setState({
        stage: "error",
        error: {
          class: msg.class,
          message: msg.message,
          findings: msg.findings,
        },
        isRendering: false,
        renderProgress: null,
      });
      break;
  }
};

worker.onerror = (e: ErrorEvent): void => {
  console.error("[mzPeakWorker] uncaught error:", e.message, e);
  useStore.setState({
    stage: "error",
    error: { class: "corrupt", message: `Worker error: ${e.message}` },
    isRendering: false,
  });
};

worker.onmessageerror = (e: MessageEvent): void => {
  console.error("[mzPeakWorker] message deserialization error:", e);
  useStore.setState({
    stage: "error",
    error: { class: "corrupt", message: "Worker message could not be deserialized." },
    isRendering: false,
  });
};
