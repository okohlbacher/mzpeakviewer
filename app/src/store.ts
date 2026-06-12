// Unified zustand store for the mzPeak viewer shell.
// Models @mzpeak/contracts UnifiedState extended with loaded payload fields.

import { create } from "zustand";
import type {
  CapabilityModel,
  FileStats,
  FileMeta,
  Manifest,
  ImagingGridWire,
  OpticalImageMeta,
  ChromatogramSeries,
  BrowseIndex,
} from "@mzpeak/contracts";
import { showChromatograms } from "@mzpeak/contracts";
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

  // navigation
  view: View;

  // spectrum selection
  /** How the active spectrum was chosen */
  selector: { by: "index"; index: number } | null;
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
  selectSpectrum: (index: number) => Promise<void>;
  loadChrom: (req: { mode: "tic" }) => Promise<void>;
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

  // navigation
  view: "summary",

  // spectrum
  selector: null,
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
    // Bump the sequence number BEFORE any async work so in-flight promises
    // from any previous openFile will see their seq as stale.
    const seq = ++currentOpenSeq;

    set({
      phase: "loading",
      error: null,
      capabilities: null,
      stats: null,
      fileMeta: null,
      manifest: null,
      grid: null,
      ticColumn: null,
      opticalImages: [],
      fileName: file.name,
      fileSize: null,
      view: "summary",
      selector: null,
      spectrum: null,
      browse: null,
      chrom: null,
      notices: [],
    });

    try {
      const bytes = await file.arrayBuffer();
      const opened = await engine.open({ kind: "file", bytes, name: file.name });

      // Stale guard: if a newer openFile was called while we were awaiting, drop.
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
        // Default accordion: Advanced closed; MSI open only for imaging files
        expanded: { advanced: false, imaging: isImaging },
        notices: opened.mixedRepresentationWarning
          ? [
              {
                id: "mixed-repr",
                severity: "warning" as const,
                message: opened.mixedRepresentationWarning,
              },
            ]
          : [],
      });

      // Kick off the scan-breakdown to populate browse index + stats.
      // FINDING 2: use the authoritative `ticColumn` field from the engine
      // result rather than guessing from browse.tic values (a valid all-zero
      // TIC would have been misread as absent).
      void engine.scanBreakdown().then(({ stats, browse, ticColumn }) => {
        // Stale guard: drop if a newer openFile started while we were in-flight.
        if (seq !== currentOpenSeq) return;
        set((s) => ({
          stats: { ...s.stats, ...stats },
          browse,
          capabilities: s.capabilities
            ? {
                ...s.capabilities,
                chromatograms: {
                  ...s.capabilities.chromatograms,
                  // Source ticColumn directly from the engine — not inferred.
                  ticColumn,
                },
              }
            : s.capabilities,
        }));
      }).catch(() => {
        // Non-fatal: scan breakdown failing doesn't break the core UI
      });

      // Pre-select spectrum 0 if file has spectra.
      // The stale guard is also enforced inside selectSpectrum via the engine's
      // SupersededError / CancelledError handling.
      if (opened.stats && opened.stats.numSpectra > 0) {
        // Stale guard: only issue the select if we're still the current open.
        if (seq !== currentOpenSeq) return;
        await get().selectSpectrum(0);
      }

    } catch (err) {
      // Stale guard: only apply error state if we're still the current open.
      if (seq !== currentOpenSeq) return;
      set({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  // -------------------------------------------------------------------------
  // openUrl — open a remote .mzpeak by URL (deep-link ?file= path).
  //
  // Mirrors openFile exactly (same stale-async race guard via currentOpenSeq,
  // same post-open set, same scanBreakdown follow-up + pre-select spectrum 0),
  // but the engine fetches the bytes itself via {kind:"url"} (HTTP range reads),
  // so there is no local arrayBuffer step. fileName is derived from the URL.
  // -------------------------------------------------------------------------
  openUrl: async (url: string) => {
    const seq = ++currentOpenSeq;

    // Derive a display name from the URL path's last segment.
    let displayName = url;
    try {
      const u = new URL(url, typeof location !== "undefined" ? location.href : undefined);
      const last = u.pathname.split("/").filter(Boolean).pop();
      if (last) displayName = decodeURIComponent(last);
    } catch {
      // Non-absolute / unparseable: keep the raw url as the display name.
    }

    set({
      phase: "loading",
      error: null,
      capabilities: null,
      stats: null,
      fileMeta: null,
      manifest: null,
      grid: null,
      ticColumn: null,
      opticalImages: [],
      fileName: displayName,
      fileSize: null,
      view: "summary",
      selector: null,
      spectrum: null,
      browse: null,
      chrom: null,
      notices: [],
    });

    try {
      const opened = await engine.open({ kind: "url", url });

      // Stale guard: if a newer open was called while we were awaiting, drop.
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
        expanded: { advanced: false, imaging: isImaging },
        notices: opened.mixedRepresentationWarning
          ? [
              {
                id: "mixed-repr",
                severity: "warning" as const,
                message: opened.mixedRepresentationWarning,
              },
            ]
          : [],
      });

      // Kick off the scan-breakdown to populate browse index + stats.
      void engine
        .scanBreakdown()
        .then(({ stats, browse, ticColumn }) => {
          if (seq !== currentOpenSeq) return;
          set((s) => ({
            stats: { ...s.stats, ...stats },
            browse,
            capabilities: s.capabilities
              ? {
                  ...s.capabilities,
                  chromatograms: {
                    ...s.capabilities.chromatograms,
                    ticColumn,
                  },
                }
              : s.capabilities,
          }));
        })
        .catch(() => {
          // Non-fatal: scan breakdown failing doesn't break the core UI
        });

      // Pre-select spectrum 0 if file has spectra.
      if (opened.stats && opened.stats.numSpectra > 0) {
        if (seq !== currentOpenSeq) return;
        await get().selectSpectrum(0);
      }
    } catch (err) {
      if (seq !== currentOpenSeq) return;
      set({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  // -------------------------------------------------------------------------
  // setView
  // -------------------------------------------------------------------------
  setView: (view: View) => {
    set({ view });
  },

  // -------------------------------------------------------------------------
  // selectSpectrum — load a spectrum by absolute index.
  // Stale-async guard: capture openSeq at call time; drop the result if a
  // newer openFile was issued while this request was in-flight.
  // -------------------------------------------------------------------------
  selectSpectrum: async (index: number) => {
    const seq = currentOpenSeq;
    set({ spectrumLoading: true, selector: { by: "index", index } });
    try {
      const spectrum = await engine.selectSpectrum(index);
      // Drop if a newer file was opened while we waited.
      if (seq !== currentOpenSeq) {
        set({ spectrumLoading: false });
        return;
      }
      set({ spectrum, spectrumLoading: false, view: "spectra" });
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

  // -------------------------------------------------------------------------
  // loadChrom — extract a chromatogram (TIC for now).
  // Stale-async guard: drop result if a newer openFile started.
  // -------------------------------------------------------------------------
  loadChrom: async ({ mode }: { mode: "tic" }) => {
    const seq = currentOpenSeq;
    set({ chromLoading: true });
    try {
      const series = await engine.extractChrom({ mode });
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

// Re-export helpers so views can use them without importing contracts directly
export { showChromatograms };
