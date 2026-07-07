import { describe, it, expect } from "vitest";
import {
  showChromatograms,
  hasDetectionDiscrepancy,
  type CapabilityModel,
} from "./capability";

const base: CapabilityModel = {
  imaging: { isImaging: false, detected: false, confidence: "probed", signals: [], override: null },
  chromatograms: { numChromatograms: 0, ticColumn: "unknown" },
  optical: { hasOptical: false, count: 0 },
  wavelength: { present: false, count: 0 },
  mobility: { present: false },
  layout: "point",
  encodings: [],
  unsupported: [],
};

describe("showChromatograms — independent of imaging (vibe MAJOR-4)", () => {
  it("hidden when no stored chromatograms and TIC unknown/absent", () => {
    expect(showChromatograms(base)).toBe(false);
    expect(showChromatograms({ ...base, chromatograms: { numChromatograms: 0, ticColumn: "absent" } })).toBe(false);
  });
  it("shown when stored chromatograms exist — even on an imaging file", () => {
    const c: CapabilityModel = {
      ...base,
      imaging: { ...base.imaging, isImaging: true, detected: true },
      chromatograms: { numChromatograms: 3, ticColumn: "unknown" },
    };
    expect(showChromatograms(c)).toBe(true);
  });
  it("shown once a TIC column is confirmed present", () => {
    expect(showChromatograms({ ...base, chromatograms: { numChromatograms: 0, ticColumn: "present" } })).toBe(true);
  });
});

describe("hasDetectionDiscrepancy — override vs auto-detection", () => {
  it("false with no override", () => {
    expect(hasDetectionDiscrepancy(base.imaging)).toBe(false);
  });
  it("true when the user forced a value the probe disagreed with", () => {
    expect(hasDetectionDiscrepancy({ ...base.imaging, detected: false, override: true, isImaging: true })).toBe(true);
  });
  it("false when override matches detection", () => {
    expect(hasDetectionDiscrepancy({ ...base.imaging, detected: true, override: true, isImaging: true })).toBe(false);
  });
});
