import { describe, it, expect } from "vitest";
import { adaptSpectrum, type SpectrumInput } from "./spectrum";

const base: SpectrumInput = {
  index: 7,
  id: "scan=8",
  mz: [100.1, 200.2, 300.3],
  intensity: [10, 20, 30],
  representation: null,
};

describe("adaptSpectrum", () => {
  it("coerces plain number arrays to Float64Array / Float32Array", () => {
    const s = adaptSpectrum(base);
    expect(s.mz).toBeInstanceOf(Float64Array);
    expect(s.intensity).toBeInstanceOf(Float32Array);
    expect(Array.from(s.mz)).toEqual([100.1, 200.2, 300.3]);
    expect(Array.from(s.intensity)).toEqual([10, 20, 30]);
    expect(s.index).toBe(7);
    expect(s.id).toBe("scan=8");
  });

  it("COPIES already-typed arrays (transfer-safe — never aliases the reader's buffer)", () => {
    const mz = new Float64Array([1, 2]);
    const intensity = new Float32Array([3, 4]);
    const s = adaptSpectrum({ ...base, mz, intensity });
    expect(s.mz).not.toBe(mz); // distinct buffer, so transferring s.mz can't detach mz
    expect(s.intensity).not.toBe(intensity);
    expect(Array.from(s.mz)).toEqual([1, 2]); // ...but value-equal
    expect(Array.from(s.intensity)).toEqual([3, 4]);
  });

  it("maps MS:1000128 → profile", () => {
    expect(adaptSpectrum({ ...base, representation: "MS:1000128" }).representation).toBe("profile");
    expect(adaptSpectrum({ ...base, representation: "profile" }).representation).toBe("profile");
  });

  it("maps MS:1000127 → centroid", () => {
    expect(adaptSpectrum({ ...base, representation: "MS:1000127" }).representation).toBe("centroid");
    expect(adaptSpectrum({ ...base, representation: "centroid" }).representation).toBe("centroid");
  });

  it("maps null/undefined/unknown raw value → null", () => {
    expect(adaptSpectrum({ ...base, representation: null }).representation).toBeNull();
    expect(adaptSpectrum({ ...base, representation: undefined }).representation).toBeNull();
    expect(adaptSpectrum({ ...base, representation: "MS:9999999" }).representation).toBeNull();
  });
});
