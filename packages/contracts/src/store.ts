// Unified store shape + view-state model — the single source of truth the
// shell renders from. TYPES only (no zustand runtime here); the store implements
// this shape.
//
// The keystone idea: exactly one active `View` id, one selection model, and one
// settings-policy object. The URL module (./url) parses into / serializes from
// `ViewState` — the shareable subset of this store.

import type { CapabilityModel } from "./capability";

/** Every navigable view. The navigation rail maps 1:1 onto these ids. */
export type View =
  // always-on
  | "summary"
  | "spectra"
  // capability-gated (LC)
  | "chromatograms"
  // capability-gated — UV/VIS (wavelength / PDA / DAD) spectra (its own sidebar entry)
  | "wavelength"
  // Advanced accordion
  | "metadata"
  | "structure"
  // Imaging (MSI) accordion — gated on capabilities.imaging.isImaging.
  // Imaging modes: overview(TIC) / ion / multi(RGB) / optical / overlay(blend).
  | "overview"
  | "ion"
  | "multi"
  | "optical"
  | "overlay"
  | "grid";

export const ALL_VIEWS: readonly View[] = [
  "summary",
  "spectra",
  "chromatograms",
  "wavelength",
  "metadata",
  "structure",
  "overview",
  "ion",
  "multi",
  "optical",
  "overlay",
  "grid",
] as const;

/** Views that only make sense for imaging files. */
export const IMAGING_VIEWS: readonly View[] = ["overview", "ion", "multi", "optical", "overlay", "grid"] as const;
/** Views that only make sense for LC/general files. */
export const LC_VIEWS: readonly View[] = ["chromatograms", "wavelength"] as const;

/** Chromatogram display mode. */
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
  xic: { mz: number; tolDa: number; msLevel?: number } | null;
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

/** A non-blocking, dismissible notice (the cross-mode info banner lives here). */
export type Notice = {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  dismissible: boolean;
};

/**
 * The unified store shape. Imaging fields are present but inert for non-imaging
 * files (gated by `capabilities.imaging.isImaging`). The store provides actions;
 * this contract pins the state surface.
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
