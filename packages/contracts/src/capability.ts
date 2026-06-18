// Capability model — the single source of truth for what a loaded file can do,
// and therefore which navigation surfaces the shell shows.
//
// Phase-1 contract (types only; no detection logic here — detection lives in the
// engine in Phase 3 and MUST populate this exact shape). The roadmap's §2 rail is
// gated on these capabilities, NOT on a single `isImaging` boolean.
//
// Adversarial-review fixes folded in:
//   - vibe CRITICAL-2: imaging detection standardizes on IV's `probeIsImaging`
//     3-signal semantics; Explorer's 1-signal `readImaging` is REPLACED, not kept.
//     The three signals are enumerated below as `ImagingSignal` so detection
//     parity is testable (NAV-07 / CTR-03).
//   - vibe MAJOR-4: `hasChromatograms` is derived from an explicit source
//     (`numChromatograms > 0` OR `hasTicColumn`), and `hasTicColumn` is a named
//     capability rather than an implicit check buried in a tab component.

/** The three independent signals that can mark a file as imaging (IV semantics). */
export type ImagingSignal =
  /** Promoted IMS position columns on scan records (IMS_1000050_position_x / _y). */
  | "ims-columns"
  /** CV params by accession on scans (IMS:1000050 / IMS:1000051). */
  | "cv-params"
  /** The `metadata.imaging.is_imaging === true` discovery flag in mzpeak_index.json. */
  | "metadata-flag";

/**
 * Detection runs in two phases (codex review #4): a cheap index-only HINT from
 * `metadata.imaging.is_imaging` available immediately, then the full 3-signal
 * PROBE after metadata loads. The roadmap's "standardize on probeIsImaging" is
 * only true once `confidence === "probed"`; the hint alone is IV's current fast
 * path and can misclassify a file that has IMS columns but no metadata flag.
 */
export type DetectionConfidence = "hint" | "probed";

/**
 * How `isImaging` was decided. Carries provenance so the detection-override UI
 * (MSI ▸ Grid / Summary) can surface *why* a file was or wasn't flagged, and so a
 * mis-detected file can be forced on/off with the discrepancy visible.
 */
export type ImagingDetection = {
  /** Effective imaging flag the UI gates on (after any user override). */
  isImaging: boolean;
  /** What auto-detection concluded, before override. */
  detected: boolean;
  /** Whether `detected` is from the cheap hint or the full 3-signal probe. */
  confidence: DetectionConfidence;
  /** Which of the 3 signals fired during the probe (empty when none / hint-only). */
  signals: ImagingSignal[];
  /**
   * User override, when the file was force-toggled. `null` = no override (use
   * `detected`). When set, `isImaging === override` and `override !== detected`
   * is the "discrepancy" the UI surfaces.
   */
  override: boolean | null;
};

/**
 * Tri-state capability presence (codex review #7). Some capabilities are not
 * knowable from the cheap fast-summary and only resolve after the time-sliced
 * scan pass — modeling them as a boolean would either hide a valid view until
 * the scan finishes or force an expensive scan just to build navigation.
 */
export type Presence = "unknown" | "present" | "absent";

/**
 * Chromatogram capability — INDEPENDENT of imaging (an MSI file with stored
 * chromatograms still shows the Chromatograms entry). vibe MAJOR-4 / codex #7.
 */
export type ChromatogramCapability = {
  /** Count of stored chromatograms — known immediately from `reader.numChromatograms`. */
  numChromatograms: number;
  /**
   * Whether a TIC can be computed from a TIC column / RT-bearing spectra.
   * `unknown` until the scan pass resolves it; the rail shows Chromatograms
   * optimistically once it is `present` (or numChromatograms>0).
   */
  ticColumn: Presence;
};

/** Optical-image capability (drives Optical + Overlay nav entries). */
export type OpticalCapability = {
  /** One or more embedded optical images are described in metadata. */
  hasOptical: boolean;
  /** Number of embedded optical images (0 when `hasOptical` is false). */
  count: number;
};

/**
 * UV/VIS (wavelength / PDA / DAD optical) spectra capability — INDEPENDENT of MS
 * spectra and of imaging. A file may carry wavelength spectra alongside MS spectra,
 * or be UV-only. Known immediately from `reader.numWavelengthSpectra` (the wavelength
 * metadata table is loaded eagerly at open), so this is a plain boolean + count, not a
 * tri-state Presence — no scan pass is needed to resolve it.
 */
export type WavelengthCapability = {
  /** Whether the file has one or more wavelength spectra. */
  present: boolean;
  /** Number of wavelength spectra (0 when `present` is false). */
  count: number;
  /** Observed wavelength range [minNm, maxNm] across the file's wavelength spectra, or
   *  null when unknown. Drives the Summary UV / VIS / UV-VIS band pill (MG-11). */
  range: [number, number] | null;
};

/**
 * The unified capability model. The shell derives nav visibility ONLY from this:
 *   - Summary, Spectra            → always
 *   - Chromatograms               → `chromatograms.numChromatograms > 0 || chromatograms.hasTicColumn`
 *   - Advanced (Metadata/Structure) → always (accordion)
 *   - Imaging (MSI) accordion     → `imaging.isImaging`
 *       - Optical / Overlay       → additionally `optical.hasOptical`
 */
export type CapabilityModel = {
  imaging: ImagingDetection;
  chromatograms: ChromatogramCapability;
  optical: OpticalCapability;
  /** UV/VIS (wavelength) spectra — drives the UV/VIS navigation surface. */
  wavelength: WavelengthCapability;
  /** Storage layout + encodings (diagnostics; carried from both readers). */
  /** "unknown" when the reader can't classify the layout (review: Explorer emits it). */
  layout: "point" | "chunked" | "mixed" | "unknown";
  encodings: string[];
  /** Findings the reader could not fully support (surfaced, never silently dropped). */
  unsupported: { code: string; label: string }[];
};

/** True when the Chromatograms nav entry should be shown (treats `unknown` as not-yet). */
export function showChromatograms(c: CapabilityModel): boolean {
  return c.chromatograms.numChromatograms > 0 || c.chromatograms.ticColumn === "present";
}

/** True when the UV/VIS (wavelength) nav entry should be shown. */
export function showWavelength(c: CapabilityModel): boolean {
  return c.wavelength.present;
}

/** True when Optical + Overlay nav entries should be shown (imaging-gated). */
export function showOptical(c: CapabilityModel): boolean {
  return c.imaging.isImaging && c.optical.hasOptical;
}

/** Whether auto-detection and the effective flag disagree (override in effect). */
export function hasDetectionDiscrepancy(d: ImagingDetection): boolean {
  return d.override !== null && d.override !== d.detected;
}
