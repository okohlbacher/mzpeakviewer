import { create } from "zustand";

import { openBlob, openUrl, type Reader } from "../reader/open";
import { fileMeta as readFileMeta, indexMetadata, manifest as readManifest } from "../reader/meta";
import { computeFastSummary, scanSpectra } from "../reader/summary";
import { listArchive, readParquetInfo, readArchiveMember } from "../reader/archive";
import { readStudyMetadata } from "../reader/sampleMeta";
import { deepColumn, sampleColumnNumbers } from "../reader/parquetDeep";
import { priorityRead, backgroundRead, userIsActive, PRELOAD_COOLDOWN_MS } from "./readScheduler";
import {
  chromatogramIds,
  extractChromatogram,
  getSpectrumArrays,
  getSpectrumMetadata,
  getStoredChromatogram,
} from "../reader/browse";
import type {
  ArchiveListing,
  ChromPoint,
  FileMeta,
  FileSummary,
  LoadStage,
  ManifestEntry,
  ParquetInfo,
  SpectrumArrays,
  SpectrumIndexRow,
  StudyMetadata,
} from "../reader/types";

// The live reader is held OUTSIDE zustand state — it is a large object full of
// Arrow tables and WASM handles that React must never diff or re-render against.
let reader: Reader | null = null;

// Bumped on every load so a slow async scan from a previous file can detect that
// a newer file has superseded it and bail out instead of clobbering state.
let loadGen = 0;

// The single in-flight per-spectrum scan, shared so concurrent callers (the
// auto-scan on open, "Build TIC", and the MS-level filter) all await the SAME
// pass instead of each kicking off a duplicate or no-oping while one is running.
let scanInFlight: Promise<void> | null = null;

// ── In-memory spectrum cache + background preloader ─────────────────────────
// After a file opens, decoded spectrum signal arrays are cached (insertion-order
// LRU) so navigating spectra is instant. A background pass preloads as many as
// fit in a memory budget. The cache is keyed by spectrum index and reset on each
// new load; the preloader cancels via the loadGen check.
let specCache = new Map<number, SpectrumArrays>();
let specCacheBytes = 0;

// ── User-configurable cache settings ────────────────────────────────────────
// Persisted in sessionStorage (per browser session) and presettable via URL
// (?preload=0/1, ?cacheMB=<n>). `cacheBudgetBytes` / `preloadEnabled` mirror the
// settings as plain module vars so the hot cache paths don't read React state.
export type Settings = { preload: boolean; cacheMB: number };
const SETTINGS_KEY = "mzpe.settings";

/** Default budget: scale modestly with device memory, clamped to a tab-safe range. */
function defaultCacheMB(): number {
  const gb = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  return Math.min(Math.max(Math.round(gb * 96), 192), 768);
}
function clampMB(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), 4096) : defaultCacheMB();
}
function loadSettings(): Settings {
  const s: Settings = { preload: true, cacheMB: defaultCacheMB() };
  try {
    const raw = sessionStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<Settings>;
      if (typeof j.preload === "boolean") s.preload = j.preload;
      if (typeof j.cacheMB === "number") s.cacheMB = clampMB(j.cacheMB);
    }
  } catch {
    /* ignore malformed/blocked storage */
  }
  try {
    const p = new URLSearchParams(location.search); // URL preset/override
    const pl = p.get("preload");
    if (pl != null) s.preload = !/^(0|false|off|no)$/i.test(pl);
    const mb = p.get("cacheMB") ?? p.get("cachemb");
    if (mb != null) s.cacheMB = clampMB(Number(mb));
  } catch {
    /* no window / bad search */
  }
  return s;
}
function saveSettings(s: Settings): void {
  try {
    sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const initialSettings = loadSettings();
saveSettings(initialSettings); // persist a URL-preset for the rest of the session
let cacheBudgetBytes = initialSettings.cacheMB * 1024 * 1024;
let preloadEnabled = initialSettings.preload;
// The load generation whose preloader is currently running (null = none). Scoped
// by gen — not a bare boolean — so opening a new file can start its own preloader
// even while a previous gen's preloader is still unwinding its last in-flight read.
let preloadGen: number | null = null;
// Remote (HTTP) files do NOT background-preload automatically: every cold
// spectrum read is a large row-group range request, so eagerly fetching all
// spectra saturates the connection and starves foreground navigation. The user
// can still force it on via the Settings gear (setSettings bypasses this).
let remoteSource = false;

function specBytes(s: SpectrumArrays): number {
  return s.mz.byteLength + s.intensity.byteLength;
}

function resetSpecCache(): void {
  specCache = new Map();
  specCacheBytes = 0;
  inflightSpectra.clear();
}

/** Evict oldest cached spectra until within the current budget (keeps ≥1). */
function evictToBudget(): void {
  while (specCacheBytes > cacheBudgetBytes && specCache.size > 1) {
    const oldest = specCache.keys().next().value as number;
    const old = specCache.get(oldest);
    specCache.delete(oldest);
    if (old) specCacheBytes -= specBytes(old);
  }
}

// All signal reads (spectrum arrays, XIC/TIC extraction) go through the read
// scheduler so the vendored reader is never invoked reentrantly. Reads run on two
// lanes: user-triggered `priorityRead`s preempt the background preloader's
// `backgroundRead`s, so navigation never waits behind speculative buffering
// (beyond at most one already-in-flight read — the reader has no AbortSignal).
// Cache hits bypass the scheduler entirely, so once preloaded navigation is
// instant. See ./readScheduler for the full rationale.

/** Insert (or refresh) a spectrum, evicting the oldest entries past the budget. */
function cacheSpectrum(index: number, s: SpectrumArrays): void {
  if (specCache.has(index)) {
    specCache.delete(index); // re-insert to mark most-recently-used
    specCache.set(index, s);
    return;
  }
  specCache.set(index, s); // newest → last, so eviction (oldest-first) spares it
  specCacheBytes += specBytes(s);
  evictToBudget();
}

// Coalesce concurrent reads of the SAME spectrum: if the preloader is already
// fetching an index when the user navigates to it (or vice-versa), the second
// caller piggybacks on the in-flight promise instead of issuing a duplicate
// row-group request. Keyed by index; an entry self-removes when it settles.
const inflightSpectra = new Map<number, Promise<SpectrumArrays | null>>();

/**
 * Read a spectrum's arrays through the scheduler, with in-flight de-duplication
 * and two safety re-checks evaluated when the scheduled slot actually starts
 * (it may have been queued behind an in-flight read for a while):
 *   • returns `null` if a newer file superseded this one (stale `gen`) — so the
 *     caller skips reader I/O on a torn-down file rather than erroring;
 *   • returns the cached copy if a peer read populated it while we waited.
 * `lane` is `priorityRead` (user) or `backgroundRead` (preloader).
 */
function readSpectrumArrays(
  r: Reader,
  index: number,
  gen: number,
  lane: typeof priorityRead,
): Promise<SpectrumArrays | null> {
  const existing = inflightSpectra.get(index);
  if (existing) return existing;
  const p = lane(async () => {
    if (gen !== loadGen) return null; // a newer file loaded while we were queued
    const cached = specCache.get(index);
    if (cached) return cached; // a peer read already fetched it
    return await getSpectrumArrays(r, index);
  }).finally(() => {
    if (inflightSpectra.get(index) === p) inflightSpectra.delete(index);
  });
  inflightSpectra.set(index, p);
  return p;
}

export type Tab = "summary" | "metadata" | "spectra" | "chromatograms" | "structure";
export type ChromMode = "tic" | "xic" | "stored";

type XicParams = { mz: number; tolDa: number };

type State = {
  tab: Tab;
  stage: LoadStage;
  error: string | null;

  fileName: string | null;
  fileSize: number | null;
  /** Set when the file was opened from a URL (enables the shareable deep link). */
  sourceUrl: string | null;
  summary: FileSummary | null;
  fileMeta: FileMeta | null;
  manifest: ManifestEntry[];
  indexMeta: unknown;
  /** Embedded SDRF/ISA study metadata, parsed async after open; null when absent. */
  studyMeta: StudyMetadata | null;

  // The per-spectrum scan (msLevels / ranges / Browse index) is expensive on a
  // huge file, so it is NOT run on open — only on demand or for small files.
  scanning: boolean;
  scanned: boolean;
  /** 0..1 while a scan runs, else null. */
  scanProgress: number | null;

  // Browse state
  spectra: SpectrumIndexRow[];
  /** When set, Prev/Next step only through spectra of this MS level. */
  msLevelFilter: number | null;
  selectedIndex: number | null;
  selectedSpectrum: SpectrumArrays | null;
  /** Plainified full metadata for the selected spectrum (params, scans, precursors). */
  selectedMeta: unknown;
  spectrumLoading: boolean;

  chromMode: ChromMode;
  chrom: ChromPoint[] | null;
  chromLoading: boolean;
  xicParams: XicParams | null;
  /** Retention-time window [start, end] (seconds) the current TIC/XIC is
   *  restricted to, or null for the whole run. Carried in the share link as ?rt=. */
  chromTimeRange: [number, number] | null;
  /** Id of the stored chromatogram on screen when chromMode === "stored". */
  chromStoredId: string | null;
  storedChromIds: { index: number; id: string }[];
  /** True once the Browse tab has lazily loaded its first spectrum + cheap TIC. */
  browseInited: boolean;
  /** Spectra preloaded into the in-memory cache (background buffering progress). */
  buffered: number;
  /** Current spectrum-plot m/z view [lo, hi], or null at full range (for Share view). */
  spectrumZoom: [number, number] | null;
  /** Cache/preload settings (persisted per session; presettable via URL). */
  settings: Settings;
};

type Actions = {
  setTab: (tab: Tab) => void;
  openFile: (file: File) => Promise<void>;
  /** `deferPreload` suppresses the open-time background preload so a deep-linked
   *  spectrum can load first; call `startPreload()` once it has. */
  openUrl: (url: string, opts?: { deferPreload?: boolean }) => Promise<void>;
  /** Run the per-spectrum scan on demand (MS levels, ranges, Browse index). */
  computeBreakdown: () => Promise<void>;
  initBrowse: () => Promise<void>;
  selectSpectrum: (index: number) => Promise<void>;
  selectByTime: (time: number) => Promise<void>;
  /** Restrict Prev/Next navigation to one MS level (null = all). Scans if needed. */
  setMsLevelFilter: (level: number | null) => Promise<void>;
  /** Move to the next (+1) / previous (-1) spectrum, honoring the MS-level filter. */
  stepSpectrum: (dir: 1 | -1) => Promise<void>;
  /** Extract an XIC for m/z `mz` ± `tolDa`, optionally restricted to RT window
   *  `timeRange` (seconds). Passing null/omitting the window spans the whole run. */
  runXic: (mz: number, tolDa: number, timeRange?: [number, number] | null) => Promise<void>;
  /** Build the TIC, optionally restricted to RT window `timeRange` (seconds). */
  showTic: (timeRange?: [number, number] | null) => Promise<void>;
  /** Show a stored chromatogram (e.g. the TIC) by index or id; used by ?chrom= deep links. */
  showStoredChromatogram: (idOrIndex: string) => Promise<boolean>;
  /** Jump to the spectrum with this native scan number (from its id); used by ?scan= deep links. */
  selectByScanNumber: (scan: number) => Promise<boolean>;
  /** Set the current spectrum-plot m/z view (null = full range); for Share view. */
  setSpectrumZoom: (range: [number, number] | null) => void;
  /** Start the background preloader (used after a deep-linked spectrum has loaded). */
  startPreload: () => void;
  /** Update cache/preload settings (persisted; resizes the cache, (re)starts preload). */
  setSettings: (partial: Partial<Settings>) => void;
  /** Read the raw embedded SDRF/ISA blob text (for the "View raw" affordance). */
  getStudyBlob: () => Promise<string | null>;
};

const initial: State = {
  tab: "summary",
  stage: "idle",
  error: null,
  fileName: null,
  fileSize: null,
  sourceUrl: null,
  summary: null,
  fileMeta: null,
  manifest: [],
  indexMeta: null,
  studyMeta: null,
  scanning: false,
  scanned: false,
  scanProgress: null,
  spectra: [],
  selectedIndex: null,
  selectedSpectrum: null,
  selectedMeta: null,
  spectrumLoading: false,
  chromMode: "tic",
  chrom: null,
  chromTimeRange: null,
  chromLoading: false,
  xicParams: null,
  chromStoredId: null,
  spectrumZoom: null,
  storedChromIds: [],
  browseInited: false,
  buffered: 0,
  settings: initialSettings,
  msLevelFilter: null,
};

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Native scan number embedded in a spectrum id (e.g.
 * `controllerType=0 controllerNumber=1 scan=229` → 229), or null when the id
 * carries no `scan=<digits>` token. Used to resolve `?scan=` deep links.
 */
function parseScanNumber(id: string): number | null {
  const m = /(?:^|[\s;])scan=(\d+)\b/i.exec(id);
  return m ? Number(m[1]) : null;
}

export const useStore = create<State & Actions>((set, get) => ({
  ...initial,

  // Switching views clears any per-action error banner (a failed signal decode
  // on one view must not bleed into the others).
  setTab: (tab) => set({ tab, error: null }),

  async openFile(file) {
    await load(set, get, file.name, file.size, () => openBlob(file), null);
  },

  async openUrl(url, opts) {
    const name = url.split("/").pop() || url;
    await load(set, get, name, null, () => openUrl(url), url, opts?.deferPreload ?? false);
  },

  // Run the per-spectrum scan on demand (the "Compute breakdown" / "Build TIC" /
  // MS-level filter paths). Awaits the in-flight scan if one is already running,
  // so callers reliably have the Browse index when this resolves.
  async computeBreakdown() {
    await ensureScan(set, get);
  },

  // Lazily load the Browse tab's first spectrum on first visit. Loads ONE
  // spectrum (cheap) and shows a cheap TIC only if the per-spectrum index has
  // already been scanned. The scan itself is on demand (Build TIC), never here.
  async initBrowse() {
    if (!reader || get().browseInited) return;
    set({ browseInited: true });
    const n = get().summary?.numSpectra ?? 0;
    if (n > 0) void get().selectSpectrum(get().selectedIndex ?? 0);
    // Seed the default TIC ONLY when no chromatogram is already in play — a
    // deep-linked XIC / stored chromatogram (chromMode !== "tic", or a TIC already
    // built) must not be clobbered when the Chromatograms tab mounts.
    const cheap = cheapTic(get().spectra);
    if (cheap && get().chromMode === "tic" && !get().chrom) set({ chrom: cheap });
  },

  async selectSpectrum(index) {
    const r = reader;
    if (!r) return;
    const gen = loadGen;
    try {
      const meta = getSpectrumMetadata(r, index);
      if (gen !== loadGen) return; // a newer file loaded while we read
      // Cache hit (preloaded or previously viewed): show instantly, no spinner.
      const cached = specCache.get(index);
      if (cached) {
        cacheSpectrum(index, cached); // refresh LRU
        set({ selectedIndex: index, selectedMeta: meta, selectedSpectrum: cached, spectrumLoading: false, error: null, spectrumZoom: null });
        return;
      }
      // Cache miss: metadata is instant; show the spinner while the signal loads.
      set({ selectedIndex: index, spectrumLoading: true, selectedMeta: meta, selectedSpectrum: null, error: null, spectrumZoom: null });
      const spectrum = await readSpectrumArrays(r, index, gen, priorityRead);
      // Discard if a newer file loaded while we read — caching it would poison the
      // new file's index-keyed cache (a later hit could show old-file arrays).
      if (gen !== loadGen || spectrum == null) return;
      cacheSpectrum(index, spectrum); // same file → keep cached even if the user moved on
      // Only repaint if this spectrum is still the selected one.
      if (get().selectedIndex === index) {
        set({ selectedSpectrum: spectrum, spectrumLoading: false, buffered: specCache.size });
      } else {
        set({ buffered: specCache.size });
      }
    } catch (err) {
      // A spectrum that can't be decoded (e.g. an unsupported array compression)
      // is NOT fatal — the file stays open so Summary/Metadata/Structure still
      // work. Surface the error and clear the stale plot, but stay `ready`.
      if (gen === loadGen) {
        set({
          spectrumLoading: false,
          selectedSpectrum: null,
          error: `Could not decode this spectrum: ${describeError(err)}`,
        });
      }
    }
  },

  async selectByTime(time) {
    const rows = get().spectra;
    if (rows.length === 0) return;
    // Navigate within the active MS-level filter (so a TIC click on a filtered
    // browse stays on that level); fall back to all if the filter has no rows.
    const filter = get().msLevelFilter;
    const filtered = filter == null ? rows : rows.filter((r) => r.msLevel === filter);
    const pool = filtered.length > 0 ? filtered : rows;
    let best = pool[0];
    let bestD = Infinity;
    for (const r of pool) {
      const t = r.time ?? r.index;
      const d = Math.abs(t - time);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    await get().selectSpectrum(best.index);
  },

  async setMsLevelFilter(level) {
    // Reflect the choice immediately (the dropdown + "Resolving…" state), then
    // ensure the scan that knows each spectrum's MS level has completed.
    set({ msLevelFilter: level });
    if (level === null) return;
    if (!get().scanned) await get().computeBreakdown();
    // Ignore if the user changed the filter again while the scan ran.
    if (get().msLevelFilter !== level) return;
    // If the current spectrum isn't on the chosen level, jump to the first that
    // is (no-op when the file has no spectra at this level — the tab shows an
    // explicit empty state rather than silently reverting to all spectra).
    const rows = get().spectra;
    const cur = get().selectedIndex;
    const curRow = cur != null ? rows[cur] : undefined;
    if (!curRow || curRow.msLevel !== level) {
      const first = rows.find((r) => r.msLevel === level);
      if (first) await get().selectSpectrum(first.index);
    }
  },

  async stepSpectrum(dir) {
    const n = get().summary?.numSpectra ?? 0;
    if (n === 0) return;
    const cur = get().selectedIndex ?? 0;
    const filter = get().msLevelFilter;
    const rows = get().spectra;
    // No filter (or no scanned index yet): plain ±1 over all spectra.
    if (filter === null || rows.length === 0) {
      const next = cur + dir;
      if (next >= 0 && next < n) await get().selectSpectrum(next);
      return;
    }
    // rows[i] corresponds to spectrum i — walk to the next matching MS level.
    for (let i = cur + dir; i >= 0 && i < rows.length; i += dir) {
      if (rows[i]?.msLevel === filter) {
        await get().selectSpectrum(i);
        return;
      }
    }
  },

  async runXic(mz, tolDa, timeRange = null) {
    const r = reader;
    if (!r) return;
    const gen = loadGen;
    const tr = normalizeTimeRange(timeRange);
    set({ chromMode: "xic", chromLoading: true, xicParams: { mz, tolDa }, chromTimeRange: tr });
    try {
      // The data source (profile vs centroid) comes from the representation
      // counts, which are only known after the scan — without it a centroid-only
      // file would be queried as profile and come back empty.
      if (!get().scanned) await get().computeBreakdown();
      if (gen !== loadGen) return; // a newer file loaded
      const useProfile = (get().summary?.representationCounts.centroid ?? 0) === 0;
      const points = await priorityRead(() => extractChromatogram(r, { mz, tolDa, timeRange: tr, useProfile }));
      if (gen !== loadGen) return;
      set({ chrom: points, chromLoading: false, error: null });
    } catch (err) {
      // Non-fatal: keep the file open (see selectSpectrum).
      if (gen === loadGen) {
        set({ chromLoading: false, error: `Could not extract the XIC: ${describeError(err)}` });
      }
    }
  },

  async showTic(timeRange = null) {
    const r = reader;
    if (!r) return;
    const gen = loadGen;
    const tr = normalizeTimeRange(timeRange);
    set({ chromMode: "tic", chromLoading: true, xicParams: null, chromTimeRange: tr });
    try {
      // Need the per-spectrum index (promoted TIC column) — scan if not done.
      if (!get().scanned) await get().computeBreakdown();
      // A newer file loaded, or the scan failed (error already surfaced): bail.
      if (gen !== loadGen) return;
      if (!get().scanned) {
        set({ chromLoading: false });
        return;
      }
      const tic = await buildTic(r, get().spectra, tr);
      if (gen !== loadGen) return;
      if (tic === null) {
        set({ chromLoading: false });
        alert(
          `This file has no precomputed total-ion-current column, and summing ` +
            `${get().spectra.length.toLocaleString()} spectra in the browser is too ` +
            `expensive. Extract an XIC for a specific m/z window instead.`,
        );
        return;
      }
      set({ chrom: tic, chromLoading: false, error: null });
    } catch (err) {
      // Non-fatal: keep the file open (see selectSpectrum).
      if (gen === loadGen) {
        set({ chromLoading: false, error: `Could not build the chromatogram: ${describeError(err)}` });
      }
    }
  },

  async showStoredChromatogram(idOrIndex) {
    const r = reader;
    if (!r) return false;
    const ids = get().storedChromIds;
    if (ids.length === 0) {
      set({ tab: "chromatograms", error: "This file has no stored chromatograms." });
      return false;
    }
    const key = String(idOrIndex).trim();
    // Numeric → stored-chromatogram index; otherwise match the id (case-insensitive).
    let match = /^\d+$/.test(key) ? ids.find((c) => c.index === Number(key)) : undefined;
    if (!match) {
      const lk = key.toLowerCase();
      match = ids.find((c) => c.id.trim().toLowerCase() === lk);
    }
    if (!match) {
      set({ tab: "summary", error: `No chromatogram "${idOrIndex}" in this file.` });
      return false;
    }
    const gen = loadGen;
    set({
      tab: "chromatograms",
      chromMode: "stored",
      chromStoredId: match.id,
      xicParams: null,
      chromTimeRange: null,
      chromLoading: true,
      error: null,
    });
    try {
      const sc = await loadStoredChromatogram(match.index);
      if (gen !== loadGen) return false;
      if (!sc) {
        set({ tab: "summary", chromMode: "tic", chromLoading: false, error: `Chromatogram "${match.id}" has no data arrays.` });
        return false;
      }
      const pts: ChromPoint[] = new Array(sc.time.length);
      for (let i = 0; i < sc.time.length; i++) {
        pts[i] = { time: sc.time[i], index: i, intensity: sc.intensity[i] };
      }
      set({ chrom: pts, chromLoading: false });
      return true;
    } catch (err) {
      if (gen === loadGen) {
        set({ tab: "summary", chromMode: "tic", chromLoading: false, error: `Could not read chromatogram "${match.id}": ${describeError(err)}` });
      }
      return false;
    }
  },

  async selectByScanNumber(scan) {
    const r = reader;
    if (!r) return false;
    if (!Number.isFinite(scan)) {
      set({ tab: "summary", error: "The link's scan number is not a valid number." });
      return false;
    }
    const gen = loadGen;
    // Resolving a native scan number means reading every spectrum id, which is
    // exactly the per-spectrum scan. Run it on demand if it hasn't already.
    if (!get().scanned) await get().computeBreakdown();
    if (gen !== loadGen) return false;
    const row = get().spectra.find((s) => parseScanNumber(s.id) === scan);
    if (!row) {
      set({ tab: "summary", error: `No spectrum with scan number ${scan} in this file.` });
      return false;
    }
    set({ tab: "spectra", error: null });
    await get().selectSpectrum(row.index);
    return true;
  },

  async getStudyBlob() {
    const r = reader;
    const member = get().studyMeta?.provenance.member;
    if (!r || !member) return null;
    try {
      const m = await readArchiveMember(r, member);
      return m?.text ?? null;
    } catch {
      return null;
    }
  },

  setSpectrumZoom(range) {
    set({ spectrumZoom: range });
  },

  startPreload() {
    // Honors the remote-source policy: deep links to remote files load the target
    // spectrum but do not kick off background buffering (use the gear to force it).
    if (reader && !remoteSource && get().stage === "ready") {
      void preloadInBackground(set, get, reader, loadGen);
    }
  },

  setSettings(partial) {
    const cur = get().settings;
    const next: Settings = {
      preload: partial.preload ?? cur.preload,
      cacheMB: partial.cacheMB != null ? clampMB(partial.cacheMB) : cur.cacheMB,
    };
    saveSettings(next);
    set({ settings: next });
    preloadEnabled = next.preload;
    cacheBudgetBytes = next.cacheMB * 1024 * 1024;
    evictToBudget(); // a smaller budget drops the oldest cached spectra now
    set({ buffered: specCache.size });
    // Turning preload on (with a file open) kicks the background warm-up; turning
    // it off / shrinking the budget is honoured by the running loop's checks.
    if (preloadEnabled && reader && get().stage === "ready") {
      void preloadInBackground(set, get, reader, loadGen);
    }
  },
}));

/** Shared open path for file + URL loads. */
async function load(
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
  fileName: string,
  fileSize: number | null,
  open: () => Promise<Reader>,
  sourceUrl: string | null,
  deferPreload = false,
): Promise<void> {
  const gen = ++loadGen;
  remoteSource = sourceUrl != null; // remote files skip the automatic preloader
  scanInFlight = null; // any prior scan is now stale (it bails on the gen check)
  resetSpecCache(); // drop the previous file's cached spectra
  // Preserve the user's tab + cache settings across loads (don't reset them).
  set({ ...initial, tab: get().tab, settings: get().settings, stage: "loading", fileName, fileSize, sourceUrl });
  try {
    // Open reads only metadata + parquet footers — never the signal data.
    const opened = await open();
    if (gen !== loadGen) return; // a newer load superseded this one — discard
    reader = opened;

    // Fast overview: counts, layout, encodings, file metadata — O(1), shown now.
    const manifest = readManifest(reader);
    const summary = computeFastSummary(reader, manifest, fileName, fileSize);
    const fileMeta = readFileMeta(reader);
    const indexMeta = indexMetadata(reader);
    const storedChromIds = chromatogramIds(reader);

    set({
      stage: "ready",
      summary,
      fileMeta,
      manifest,
      indexMeta,
      storedChromIds,
      spectra: [],
      selectedIndex: null,
    });

    // Embedded SDRF/ISA study metadata: parse the blob async (reads one small ZIP
    // member + hashes it) so the overview paints first. Best-effort, non-fatal.
    void readStudyMetadata(opened, fileName)
      .then((studyMeta) => {
        if (gen === loadGen) set({ studyMeta });
      })
      .catch(() => {
        /* never block the file on study-metadata parsing */
      });

    // Per the "metadata + counts, nothing else" rule, the per-spectrum scan does
    // NOT run on open. Small files scan automatically in the background (it's
    // quick and fills MS levels / ranges / the TIC); large files wait for an
    // explicit "Compute breakdown" / "Build TIC" so opening stays instant.
    if (summary.numSpectra > 0 && summary.numSpectra <= AUTO_SCAN_LIMIT) {
      void ensureScan(set, get);
    }

    // Background warm-up: now that the overview is on screen, preload the TIC and
    // as many spectrum signal arrays as fit in the memory budget, so the Spectra
    // and Chromatograms tabs are already buffered when the user gets there.
    // Skipped for remote files (see remoteSource) and deferred for deep links
    // with a spectrum target (the App loads that spectrum first, then startPreload()).
    if (summary.numSpectra > 0 && !deferPreload && !remoteSource) {
      void preloadInBackground(set, get, opened, gen);
    }
  } catch (err) {
    if (gen !== loadGen) return;
    reader = null;
    set({ stage: "error", error: describeError(err) });
  }
}

/** Below this spectrum count, scan automatically on open; above it, on demand. */
const AUTO_SCAN_LIMIT = 50_000;

/**
 * Start the per-spectrum scan if it isn't running or already done, and return a
 * promise that resolves when it finishes. Deduplicates: every caller awaits the
 * same in-flight pass rather than racing duplicate scans (or no-oping while one
 * runs, which previously left the MS-level filter acting on an empty index).
 */
function ensureScan(
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
): Promise<void> {
  if (!reader || get().scanned) return Promise.resolve();
  if (!scanInFlight) {
    const r = reader;
    const gen = loadGen;
    const p = runScan(set, get, r, gen).finally(() => {
      if (scanInFlight === p) scanInFlight = null;
    });
    scanInFlight = p;
  }
  return scanInFlight;
}

/**
 * The time-sliced per-spectrum scan. Guarded against a newer load superseding
 * it. Updates progress as it goes and merges the aggregates + Browse index when
 * done. Returns when complete so callers (showTic) can await it.
 */
async function runScan(
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
  r: Reader,
  gen: number,
): Promise<void> {
  set({ scanning: true, scanProgress: 0 });
  let result: Awaited<ReturnType<typeof scanSpectra>>;
  try {
    result = await scanSpectra(r, (done, total) => {
      if (gen === loadGen) set({ scanProgress: total ? done / total : 1 });
    });
  } catch (err) {
    // Never leave the UI stuck "resolving": surface the failure and clear the
    // scanning flag so the MS-level filter and Build-TIC paths recover.
    if (gen === loadGen) {
      set({ scanning: false, scanProgress: null, error: describeError(err) });
    }
    return;
  }
  if (gen !== loadGen) return; // stale — a newer file is loading
  const { rows, aggregates } = result;
  const prev = get().summary;
  set({
    scanning: false,
    scanned: true,
    scanProgress: null,
    spectra: rows,
    // Merge aggregates, but the imaging flag is the OR of the index-block flag
    // (authoritative discovery) and the per-spectrum coordinate probe — the scan
    // must not downgrade a file the index block already declared as imaging.
    summary: prev
      ? { ...prev, ...aggregates, isImaging: prev.isImaging || aggregates.isImaging }
      : prev,
    selectedIndex: get().selectedIndex ?? (rows.length > 0 ? 0 : null),
  });
  // Preload the cheap TIC so the Chromatograms tab is ready before it's opened
  // (only when not already showing an XIC).
  const s = get();
  if (s.chromMode === "tic" && !s.chrom) {
    const cheap = cheapTic(rows);
    if (cheap) set({ chrom: cheap });
  }
}

/**
 * After the overview is shown, warm the caches in the background: ensure the scan
 * (cheap, column-based — fills the Browse index + TIC), then preload spectrum
 * signal arrays into the in-memory cache until the budget is hit. Cancels when a
 * newer file supersedes this one (gen check) and never blocks the UI (yields
 * between reads). Unreadable spectra (e.g. unsupported compression) are skipped.
 */
async function preloadInBackground(
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
  r: Reader,
  gen: number,
): Promise<void> {
  if (!preloadEnabled || preloadGen === gen) return; // disabled, or already warming this gen
  preloadGen = gen;
  try {
    // Index + TIC first (so Chromatograms is buffered). ensureScan dedupes with
    // the auto-scan; for large files this triggers the (fast) column scan in bg.
    await ensureScan(set, get);
    if (gen !== loadGen || !preloadEnabled) return;
    if (specCacheBytes >= cacheBudgetBytes) return; // nothing more fits
    const n = get().summary?.numSpectra ?? 0;
    if (n === 0) return;

    // Visit indices nearest the current selection first, so Prev/Next is instant.
    const sel = get().selectedIndex ?? 0;
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => Math.abs(a - sel) - Math.abs(b - sel),
    );

    // Single sequential pass on the background lane. A user-triggered read
    // (priorityRead) preempts any not-yet-started preload read; and before each
    // read we wait out `userIsActive()` so speculative buffering stays off the
    // wire during active navigation — the key win on low-bandwidth links.
    for (const idx of order) {
      if (gen !== loadGen || !preloadEnabled) return; // superseded or turned off
      if (specCacheBytes >= cacheBudgetBytes) return; // budget reached
      if (specCache.has(idx)) continue;
      // Yield to the user: pause while a user read is pending/in-flight or within
      // the post-read cooldown, re-checking the cancel conditions each tick.
      while (userIsActive()) {
        if (gen !== loadGen || !preloadEnabled) return;
        await new Promise<void>((res) => setTimeout(res, PRELOAD_COOLDOWN_MS));
      }
      if (specCache.has(idx)) continue; // may have been filled while we waited
      try {
        const s = await readSpectrumArrays(r, idx, gen, backgroundRead);
        // Re-check AFTER the await: a newer file, a preload toggle-off, or a
        // shrunk cache budget during the read must all abort before we cache.
        if (gen !== loadGen || !preloadEnabled || specCacheBytes >= cacheBudgetBytes) return;
        if (s != null) {
          cacheSpectrum(idx, s);
          set({ buffered: specCache.size });
        }
      } catch {
        // Skip spectra the reader can't decode — preloading must never error out.
      }
      await new Promise<void>((res) => setTimeout(res, 0)); // yield to the UI
    }
  } finally {
    if (preloadGen === gen) preloadGen = null; // only the owner clears the slot
  }
}

/**
 * The TIC is an MS1 trace by convention — only MS1 spectra contribute. Falls
 * back to all spectra when the file tags no MS1 (e.g. untagged levels) so the
 * trace is never spuriously empty.
 */
function ticRows(rows: SpectrumIndexRow[]): SpectrumIndexRow[] {
  const ms1 = rows.filter((row) => row.msLevel === 1);
  return ms1.length > 0 ? ms1 : rows;
}

/**
 * Cheap TIC: built entirely from the promoted per-spectrum TIC column (MS:1000285)
 * already in metadata — no signal I/O. MS1-only. Returns null when the column is
 * absent for any contributing spectrum (a TIC would then require a whole-file read).
 */
function cheapTic(rows: SpectrumIndexRow[]): ChromPoint[] | null {
  const use = ticRows(rows);
  if (use.length === 0 || !use.every((row) => row.tic !== null)) return null;
  return use
    .map((row) => ({
      index: row.index,
      time: row.time ?? row.index,
      intensity: row.tic as number,
    }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Build a total-ion chromatogram (MS1-only). Prefer the cheap metadata-only path.
 * The fallback sums every spectrum's signal — a whole-file read — so it is refused
 * above AUTO_SCAN_LIMIT spectra (returns null) to avoid freezing the browser on a
 * multi-gigabyte file that lacks a promoted TIC column.
 */
async function buildTic(
  r: Reader,
  rows: SpectrumIndexRow[],
  timeRange: [number, number] | null = null,
): Promise<ChromPoint[] | null> {
  const cheap = cheapTic(rows);
  // The cheap path is metadata-only, so a time window is just a post-filter.
  if (cheap) return timeRange ? cheap.filter((p) => p.time >= timeRange[0] && p.time <= timeRange[1]) : cheap;
  if (rows.length > AUTO_SCAN_LIMIT) return null; // too expensive to sum
  const useProfile = rows.some((row) => row.representation !== "centroid");
  const all = await priorityRead(() => extractChromatogram(r, { timeRange, useProfile }));
  // Restrict the summed trace to MS1 spectra.
  const ms1 = new Set(rows.filter((row) => row.msLevel === 1).map((row) => row.index));
  return ms1.size > 0 ? all.filter((p) => ms1.has(p.index)) : all;
}

/** Validate a RT window: finite, ordered, positive-width — else null (whole run). */
function normalizeTimeRange(tr: [number, number] | null | undefined): [number, number] | null {
  if (!tr) return null;
  const [a, b] = tr;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return [a, b];
}

/** Read a stored chromatogram by index (used by the Browse stored-chrom picker).
 *  User-triggered, so it goes through the priority lane — both to preempt the
 *  preloader and to keep this signal read from running the non-reentrant reader
 *  concurrently with a background spectrum read. */
export async function loadStoredChromatogram(index: number) {
  const r = reader;
  if (!r) return null;
  return priorityRead(() => getStoredChromatogram(r, index));
}

/** ZIP archive listing for the Structure tab (sync — entries are already loaded). */
export function getArchiveListing(): ArchiveListing | null {
  return reader ? listArchive(reader) : null;
}

/** Read an attached member's raw bytes for open/download (Structure tab).
 *  Capped at 256 MB — generous for embedded images / SDRF / ISA / Other members
 *  (the big parquet data tables aren't offered for download). */
export async function getArchiveMemberBytes(path: string): Promise<Uint8Array | null> {
  if (!reader) return null;
  const m = await readArchiveMember(reader, path, 256 * 1024 * 1024);
  return m?.bytes ?? null;
}

/** Parquet footer structure for one archive member (Structure tab, lazy). */
export async function getParquetInfo(filename: string): Promise<ParquetInfo | null> {
  if (!reader) return null;
  return readParquetInfo(reader, filename);
}

/** Deep per-column footer detail (encodings, page stats, min/max/null/distinct). */
export async function getDeepColumn(filename: string, columnPath: string) {
  if (!reader) return null;
  return deepColumn(reader, filename, columnPath);
}

/** Sample a scalar column's numeric values for a histogram (bounded read). */
export async function sampleColumn(filename: string, columnPath: string, limit?: number) {
  if (!reader) return null;
  return sampleColumnNumbers(reader, filename, columnPath, limit);
}
