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
  ChromRequest,
  BrowseIndex,
  IonImageStats,
  ChannelAssignment,
  WavelengthBrowseIndex,
  WavelengthSpectrumArrays,
  WavelengthMatrix,
} from "@mzpeak/contracts";
import { showChromatograms, showWavelength } from "@mzpeak/contracts";
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


// Monotonic id for chrom-LIST items + a global load token (re-adding a fixed-id item
// while its first load is in flight must not let the stale load commit).
let chromItemCounter = 0;
let chromLoadToken = 0;

// ── Browser-persisted settings (XIC defaults) ─────────────────────────────────
export type AppSettings = {
  /** Default XIC m/z half-window (Da) for peak→chromatogram + the add-XIC form. */
  xicTolDa: number;
  /** Default XIC retention-time half-window (minutes). */
  xicRtHalfMin: number;
};
const DEFAULT_SETTINGS: AppSettings = { xicTolDa: 0.1, xicRtHalfMin: 2 };
const SETTINGS_KEY = "mzpeak.settings";

/** Load settings from localStorage, falling back to defaults (SSR / quota / parse-safe). */
function loadSettings(): AppSettings {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = JSON.parse(raw) as Partial<AppSettings>;
    const tol = Number(p.xicTolDa);
    const rt = Number(p.xicRtHalfMin);
    return {
      xicTolDa: Number.isFinite(tol) && tol > 0 ? tol : DEFAULT_SETTINGS.xicTolDa,
      xicRtHalfMin: Number.isFinite(rt) && rt > 0 ? rt : DEFAULT_SETTINGS.xicRtHalfMin,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s: AppSettings): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* quota / disabled storage — non-fatal, settings stay in memory for the session */
  }
}

/** One chromatogram in the managed list (the Chromatograms view). */
export type ChromItem = {
  itemId: string;
  source: "stored" | "generated";
  req: ChromRequest;
  label: string;
  series: ChromatogramSeries | null;
  loading: boolean;
  error: string | null;
  /** Plot height in px (resize); clamped [CHROM_MIN_H, CHROM_MAX_H]. */
  height: number;
  /** Card collapsed (plot hidden, header only). */
  collapsed: boolean;
  /** Per-item monotonic load token — guards concurrent (re)extraction. */
  loadSeq: number;
};
export const CHROM_MIN_H = 120;
export const CHROM_MAX_H = 600;
const CHROM_DEFAULT_H = 220;
/** Cap the managed list to bound memory + the number of live uPlot instances. */
export const CHROM_MAX_ITEMS = 12;

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
  /** The index `study` block (dataset accession, title, run_sample_binding) +
   *  the per-sample list, for the Summary ▸ Study panel. Null until studyMeta resolves. */
  study: unknown;
  studySamples: unknown[] | null;
  /** Archive member path of the embedded SDRF file (e.g.
   *  "sample_metadata/sdrf.tsv"), so the Study panel can fetch the full
   *  characteristics table on demand. Null when absent. */
  sdrfMember: string | null;

  // Imaging deep-link round-trip: the m/z+tolerance last entered in the
  // Ion-image view, and the RGB channel list from the multi-channel view. Mirrored
  // from the Imaging view's local state so currentShareUrl() can emit ?ion=/?ch=.
  // (Distinct from `channels` above, which is SDRF isobaric labels.)
  ionRequest: { mz: number; tolDa: number } | null;
  rgbChannels: { mz: number; tolDa: number; color: string }[];
  /** The last imaging ROI rectangle (ABSOLUTE IMS corners x0,y0,x1,y1) so a
   *  region-mean selection round-trips as `roi=x0,y0,x1,y1` in the share URL. */
  roiRect: [number, number, number, number] | null;

  // navigation
  view: View;

  // spectrum selection
  /** How the active spectrum was chosen. `pixel` carries the imaging (x,y) provenance
   *  (ABSOLUTE IMS coords) so a pixel-pick round-trips as `px=x,y` in the share URL
   *  instead of losing the coordinate to a bare `spectrum=index`. */
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

  // ── UV/VIS (wavelength) spectra — SEPARATE from the MS spectrum path ──────────
  /** Whether the file has wavelength spectra (from capabilities.wavelength). */
  hasWavelength: boolean;
  /** Number of wavelength spectra (0 when absent). */
  wavelengthCount: number;
  /** Lazy wavelength browse index (loaded on first UV access; null until then). */
  wavelengthBrowse: WavelengthBrowseIndex | null;
  /** The current wavelength spectrum (null until one is selected). */
  wavelengthSpectrum: WavelengthSpectrumArrays | null;
  wavelengthSpectrumLoading: boolean;
  /** Dense time × wavelength matrix for PDA/DAD UV/VIS views (null until loaded). */
  wavelengthMatrix: WavelengthMatrix | null;
  wavelengthMatrixLoading: boolean;

  // chromatogram — a mirror of the active list item, kept so the Share link can
  // round-trip the exact active trace (xic m/z window, stored id) without reaching
  // into chromList. Written only by the list actions (see activeMirror).
  chrom: ChromatogramSeries | null;
  chromReq: ChromRequest | null;

  // ── Managed chromatogram list (Chromatograms view) — stored + generated (in-mem) ──
  /** The chromatograms shown as cards: file's stored ones + user-generated TIC/XIC.
   *  In-memory only; reset on file open; never written to the file. */
  chromList: ChromItem[];
  /** The "active" item mirrored into chrom/chromReq for share-link round-trip. */
  activeChromId: string | null;

  // ── Browser-persisted settings ───────────────────────────────────────────────
  settings: AppSettings;

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
  /** Mirror the Ion-image view's m/z+tolerance so ?ion= can round-trip. */
  setIonRequest: (req: { mz: number; tolDa: number } | null) => void;
  /** Set/clear the imaging ROI rectangle (absolute IMS corners). */
  setRoiRect: (rect: [number, number, number, number] | null) => void;
  /** Mirror the RGB channels list so ?ch= can round-trip. */
  setRgbChannels: (channels: { mz: number; tolDa: number; color: string }[]) => void;
  /** Load a spectrum by index. `route` (default true) switches to the Spectra view
   *  on success; pass false to load the spectrum without leaving the current view
   *  (used by the imaging spectrum dock for in-place pixel-pick). */
  selectSpectrum: (index: number, route?: boolean, pixel?: { x: number; y: number }) => Promise<void>;
  /** Select the spectrum at imaging pixel (x,y) (ABSOLUTE IMS coords). Resolves the
   *  pixel → spectrum index via the loaded grid, records `px` provenance, and loads
   *  in-place (route=false). Used by an imaging pick and by a `?px=` deep link. No-op
   *  if there's no grid or the pixel has no spectrum. */
  selectPixel: (x: number, y: number, route?: boolean) => Promise<void>;
  /** Update a persisted setting (written through to localStorage). */
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  /** Add a computed TIC to the list (optional RT window in seconds). */
  addTic: (rt?: [number, number]) => void;
  /** Add an extracted-ion chromatogram (m/z ± tolDa, optional RT seconds, optional MS level). */
  addXic: (opts: { mz: number; tolDa: number; rt?: [number, number]; msLevel?: number }) => void;
  /** Add one chromatogram card per DIA fragment: each fragment m/z is extracted over the
   *  precursor isolation window's MS2 spectra (same managed list as TIC/XIC). */
  addDiaXic: (opts: { precursorMz: number; fragmentMzs: number[]; tolDa: number; rt?: [number, number] }) => void;
  /** Add (or focus, if already present) the file's stored chromatogram by index. */
  addStoredChrom: (index: number, id: string) => void;
  /** Resolve a stored chromatogram id → index (via the engine inventory) and add it as a
   *  card. Used by `?chrom=stored` deep links, which carry only the id. */
  addStoredChromById: (id: string) => Promise<void>;
  /** Remove a list item by id (drops its in-flight load via the per-item token). */
  removeChrom: (itemId: string) => void;
  /** Resize a card's plot height (clamped). */
  setChromHeight: (itemId: string, height: number) => void;
  /** Collapse/expand a card (toggles its plot visibility). */
  toggleChromCollapsed: (itemId: string) => void;
  /** Reorder the list: move `draggedId` to `targetId`'s position (drag-and-drop). */
  moveChrom: (draggedId: string, targetId: string) => void;
  /** Remove all generated (non-stored) items. */
  clearGeneratedChroms: () => void;
  /** Load a wavelength spectrum by ZERO-BASED ARRAY POSITION. Lazily loads the wavelength
   *  browse index on first call if not already present. SEPARATE from selectSpectrum. */
  selectWavelengthSpectrum: (index: number) => Promise<void>;
  /** Idempotently load the wavelength browse + the first signal-bearing spectrum (the
   *  shared loader used by both the UV-only eager path at open and the UV/VIS view on
   *  mount — so both pick the same first-non-blank scan). No-op once the browse exists. */
  ensureWavelength: () => Promise<void>;
  /** Load the dense time × wavelength matrix once (idempotent, stale-guarded). */
  loadWavelengthMatrix: () => Promise<void>;
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
 *  spread on top. Includes the loading flags both open paths previously omitted. */
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
  study: null,
  studySamples: null,
  sdrfMember: null,
  ionRequest: null,
  rgbChannels: [],
  roiRect: null,
  fileSize: null,
  view: "summary",
  selector: null,
  msLevelFilter: null,
  metadataReveal: null,
  spectrum: null,
  spectrumLoading: false,
  browse: null,
  hasWavelength: false,
  wavelengthCount: 0,
  wavelengthBrowse: null,
  wavelengthSpectrum: null,
  wavelengthSpectrumLoading: false,
  wavelengthMatrix: null,
  wavelengthMatrixLoading: false,
  chrom: null,
  chromReq: null,
  chromList: [],
  activeChromId: null,
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
  // UV/VIS presence is authoritative from capabilities (known at open). Choose the default
  const wavelength = opened.capabilities.wavelength;
  const hasMs = (opened.stats?.numSpectra ?? 0) > 0;
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
    hasWavelength: wavelength.present,
    wavelengthCount: wavelength.count,
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
    if (seq === currentOpenSeq) set({ channels: s.channels, study: s.study ?? null, studySamples: s.samples ?? null, sdrfMember: s.sdrfMember ?? null });
  }).catch(() => {});

  // Pre-load spectrum 0 when the file has spectra — but route=false so the view STAYS on
  // the default Summary (a plain open shouldn't jump to the Spectra view). Deep links apply
  // their own ?view=/?spectrum= afterwards via urlSync.applyViewState.
  if (opened.stats && opened.stats.numSpectra > 0) {
    if (seq !== currentOpenSeq) return;
    await get().selectSpectrum(0, false);
  }

  // UV-only files (no MS spectra): eagerly load the wavelength browse + first wavelength
  // spectrum so the Spectra view has UV content to show immediately. Files that ALSO have
  // MS spectra load UV lazily when the UV/VIS view first mounts (store.ensureWavelength).
  if (!hasMs && wavelength.present) {
    if (seq !== currentOpenSeq) return;
    await ensureWavelengthLoaded(set, get, seq);
  }
}

/**
 * Lazily load the wavelength browse index (once) + the first wavelength spectrum. Idempotent:
 * if the browse is already present it does nothing. Stale-guarded against `currentOpenSeq`.
 */
async function ensureWavelengthLoaded(
  set: StoreApi<AppState>["setState"],
  get: StoreApi<AppState>["getState"],
  seq: number,
): Promise<void> {
  if (get().wavelengthBrowse) return; // already loaded
  try {
    const browse = await engine.wavelengthBrowse();
    if (seq !== currentOpenSeq) return;
    set({ wavelengthBrowse: browse });
    if (browse.id.length > 0 && !get().wavelengthSpectrum) {
      // Default to the first scan that actually carries signal (finite λmax),
      // so a leading all-zero/blank scan doesn't greet the user with "No signal".
      let first = 0;
      for (let i = 0; i < browse.lambdaMax.length; i++) {
        if (Number.isFinite(browse.lambdaMax[i]!)) { first = i; break; }
      }
      await get().selectWavelengthSpectrum(first);
    }
  } catch {
    // Non-fatal: the UV browse couldn't be built. The view falls back to empty.
  }
}

/**
 * Append a chromatogram to the managed list and load its series with a PER-ITEM token
 * guard: commit only if the file is unchanged (openSeq) and the item still exists with the
 * same loadSeq — so concurrent generations / a mid-flight file switch / a removed item can't
 * clobber state. Caps the list (notice when full). Mirrors the active item into
 * chrom/chromReq so the existing Share-link round-trip keeps working.
 */
function startChromItem(
  set: StoreApi<AppState>["setState"],
  get: StoreApi<AppState>["getState"],
  req: ChromRequest,
  source: "stored" | "generated",
  label: string,
  fixedId?: string,
): void {
  // Dedup: an identical request just focuses the existing card (avoids filling the cap
  // with duplicate right-click-Creates). reqKey is order-stable for our flat req shapes.
  const reqKey = JSON.stringify(req);
  const dupe = get().chromList.find((it) => JSON.stringify(it.req) === reqKey);
  if (dupe) {
    set((s) => ({ activeChromId: dupe.itemId, ...activeMirror(s.chromList, dupe.itemId) }));
    return;
  }
  if (get().chromList.length >= CHROM_MAX_ITEMS) {
    set((s) => ({
      notices: [
        ...s.notices.filter((n) => n.id !== "chrom-cap"),
        { id: "chrom-cap", severity: "info" as const, message: `Chromatogram list is full (max ${CHROM_MAX_ITEMS}) — remove one to add another.` },
      ],
    }));
    return;
  }
  const itemId = fixedId ?? `c${++chromItemCounter}`;
  const loadSeq = ++chromLoadToken;
  const item: ChromItem = { itemId, source, req, label, series: null, loading: true, error: null, height: CHROM_DEFAULT_H, collapsed: false, loadSeq };
  // New active item has no series yet → activeMirror nulls chrom/chromReq so the Share link
  // doesn't keep serializing the previously-active trace while this one loads.
  set((s) => { const chromList = [...s.chromList, item]; return { chromList, activeChromId: itemId, ...activeMirror(chromList, itemId) }; });
  const openSeq = currentOpenSeq;
  void (async () => {
    try {
      const series = await engine.extractChrom(req);
      if (openSeq !== currentOpenSeq) return;
      const cur = get().chromList.find((it) => it.itemId === itemId);
      if (!cur || cur.loadSeq !== loadSeq) return; // removed, re-added, or superseded
      set((s) => {
        const chromList = s.chromList.map((it) => (it.itemId === itemId ? { ...it, series, loading: false, error: null } : it));
        return { chromList, ...activeMirror(chromList, s.activeChromId) }; // mirror reads active-at-commit-time, not get()
      });
    } catch (err) {
      if (openSeq !== currentOpenSeq) return;
      const cur = get().chromList.find((it) => it.itemId === itemId);
      if (!cur || cur.loadSeq !== loadSeq) return;
      const message = err instanceof Error ? err.message : String(err);
      set((s) => {
        const chromList = s.chromList.map((it) => (it.itemId === itemId ? { ...it, loading: false, error: message } : it));
        return { chromList, ...activeMirror(chromList, s.activeChromId) }; // errored active item → mirror nulls
      });
    }
  })();
}

/** chrom/chromReq mirror of the active item (or nulls) — keeps the Share link valid when
 *  the active card changes/removes. */
function activeMirror(list: ChromItem[], activeId: string | null): { chrom: ChromatogramSeries | null; chromReq: ChromRequest | null } {
  const a = activeId ? list.find((it) => it.itemId === activeId) : undefined;
  return a && a.series ? { chrom: a.series, chromReq: a.req } : { chrom: null, chromReq: null };
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
  study: null,
  studySamples: null,
  sdrfMember: null,

  // imaging deep-link round-trip
  ionRequest: null,
  rgbChannels: [],
  roiRect: null,

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

  // UV/VIS (wavelength) — safe defaults; unaffected on MS-only files
  hasWavelength: false,
  wavelengthCount: 0,
  wavelengthBrowse: null,
  wavelengthSpectrum: null,
  wavelengthSpectrumLoading: false,
  wavelengthMatrix: null,
  wavelengthMatrixLoading: false,

  // chrom
  chrom: null,
  chromReq: null,
  chromList: [],
  activeChromId: null,

  // settings — loaded from localStorage once at store creation; NOT reset on file open.
  settings: loadSettings(),

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
      study: null,
      studySamples: null,
      sdrfMember: null,
      ionRequest: null,
      rgbChannels: [],
      roiRect: null,
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
      hasWavelength: false,
      wavelengthCount: 0,
      wavelengthBrowse: null,
      wavelengthSpectrum: null,
      wavelengthSpectrumLoading: false,
      wavelengthMatrix: null,
      wavelengthMatrixLoading: false,
      chrom: null,
      chromReq: null,
      chromList: [],
      activeChromId: null,
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
  setRoiRect: (rect: [number, number, number, number] | null) => {
    set({ roiRect: rect });
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

  // ── Managed chromatogram list ────────────────────────────────────────────
  setSetting: (key, value) => {
    set((s) => {
      const settings = { ...s.settings, [key]: value };
      saveSettings(settings);
      return { settings };
    });
  },

  addTic: (rt) => { startChromItem(set, get, { mode: "tic", ...(rt ? { rt } : {}) }, "generated", "TIC"); },

  addXic: ({ mz, tolDa, rt, msLevel }) => {
    const label = `XIC ${mz.toFixed(4)} ± ${tolDa} Da${msLevel != null ? ` · MS${msLevel}` : ""}`;
    const req: ChromRequest = { mode: "xic", mz, tolDa, ...(rt ? { rt } : {}), ...(msLevel != null ? { msLevel } : {}) };
    startChromItem(set, get, req, "generated", label);
  },

  addDiaXic: ({ precursorMz, fragmentMzs, tolDa, rt }) => {
    for (const mz of fragmentMzs) {
      const label = `DIA ${mz.toFixed(3)} ◀ ${precursorMz.toFixed(2)}`;
      const req: ChromRequest = { mode: "diaXic", precursorMz, mz, tolDa, ...(rt ? { rt } : {}) };
      startChromItem(set, get, req, "generated", label);
    }
  },

  addStoredChrom: (index, id) => {
    const fixedId = `stored:${index}`;
    if (get().chromList.some((it) => it.itemId === fixedId)) { set((s) => ({ activeChromId: fixedId, ...activeMirror(s.chromList, fixedId) })); return; }
    startChromItem(set, get, { mode: "stored", id }, "stored", id, fixedId);
  },

  addStoredChromById: async (id) => {
    const seq = currentOpenSeq;
    try {
      const list = await engine.chromatogramList();
      if (seq !== currentOpenSeq) return; // file changed under us
      // The URL grammar keeps the legacy `ix:<n>` index form verbatim; resolve it by index.
      const hit = id.startsWith("ix:")
        ? (Number.isInteger(Number(id.slice(3))) ? list.find((c) => c.index === Number(id.slice(3))) : undefined)
        : list.find((c) => c.id === id);
      if (hit) get().addStoredChrom(hit.index, hit.id);
    } catch { /* inventory unavailable — stored deep link silently no-ops */ }
  },

  removeChrom: (itemId) => {
    set((s) => {
      const chromList = s.chromList.filter((it) => it.itemId !== itemId);
      const activeChromId = s.activeChromId === itemId ? (chromList[chromList.length - 1]?.itemId ?? null) : s.activeChromId;
      return { chromList, activeChromId, ...activeMirror(chromList, activeChromId) };
    });
  },

  setChromHeight: (itemId, height) => {
    const h = Math.max(CHROM_MIN_H, Math.min(CHROM_MAX_H, Math.round(height)));
    set((s) => {
      const it = s.chromList.find((x) => x.itemId === itemId);
      if (!it || it.height === h) return {}; // no-op: clamped at a bound, unchanged
      return { chromList: s.chromList.map((x) => (x.itemId === itemId ? { ...x, height: h } : x)) };
    });
  },

  toggleChromCollapsed: (itemId) => {
    set((s) => ({ chromList: s.chromList.map((x) => (x.itemId === itemId ? { ...x, collapsed: !x.collapsed } : x)) }));
  },

  moveChrom: (draggedId, targetId) => {
    if (draggedId === targetId) return;
    set((s) => {
      const moved = s.chromList.find((x) => x.itemId === draggedId);
      const next = s.chromList.filter((x) => x.itemId !== draggedId);
      const to = next.findIndex((x) => x.itemId === targetId);
      if (!moved || to < 0) return {};
      next.splice(to, 0, moved); // insert before the target, regardless of drag direction
      return { chromList: next }; // activeMirror is id-based, so reorder doesn't change the active trace
    });
  },

  clearGeneratedChroms: () => {
    set((s) => {
      const chromList = s.chromList.filter((it) => it.source === "stored");
      const activeChromId = chromList.some((it) => it.itemId === s.activeChromId) ? s.activeChromId : (chromList[chromList.length - 1]?.itemId ?? null);
      return { chromList, activeChromId, ...activeMirror(chromList, activeChromId) };
    });
  },

  // -------------------------------------------------------------------------
  // ensureWavelength — the ONE idempotent wavelength loader, shared by the UV-only
  // eager path (finishOpen) and the UV/VIS view's mount effect, so both land on the
  // same first-signal-bearing scan and a concurrent navigation can't double-load.
  // -------------------------------------------------------------------------
  ensureWavelength: async () => {
    await ensureWavelengthLoaded(set, get, currentOpenSeq);
  },

  // -------------------------------------------------------------------------
  // selectWavelengthSpectrum — load a UV/VIS spectrum by zero-based array position.
  // SEPARATE from selectSpectrum (different engine route, cache, and state slice).
  // Lazily loads the wavelength browse on first use. Same stale-async guard model.
  // -------------------------------------------------------------------------
  selectWavelengthSpectrum: async (index: number) => {
    const seq = currentOpenSeq;
    // Bounds guard: ignore out-of-range positions (the worker also validates).
    if (!Number.isInteger(index) || index < 0 || index >= get().wavelengthCount) return;
    // Lazily build the browse on first access if it isn't loaded yet.
    if (!get().wavelengthBrowse) {
      try {
        const browse = await engine.wavelengthBrowse();
        if (seq !== currentOpenSeq) return;
        set({ wavelengthBrowse: browse });
      } catch {
        // Non-fatal — proceed to attempt the select anyway.
      }
    }
    set({ wavelengthSpectrumLoading: true });
    try {
      const spectrum = await engine.selectWavelengthSpectrum(index);
      // Stale (a newer file was opened mid-flight): the open already reset this
      // file's UV state, so do NOT mutate the now-current file's loading flag.
      if (seq !== currentOpenSeq) return;
      set({ wavelengthSpectrum: spectrum, wavelengthSpectrumLoading: false });
    } catch (err) {
      if (seq !== currentOpenSeq) return; // stale — leave current file's state alone
      const name = err instanceof Error ? err.name : "";
      if (name === "SupersededError" || name === "CancelledError") {
        set({ wavelengthSpectrumLoading: false });
        return;
      }
      set({
        wavelengthSpectrumLoading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  // -------------------------------------------------------------------------
  // loadWavelengthMatrix — dense time × wavelength matrix for PDA/DAD views.
  // Idempotent: if already loaded or already loading, returns the existing promise.
  // Stale-guarded against currentOpenSeq; resets loading flag on completion/failure.
  // -------------------------------------------------------------------------
  loadWavelengthMatrix: (() => {
    let inFlight: Promise<void> | null = null;
    return async (): Promise<void> => {
      if (get().wavelengthMatrix) return;
      if (get().wavelengthMatrixLoading) {
        if (inFlight) return inFlight;
      }
      const seq = currentOpenSeq;
      set({ wavelengthMatrixLoading: true });
      inFlight = (async () => {
        try {
          const matrix = await engine.wavelengthMatrix();
          if (seq !== currentOpenSeq) return;
          set({ wavelengthMatrix: matrix, wavelengthMatrixLoading: false });
        } catch (err) {
          if (seq !== currentOpenSeq) {
            set({ wavelengthMatrixLoading: false });
            return;
          }
          const name = err instanceof Error ? err.name : "";
          if (name === "SupersededError" || name === "CancelledError") {
            set({ wavelengthMatrixLoading: false });
            return;
          }
          set({ wavelengthMatrixLoading: false, error: err instanceof Error ? err.message : String(err) });
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    };
  })(),

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
export { showChromatograms, showWavelength };
