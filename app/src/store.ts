// Unified zustand store for the mzPeak viewer shell.
// Models @mzpeak/contracts UnifiedState extended with loaded payload fields.

import { create, type StoreApi } from "zustand";
import type {
  CapabilityModel,
  FileStats,
  FileMeta,
  Manifest,
  ImagingGridWire,
  OpticalImageMeta,
  ChromatogramSeries,
  BrowseIndex,
  IonImageStats,
  ChannelAssignment,
} from "@mzpeak/contracts";
import { showChromatograms } from "@mzpeak/contracts";
import { rebuildCoordMap } from "@mzpeak/core";
import type { View } from "@mzpeak/contracts";
import type { SpectrumArrays } from "@mzpeak/ui-kit";
import { engine } from "./engine";

// ---------------------------------------------------------------------------
// Stale-async race guard — monotonic open-sequence counter.
// Each openFile call bumps this before any async work. Every async completion
// handler checks its captured seq against currentOpenSeq and drops the result
// if stale (i.e. a newer openFile was called while this one was in-flight).
// ---------------------------------------------------------------------------

let currentOpenSeq = 0;

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

export type LoadPhase = "idle" | "loading" | "ready" | "error";

export interface AppState {
  // lifecycle
  phase: LoadPhase;
  error: string | null;

  // capabilities (after open)
  capabilities: CapabilityModel | null;

  // opened payload
  stats: FileStats | null;
  fileMeta: FileMeta | null;
  manifest: Manifest | null;
  grid: ImagingGridWire | null;
  /** TIC as flat Float32Array interleaved [time0, int0, time1, int1, …]
   *  from the initial open (from tic column). Used as quick-plot source. */
  ticColumn: Float32Array | null;
  opticalImages: OpticalImageMeta[];
  fileName: string | null;
  fileSize: number | null;
  /** The URL the current file was opened from (cloud demo, pasted URL, or ?file= deep link),
   *  or null for a local file. This is the shareable source URI the "Share view" link embeds
   *  as `file=`; without it a deep link can't reference the dataset. */
  sourceUrl: string | null;

  // imaging layer products — lifted out of the Imaging view so they persist across
  // tab switches and the Overlay view can composite them as stackable layers.
  ionImage: Float32Array | null;
  ionStats: IonImageStats | null;
  multiChannel: (Float32Array | null)[] | null;
  /** True once the background prefetch has warmed the ion-image cache for the open file
   *  (any m/z then renders instantly). Reset on every open. */
  ionCacheReady: boolean;

  // SDRF/ISA isobaric channel assignments for the open run (empty for label-free).
  channels: ChannelAssignment[];

  // Imaging deep-link round-trip (MG-01): the m/z+tolerance last entered in the
  // Ion-image view, and the RGB channel list from the multi-channel view. Mirrored
  // from the Imaging view's local state so currentShareUrl() can emit ?ion=/?ch=.
  // (Distinct from `channels` above, which is SDRF isobaric labels.)
  ionRequest: { mz: number; tolDa: number } | null;
  rgbChannels: { mz: number; tolDa: number; color: string }[];

  // Live address-bar URL sync (MG-02): opt-in user preference, default OFF.
  // Persisted to localStorage; NOT reset on file close.
  urlSyncEnabled: boolean;

  // navigation
  view: View;

  // spectrum selection
  /** How the active spectrum was chosen. `pixel` carries the imaging (x,y) provenance
   *  (ABSOLUTE IMS coords) so a pixel-pick round-trips as `px=x,y` in the share URL
   *  instead of losing the coordinate to a bare `spectrum=index` (MG-01). */
  selector:
    | { by: "index"; index: number }
    | { by: "pixel"; x: number; y: number; index: number }
    | null;
  /** Spectra-view MS-level filter (null = all). Only levels present in the file. */
  msLevelFilter: number | null;
  /** Transient: Structure → "view index.json" jump asks the Metadata view to scroll
   *  to + highlight its Manifest section. The Metadata view clears it once consumed. */
  metadataReveal: "manifest" | null;
  /** The current spectrum arrays (null until one is selected) */
  spectrum: SpectrumArrays | null;
  spectrumLoading: boolean;

  // browse index (from scanBreakdown)
  browse: BrowseIndex | null;

  // chromatogram
  chrom: ChromatogramSeries | null;
  chromLoading: boolean;

  // notices
  notices: { id: string; severity: "info" | "warning" | "error"; message: string }[];

  // accordion state
  expanded: { advanced: boolean; imaging: boolean };

  // actions
  openFile: (file: File) => Promise<void>;
  /** Open a remote .mzpeak by URL (deep-link / ?file= path). Mirrors openFile. */
  openUrl: (url: string) => Promise<void>;
  setView: (view: View) => void;
  /** Return to the idle start page — clears the loaded file + payload so the Idle
   *  screen (drop-zone + demo datasets + URL field) shows again. */
  reset: () => void;
  setMsLevelFilter: (level: number | null) => void;
  /** Structure → "view index.json": switch to the Metadata view and ask it to scroll
   *  to + highlight its Manifest section. Pass null (from Metadata) to clear once done. */
  setMetadataReveal: (section: "manifest" | null) => void;
  /** Store the latest single-channel ion image (rendered in the Ion view) so the
   *  Overlay view can composite it. Pass (null, null) to clear. */
  setIonImage: (image: Float32Array | null, stats: IonImageStats | null) => void;
  /** Store the latest RGB multi-channel images (rendered in the RGB view). */
  setMultiChannel: (images: (Float32Array | null)[] | null) => void;
  /** MG-01: mirror the Ion-image view's m/z+tolerance so ?ion= can round-trip. */
  setIonRequest: (req: { mz: number; tolDa: number } | null) => void;
  /** MG-01: mirror the RGB channels list so ?ch= can round-trip. */
  setRgbChannels: (channels: { mz: number; tolDa: number; color: string }[]) => void;
  /** MG-02: toggle live address-bar URL sync (persisted to localStorage). */
  setUrlSyncEnabled: (on: boolean) => void;
  /** Load a spectrum by index. `route` (default true) switches to the Spectra view
   *  on success; pass false to load the spectrum without leaving the current view
   *  (used by the imaging spectrum dock for in-place pixel-pick). */
  selectSpectrum: (index: number, route?: boolean, pixel?: { x: number; y: number }) => Promise<void>;
  /** Select the spectrum at imaging pixel (x,y) (ABSOLUTE IMS coords). Resolves the
   *  pixel → spectrum index via the loaded grid, records `px` provenance, and loads
   *  in-place (route=false). Used by an imaging pick and by a `?px=` deep link. No-op
   *  if there's no grid or the pixel has no spectrum. (MG-01) */
  selectPixel: (x: number, y: number, route?: boolean) => Promise<void>;
  loadChrom: (req: { mode: "tic" } | { mode: "stored"; id: string }) => Promise<void>;
  dismissNotice: (id: string) => void;
  toggleAccordion: (key: "advanced" | "imaging") => void;
}

// ---------------------------------------------------------------------------
// Helper — convert ChromatogramSeries to ChromPoint[] for ChromPlot
// ---------------------------------------------------------------------------

export function seriesToPoints(s: ChromatogramSeries): { time: number; intensity: number }[] {
  const out: { time: number; intensity: number }[] = [];
  for (let i = 0; i < s.time.length; i++) {
    out.push({ time: s.time[i] as number, intensity: s.intensity[i] as number });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared open helpers (openFile and openUrl were ~95% identical — ~110 dup lines).
// ---------------------------------------------------------------------------

/** Cleared payload + loading phase for a new open. `fileName`/`sourceUrl` are per-open and
 *  spread on top. Includes the loading flags both open paths previously omitted (A7). */
const INITIAL_OPEN_STATE = {
  phase: "loading",
  error: null,
  capabilities: null,
  stats: null,
  fileMeta: null,
  manifest: null,
  grid: null,
  ticColumn: null,
  opticalImages: [],
  ionImage: null,
  ionStats: null,
  multiChannel: null,
  ionCacheReady: false,
  channels: [],
  ionRequest: null,
  rgbChannels: [],
  fileSize: null,
  view: "summary",
  selector: null,
  msLevelFilter: null,
  metadataReveal: null,
  spectrum: null,
  spectrumLoading: false,
  browse: null,
  chrom: null,
  chromLoading: false,
  notices: [],
} satisfies Partial<AppState>;

/**
 * The shared post-`engine.open` tail: commit the opened payload, then fire the off-critical-
 * path follow-ups (scanBreakdown → stats/browse/ticColumn, studyMeta → channels, pre-select
 * spectrum 0). Stale-guarded against `currentOpenSeq` throughout. Used by both openFile and
 * openUrl so they can't drift (e.g. the scanBreakdown-failure notice is now surfaced by BOTH;
 * openUrl previously swallowed it).
 */
async function finishOpen(
  set: StoreApi<AppState>["setState"],
  get: StoreApi<AppState>["getState"],
  seq: number,
  opened: Awaited<ReturnType<typeof engine.open>>,
): Promise<void> {
  if (seq !== currentOpenSeq) return;
  const isImaging = opened.capabilities.imaging.isImaging;
  set({
    phase: "ready",
    capabilities: opened.capabilities,
    stats: opened.stats,
    fileMeta: opened.fileMeta,
    manifest: opened.manifest,
    grid: opened.grid,
    ticColumn: opened.tic,
    opticalImages: opened.opticalImages,
    fileSize: opened.fileSize,
    // Default accordion: Advanced closed; MSI open only for imaging files.
    expanded: { advanced: false, imaging: isImaging },
    notices: opened.mixedRepresentationWarning
      ? [{ id: "mixed-repr", severity: "warning" as const, message: opened.mixedRepresentationWarning }]
      : [],
  });

  // scanBreakdown → detailed stats + browse index + the AUTHORITATIVE ticColumn (not inferred).
  void engine
    .scanBreakdown()
    .then(({ stats, browse, ticColumn }) => {
      if (seq !== currentOpenSeq) return;
      set((s) => ({
        stats: { ...s.stats, ...stats },
        browse,
        capabilities: s.capabilities
          ? { ...s.capabilities, chromatograms: { ...s.capabilities.chromatograms, ticColumn } }
          : s.capabilities,
      }));
    })
    .catch(() => {
      // Non-fatal, but surface a dismissible notice so the missing detailed stats aren't silent.
      if (seq !== currentOpenSeq) return;
      set((s) => ({
        notices: [
          ...s.notices.filter((n) => n.id !== "scan-breakdown"),
          {
            id: "scan-breakdown",
            severity: "warning" as const,
            message: "Detailed stats (m/z range, MS levels) couldn’t be computed for this file.",
          },
        ],
      }));
    });

  // Isobaric (TMT/iTRAQ) channels for the run, off the critical path.
  void engine.studyMeta().then((s) => {
    if (seq === currentOpenSeq) set({ channels: s.channels });
  }).catch(() => {});

  // Pre-select spectrum 0 when the file has spectra.
  if (opened.stats && opened.stats.numSpectra > 0) {
    if (seq !== currentOpenSeq) return;
    await get().selectSpectrum(0);
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStore = create<AppState>((set, get) => ({
  // lifecycle
  phase: "idle",
  error: null,

  // capabilities
  capabilities: null,

  // opened payload
  stats: null,
  fileMeta: null,
  manifest: null,
  grid: null,
  ticColumn: null,
  opticalImages: [],
  fileName: null,
  fileSize: null,
  sourceUrl: null,

  // imaging layer products
  ionImage: null,
  ionStats: null,
  multiChannel: null,
  ionCacheReady: false,

  // sdrf channels
  channels: [],

  // imaging deep-link round-trip (MG-01)
  ionRequest: null,
  rgbChannels: [],

  // live URL sync preference (MG-02) — read from localStorage, default OFF.
  urlSyncEnabled:
    typeof window !== "undefined" && localStorage.getItem("mzpeak.urlSync") === "1",

  // navigation
  view: "summary",

  // spectrum
  selector: null,
  msLevelFilter: null,
  metadataReveal: null,
  spectrum: null,
  spectrumLoading: false,

  // browse
  browse: null,

  // chrom
  chrom: null,
  chromLoading: false,

  // notices
  notices: [],

  // accordion state (Advanced collapsed by default; Imaging open when imaging)
  expanded: { advanced: false, imaging: true },

  // -------------------------------------------------------------------------
  // openFile — open a local File through the engine worker.
  //
  // STALE-ASYNC RACE GUARD: a monotonic openSeq is bumped before any async
  // work. Every post-open set(...) captures seq at the start and checks
  // `seq === currentOpenSeq` before applying; if stale it drops the result.
  // This prevents file-B being opened while file-A's scanBreakdown or
  // selectSpectrum(0) is still in-flight from overwriting B's state.
  // -------------------------------------------------------------------------
  openFile: async (file: File) => {
    const seq = ++currentOpenSeq; // bump BEFORE any async work so in-flight opens go stale
    set({ ...INITIAL_OPEN_STATE, fileName: file.name, sourceUrl: null }); // local → not shareable
    try {
      // Pass the File straight through (it IS a Blob). zip.js reads it lazily via
      // Blob.slice — only the ZIP directory + needed Parquet pages, never the whole
      // file. The Blob clones by reference across the worker boundary (no byte copy),
      // so even a multi-GB archive opens in metadata-time. (Mirrors the URL path.)
      const opened = await engine.open({ kind: "file", blob: file, name: file.name });
      await finishOpen(set, get, seq, opened);
    } catch (err) {
      if (seq !== currentOpenSeq) return; // newer open superseded us
      set({ phase: "error", error: err instanceof Error ? err.message : String(err) });
    }
  },

  // openUrl — remote .mzpeak by URL (deep-link ?file= / cloud demo / paste). Same flow as
  // openFile (shared finishOpen), but the engine fetches via {kind:"url"} HTTP range reads.
  openUrl: async (url: string) => {
    const seq = ++currentOpenSeq;
    // Display name from the URL's last path segment.
    let displayName = url;
    try {
      const u = new URL(url, typeof location !== "undefined" ? location.href : undefined);
      const last = u.pathname.split("/").filter(Boolean).pop();
      if (last) displayName = decodeURIComponent(last);
    } catch {
      // Non-absolute / unparseable: keep the raw url as the display name.
    }
    set({ ...INITIAL_OPEN_STATE, fileName: displayName, sourceUrl: url }); // remote → shareable URI
    try {
      const opened = await engine.open({ kind: "url", url });
      await finishOpen(set, get, seq, opened);
    } catch (err) {
      if (seq !== currentOpenSeq) return;
      set({ phase: "error", error: err instanceof Error ? err.message : String(err) });
    }
  },

  // -------------------------------------------------------------------------
  // setView
  // -------------------------------------------------------------------------
  setView: (view: View) => {
    set({ view });
  },

  // Back to the idle start page. Bump the open-seq so any in-flight async from the
  // previous file (scanBreakdown / selectSpectrum) is dropped, then clear the payload.
  reset: () => {
    ++currentOpenSeq;
    set({
      phase: "idle",
      error: null,
      capabilities: null,
      stats: null,
      fileMeta: null,
      manifest: null,
      grid: null,
      ticColumn: null,
      opticalImages: [],
      ionImage: null,
      ionStats: null,
      multiChannel: null,
      ionCacheReady: false,
      channels: [],
      ionRequest: null,
      rgbChannels: [],
      fileName: null,
      fileSize: null,
      sourceUrl: null,
      view: "summary",
      selector: null,
      msLevelFilter: null,
      metadataReveal: null,
      spectrum: null,
      spectrumLoading: false,
      browse: null,
      chrom: null,
      chromLoading: false,
      notices: [],
    });
  },

  setMsLevelFilter: (level: number | null) => {
    set({ msLevelFilter: level });
  },

  setMetadataReveal: (section: "manifest" | null) => {
    // Switch to the Metadata view when a reveal is requested; clear-only otherwise.
    set(section ? { metadataReveal: section, view: "metadata" as View } : { metadataReveal: null });
  },

  setIonImage: (image: Float32Array | null, stats: IonImageStats | null) => {
    set({ ionImage: image, ionStats: stats });
  },

  setMultiChannel: (images: (Float32Array | null)[] | null) => {
    set({ multiChannel: images });
  },

  setIonRequest: (req: { mz: number; tolDa: number } | null) => {
    set({ ionRequest: req });
  },

  setRgbChannels: (channels: { mz: number; tolDa: number; color: string }[]) => {
    set({ rgbChannels: channels });
  },

  setUrlSyncEnabled: (on: boolean) => {
    if (typeof window !== "undefined") localStorage.setItem("mzpeak.urlSync", on ? "1" : "0");
    set({ urlSyncEnabled: on });
  },

  // -------------------------------------------------------------------------
  // selectSpectrum — load a spectrum by absolute index.
  // Stale-async guard: capture openSeq at call time; drop the result if a
  // newer openFile was issued while this request was in-flight.
  // -------------------------------------------------------------------------
  selectSpectrum: async (index: number, route = true, pixel?: { x: number; y: number }) => {
    const seq = currentOpenSeq;
    // Pixel provenance (when picked on the imaging grid) makes the selection round-trip
    // as `px=x,y`; otherwise it's a plain `spectrum=index`.
    const selector = pixel
      ? ({ by: "pixel", x: pixel.x, y: pixel.y, index } as const)
      : ({ by: "index", index } as const);
    set({ spectrumLoading: true, selector });
    try {
      const spectrum = await engine.selectSpectrum(index);
      // Drop if a newer file was opened while we waited.
      if (seq !== currentOpenSeq) {
        set({ spectrumLoading: false });
        return;
      }
      // route=true → switch to the Spectra view (default). route=false keeps the
      // current view so an imaging pixel-pick fills the in-place dock instead.
      set({ spectrum, spectrumLoading: false, ...(route ? { view: "spectra" as View } : {}) });
    } catch (err) {
      // SupersededError / CancelledError: a newer select was issued — don't
      // overwrite the newer result that's already been (or will be) set.
      const name = err instanceof Error ? err.name : "";
      if (name === "SupersededError" || name === "CancelledError") {
        set({ spectrumLoading: false });
        return;
      }
      // Also drop on stale file seq.
      if (seq !== currentOpenSeq) {
        set({ spectrumLoading: false });
        return;
      }
      set({
        spectrumLoading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  selectPixel: async (x: number, y: number, route = false) => {
    const grid = get().grid;
    if (!grid) return;
    // x,y are ABSOLUTE IMS coords; the coord map is keyed by LOCAL cell (y*width+x).
    const lx = x - grid.originX;
    const ly = y - grid.originY;
    if (lx < 0 || lx >= grid.width || ly < 0 || ly >= grid.height) return;
    const idx = rebuildCoordMap(grid).get(ly * grid.width + lx);
    if (idx == null) return; // no spectrum at this pixel
    await get().selectSpectrum(idx, route, { x, y });
  },

  // -------------------------------------------------------------------------
  // loadChrom — extract a chromatogram: the computed TIC, or a STORED chromatogram
  // (SRM/MRM transition etc.) looked up by its native id.
  // Stale-async guard: drop result if a newer openFile started.
  // -------------------------------------------------------------------------
  loadChrom: async (req: { mode: "tic" } | { mode: "stored"; id: string }) => {
    const seq = currentOpenSeq;
    set({ chromLoading: true });
    try {
      const series = await engine.extractChrom(req);
      // Drop if a newer file was opened while we waited.
      if (seq !== currentOpenSeq) {
        set({ chromLoading: false });
        return;
      }
      set({ chrom: series, chromLoading: false });
    } catch (err) {
      if (seq !== currentOpenSeq) {
        set({ chromLoading: false });
        return;
      }
      set({
        chromLoading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  // -------------------------------------------------------------------------
  // dismissNotice
  // -------------------------------------------------------------------------
  dismissNotice: (id: string) => {
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  },

  // -------------------------------------------------------------------------
  // toggleAccordion
  // -------------------------------------------------------------------------
  toggleAccordion: (key: "advanced" | "imaging") => {
    set((s) => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } }));
  },
}));

// The background ion-cache prefetch (worker) emits `ionIndexReady` once warming completes
// for the open file — capture it in the store so any view can show "ion images ready"
// even if the user wasn't on the Imaging tab when it finished. A new open resets the flag
// (above) and the worker only emits for the current file (gen-guarded), so no stale set.
engine.on("ionIndexReady", () => {
  useStore.setState({ ionCacheReady: true });
});

// Re-export helpers so views can use them without importing contracts directly
export { showChromatograms };
