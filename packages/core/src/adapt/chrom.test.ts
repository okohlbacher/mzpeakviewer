import { describe, it, expect } from "vitest";
import { adaptChromatogram, type ChromInput } from "./chrom";

describe("adaptChromatogram", () => {
  it("coerces plain arrays to fresh Float32Arrays", () => {
    const input: ChromInput = {
      kind: "tic",
      time: [0, 1.5, 3],
      intensity: [10, 20, 30],
    };
    const s = adaptChromatogram(input);
    expect(s.time).toBeInstanceOf(Float32Array);
    expect(s.intensity).toBeInstanceOf(Float32Array);
    expect([...s.time]).toEqual([0, 1.5, 3]);
    expect([...s.intensity]).toEqual([10, 20, 30]);
  });

  it("copies (does not alias) an input Float32Array", () => {
    const time = Float32Array.from([1, 2, 3]);
    const intensity = Float32Array.from([4, 5, 6]);
    const s = adaptChromatogram({ kind: "xic", time, intensity });
    expect(s.time).not.toBe(time);
    expect(s.intensity).not.toBe(intensity);
    expect([...s.time]).toEqual([1, 2, 3]);
  });

  it("coerces from Float64Array sources", () => {
    const s = adaptChromatogram({
      kind: "tic",
      time: Float64Array.from([0.1, 0.2]),
      intensity: Float64Array.from([100, 200]),
    });
    expect(s.time).toBeInstanceOf(Float32Array);
    expect(s.time.length).toBe(2);
    expect(s.intensity[1]).toBe(200);
  });

  it("defaults id to null and preserves a stored id", () => {
    const tic = adaptChromatogram({ kind: "tic", time: [0], intensity: [1] });
    expect(tic.id).toBeNull();
    const stored = adaptChromatogram({
      kind: "stored",
      id: "TIC",
      time: [0],
      intensity: [1],
    });
    expect(stored.id).toBe("TIC");
  });

  it("handles each kind", () => {
    for (const kind of ["tic", "xic", "stored"] as const) {
      const s = adaptChromatogram({ kind, time: [0, 1], intensity: [2, 3] });
      expect(s.kind).toBe(kind);
    }
  });

  it("truncates to the min length when axes mismatch (intensity shorter)", () => {
    const s = adaptChromatogram({
      kind: "xic",
      time: [0, 1, 2, 3],
      intensity: [10, 20],
    });
    expect(s.time.length).toBe(2);
    expect(s.intensity.length).toBe(2);
    expect([...s.time]).toEqual([0, 1]);
    expect([...s.intensity]).toEqual([10, 20]);
  });

  it("truncates to the min length when axes mismatch (time shorter)", () => {
    const s = adaptChromatogram({
      kind: "tic",
      time: [5],
      intensity: [1, 2, 3],
    });
    expect(s.time.length).toBe(1);
    expect(s.intensity.length).toBe(1);
    expect([...s.time]).toEqual([5]);
    expect([...s.intensity]).toEqual([1]);
  });

  it("produces empty arrays for empty input", () => {
    const s = adaptChromatogram({ kind: "tic", time: [], intensity: [] });
    expect(s.time.length).toBe(0);
    expect(s.intensity.length).toBe(0);
  });
});
