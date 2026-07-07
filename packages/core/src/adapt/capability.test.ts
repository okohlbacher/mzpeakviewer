import { describe, it, expect } from "vitest";
import { buildCapabilityModel, applyImagingOverride, type CapabilityInput } from "./capability";

const base: CapabilityInput = {
  imagingSignals: [],
  probed: true,
  numChromatograms: 0,
  ticColumn: "unknown",
  opticalCount: 0,
  wavelengthCount: 0,
  mobilityPresent: false,
  layout: "point",
  encodings: [],
  unsupported: [],
};

describe("buildCapabilityModel mobility (IMS)", () => {
  it("mobilityPresent flows to capabilities.mobility.present + showMobility", async () => {
    const { showMobility } = await import("@mzpeak/contracts");
    expect(buildCapabilityModel(base).mobility.present).toBe(false);
    expect(showMobility(buildCapabilityModel(base))).toBe(false);
    const m = buildCapabilityModel({ ...base, mobilityPresent: true });
    expect(m.mobility.present).toBe(true);
    expect(showMobility(m)).toBe(true);
  });
});

describe("buildCapabilityModel", () => {
  it("non-imaging file: not imaging, no optical, chrom hidden", () => {
    const m = buildCapabilityModel(base);
    expect(m.imaging.isImaging).toBe(false);
    expect(m.imaging.detected).toBe(false);
    expect(m.imaging.confidence).toBe("probed");
    expect(m.optical.hasOptical).toBe(false);
  });

  it("any imaging signal flips detection + isImaging", () => {
    const m = buildCapabilityModel({ ...base, imagingSignals: ["ims-columns"] });
    expect(m.imaging.detected).toBe(true);
    expect(m.imaging.isImaging).toBe(true);
    expect(m.imaging.signals).toEqual(["ims-columns"]);
  });

  it("hint-only detection is marked confidence=hint", () => {
    const m = buildCapabilityModel({ ...base, imagingSignals: ["metadata-flag"], probed: false });
    expect(m.imaging.confidence).toBe("hint");
  });

  it("imaging file with stored chromatograms reports both (independent)", () => {
    const m = buildCapabilityModel({ ...base, imagingSignals: ["cv-params"], numChromatograms: 4 });
    expect(m.imaging.isImaging).toBe(true);
    expect(m.chromatograms.numChromatograms).toBe(4);
  });

  it("optical count drives hasOptical", () => {
    expect(buildCapabilityModel({ ...base, opticalCount: 2 }).optical).toEqual({ hasOptical: true, count: 2 });
  });
});

describe("applyImagingOverride", () => {
  it("force-on a non-detected file: isImaging true, override recorded", () => {
    const m = applyImagingOverride(buildCapabilityModel(base), true);
    expect(m.imaging.isImaging).toBe(true);
    expect(m.imaging.override).toBe(true);
    expect(m.imaging.detected).toBe(false); // detection unchanged
  });
  it("clearing the override falls back to detection", () => {
    const detected = buildCapabilityModel({ ...base, imagingSignals: ["ims-columns"] });
    const forcedOff = applyImagingOverride(detected, false);
    expect(forcedOff.imaging.isImaging).toBe(false);
    const cleared = applyImagingOverride(forcedOff, null);
    expect(cleared.imaging.isImaging).toBe(true);
  });
});
