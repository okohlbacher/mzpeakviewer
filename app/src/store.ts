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
  // openFile — open a local File through the engine worker
  // -------------------------------------------------------------------------
  openFile: async (file: File) => {
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

      // Kick off the scan-breakdown to populate browse index + stats
      const caps = opened.capabilities;
      void engine.scanBreakdown().then(({ stats, browse }) => {
        set((s) => ({
          stats: { ...s.stats, ...stats },
          browse,
          // Update ticColumn from browse if we have a tic column
          ticColumn: s.ticColumn,
          capabilities: s.capabilities
            ? {
                ...s.capabilities,
                chromatograms: {
                  ...s.capabilities.chromatograms,
                  ticColumn:
                    browse.tic.some((v) => v > 0) ? "present" : "absent",
                },
              }
            : s.capabilities,
        }));
      }).catch(() => {
        // Non-fatal: scan breakdown failing doesn't break the core UI
      });

      // Pre-select spectrum 0 if file has spectra
      if (opened.stats && opened.stats.numSpectra > 0) {
        await get().selectSpectrum(0);
      }

      // Auto-navigate to spectra if it's an LC file (no imaging)
      if (!isImaging && caps.chromatograms.numChromatograms === 0) {
        // stay on summary
      }

    } catch (err) {
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
  // selectSpectrum — load a spectrum by absolute index
  // -------------------------------------------------------------------------
  selectSpectrum: async (index: number) => {
    set({ spectrumLoading: true, selector: { by: "index", index } });
    try {
      const spectrum = await engine.selectSpectrum(index);
      set({ spectrum, spectrumLoading: false, view: "spectra" });
    } catch (err) {
      // SupersededError: a newer select was issued — don't overwrite the
      // newer result that's already been (or will be) set.
      const name = err instanceof Error ? err.name : "";
      if (name === "SupersededError" || name === "CancelledError") {
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
  // loadChrom — extract a chromatogram (TIC for now)
  // -------------------------------------------------------------------------
  loadChrom: async ({ mode }: { mode: "tic" }) => {
    set({ chromLoading: true });
    try {
      const series = await engine.extractChrom({ mode });
      set({ chrom: series, chromLoading: false });
    } catch (err) {
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
