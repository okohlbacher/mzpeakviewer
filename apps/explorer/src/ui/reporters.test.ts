import { describe, it, expect } from "vitest";
import { extractReporters, spectrumReporters } from "./reporters";
import type { ChannelAssignment, SpectrumArrays } from "../reader/types";

const ch = (label: string, mz: number | null): ChannelAssignment => ({
  channelLabel: label, reporterMz: mz, role: "sample", tag: null,
  sampleId: null, sampleName: `s-${label}`, boundToThisRun: true,
});
const spec = (msLevel: number, mz: number[], inten: number[]): SpectrumArrays => ({
  index: 0, id: "x", msLevel, representation: "centroid", time: 0,
  mz: Float64Array.from(mz), intensity: Float32Array.from(inten),
});

describe("extractReporters", () => {
  const channels = [ch("TMT126", 126.1277), ch("TMT127N", 127.1248), ch("TMT131", 131.1382)];
  const mz = Float64Array.from([100, 126.1278, 127.125, 200]); // 131 absent
  const inten = Float32Array.from([5, 1000, 800, 50]);

  it("matches the most intense peak within tolerance", () => {
    const r = extractReporters(channels, mz, inten, 0.005);
    expect(r[0].intensity).toBe(1000);
    expect(r[0].matchedMz).toBeCloseTo(126.1278, 4);
    expect(r[1].intensity).toBe(800);
    expect(r[2].intensity).toBeNull(); // TMT131 not present
    expect(r[2].matchedMz).toBeNull();
  });

  it("takes the apex within the window (profile data)", () => {
    const m = [126.125, 126.1277, 126.13];
    const ii = [100, 900, 300];
    const r = extractReporters([ch("TMT126", 126.1277)], Float64Array.from(m), Float32Array.from(ii), 0.01);
    expect(r[0].intensity).toBe(900);
  });

  it("null reporter m/z → null quantity (no sentinel)", () => {
    const r = extractReporters([ch("TMTpro134N", null)], mz, inten);
    expect(r[0].intensity).toBeNull();
    expect(r[0].matchedMz).toBeNull();
  });
});

describe("spectrumReporters gating", () => {
  const channels = [ch("TMT126", 126.1277)];
  it("is dormant for MS1", () => {
    expect(spectrumReporters(channels, spec(1, [126.1277], [100])).matched).toBe(0);
  });
  it("is active for an MS2 with the reporter present", () => {
    const r = spectrumReporters(channels, spec(2, [126.1277], [500]));
    expect(r.matched).toBe(1);
    expect(r.reporters[0].intensity).toBe(500);
  });
  it("is dormant with no channels", () => {
    expect(spectrumReporters([], spec(2, [126.1277], [500])).matched).toBe(0);
  });
});
