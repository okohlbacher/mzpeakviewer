// PURE adapter: reader-extracted detection signals → the contract CapabilityModel.
// This is the template for every adapter in this package: a pure function from
// plain, already-extracted data (NO mzpeakts handle) to a wire type, with a unit
// test. The reader-I/O (extracting these signals) lives in the handler.

import type {
  CapabilityModel,
  ImagingSignal,
  Presence,
  UnsupportedFinding,
} from "@mzpeak/contracts";

/** The plain signals the `open` handler extracts from the reader. */
export type CapabilityInput = {
  /** Which of the 3 imaging signals fired during the probe (empty = none). */
  imagingSignals: ImagingSignal[];
  /**
   * `false` when only the cheap index hint has run so far (metadata flag only),
   * `true` once the full 3-signal probe completed. Drives `ImagingDetection.confidence`.
   */
  probed: boolean;
  /** Stored chromatogram count (reader.numChromatograms). */
  numChromatograms: number;
  /** TIC-column availability — `unknown` until the scan pass resolves it. */
  ticColumn: Presence;
  /** Embedded optical image count. */
  opticalCount: number;
  layout: "point" | "chunked" | "mixed";
  encodings: string[];
  unsupported: UnsupportedFinding[];
};

/**
 * Assemble a CapabilityModel from extracted signals. `detected` is the auto result
 * (any signal fired); `isImaging` is the effective flag (no override at open time).
 */
export function buildCapabilityModel(input: CapabilityInput): CapabilityModel {
  const detected = input.imagingSignals.length > 0;
  return {
    imaging: {
      isImaging: detected,
      detected,
      confidence: input.probed ? "probed" : "hint",
      signals: input.imagingSignals,
      override: null,
    },
    chromatograms: {
      numChromatograms: input.numChromatograms,
      ticColumn: input.ticColumn,
    },
    optical: {
      hasOptical: input.opticalCount > 0,
      count: input.opticalCount,
    },
    layout: input.layout,
    encodings: input.encodings,
    unsupported: input.unsupported,
  };
}

/** Apply a user detection override to an existing model (MSI ▸ Grid force on/off). */
export function applyImagingOverride(model: CapabilityModel, override: boolean | null): CapabilityModel {
  const isImaging = override === null ? model.imaging.detected : override;
  return { ...model, imaging: { ...model.imaging, override, isImaging } };
}
