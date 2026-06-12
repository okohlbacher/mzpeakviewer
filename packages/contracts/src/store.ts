// Unified store shape + view-state model — the single source of truth the merged
// shell renders from. Phase-1 contract: TYPES only (no zustand runtime here). The
// Phase-4 store implements this shape; the two source stores (IV ~761 LOC, Explorer
// ~952 LOC) collapse into it.
//
// The keystone idea: exactly one active `View` id, one selection model, and one
// settings-policy object. The URL module (./url) parses into / serializes from
// `ViewState` — the shareable subset of this store.

import type { CapabilityModel } from "./capability";

/** Every navigable view. The §2 rail maps 1:1 onto these ids. */
export type View =
  // always-on
  | "summary"
  | "spectra"
  // capability-gated (LC)
  | "chromatograms"
  // Advanced accordion
  | "metadata"
  | "structure"
  // Imaging (MSI) accordion — gated on capabilities.imaging.isImaging
  | "ion"
  | "optical"
  | "overlay"
  | "grid";

export const ALL_VIEWS: readonly View[] = [
  "summary",
  "spectra",
  "chromatograms",
  "metadata",
  "structure",
  "ion",
  "optical",
  "overlay",
  "grid",
] as const;

/** Views that only make sense for imaging files. */
export const IMAGING_VIEWS: readonly View[] = ["ion", "optical", "overlay", "grid"] as const;
/** Views that only make sense for LC/general files. */
export const LC_VIEWS: readonly View[] = ["chromatograms"] as const;

/** Chromatogram display mode (Explorer parity). */
export type ChromMode = "tic" | "xic" | "stored";

/** How the active spectrum was chosen — drives canonical URL serialization. */
export type SpectrumSelector =
  | { by: "scan"; scan: number; index: number; id: string | null }
  | { by: "spectrum"; index: number; id: string | null }
  | { by: "pixel"; x: number; y: number; index: number; id: string | null }
  | null;

/**
 * The shareable view — exactly the state the URL round-trips. Kept deliberately
 * small; everything else in the store is derived or transient.
 */
export type ViewState = {
  sourceUrl: string | null;
  view: View;
  selector: SpectrumSelector;
  msLevelFilter: number | null;
  /** Spectrum-plot m/z zoom [lo, hi], or null at full range. */
  spectrumZoom: [number, number] | null;
  // chromatogram sub-state
  chromMode: ChromMode;
  xic: { mz: number; tolDa: number } | null;
  chromStoredId: string | null;
  chromTimeRange: [number, number] | null;
  // imaging sub-state
  ion: { mz: number; tolDa: number } | null;
  channels: { mz: number; tolDa: number; color: string }[];
  roi: [number, number, number, number] | null;
  opticalRef: string | null;
};

/** Cache + preload policy (decided on the main thread; enforced by the worker). */
export type SettingsPolicy = {
  preloadEnabled: boolean;
  /** Hard cache budget in bytes; 0 = automatic/device-aware. */
  cacheLimitBytes: number;
};

/** Load lifecycle the shell renders around. */
export type LoadPhase = "idle" | "loading" | "ready" | "error";

/** A non-blocking, dismissible notice (the §3.5 cross-mode info banner lives here). */
export type Notice = {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  dismissible: boolean;
};

/**
 * The unified store shape. Imaging fields are present but inert for non-imaging
 * files (gated by `capabilities.imaging.isImaging`). The Phase-4 store provides
 * actions; this contract pins the state surface.
 */
export type UnifiedState = {
  phase: LoadPhase;
  capabilities: CapabilityModel | null;
  view: ViewState;
  settings: SettingsPolicy;
  notices: Notice[];
  /** Accordion open/closed state (Advanced collapsed by default; MSI open in imaging). */
  expanded: { advanced: boolean; imaging: boolean };
  error: { class: string; message: string } | null;
};

/** Default shareable view (everything at rest → shortest possible link). */
export const DEFAULT_VIEW_STATE: ViewState = {
  sourceUrl: null,
  view: "summary",
  selector: null,
  msLevelFilter: null,
  spectrumZoom: null,
  chromMode: "tic",
  xic: null,
  chromStoredId: null,
  chromTimeRange: null,
  ion: null,
  channels: [],
  roi: null,
  opticalRef: null,
};
