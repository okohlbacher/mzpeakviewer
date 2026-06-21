import { describe, it, expect } from "vitest";
import { packMobility, mobilityAt } from "./mobility";

describe("packMobility", () => {
  it("dictionary-encodes: distinct ascending values + per-peak index, lossless", () => {
    // Peaks arrive mobility-major with many repeats of a few bins (the timsTOF case).
    const raw = [1.20, 1.20, 0.85, 0.85, 0.85, 1.55, 1.20];
    const c = packMobility(raw);
    expect(Array.from(c.values)).toEqual([0.85, 1.2, 1.55]); // distinct, ascending
    expect(c.index instanceof Uint16Array).toBe(true); // ≤65535 distinct → Uint16
    // round-trip every peak
    for (let i = 0; i < raw.length; i++) expect(mobilityAt(c, i)).toBe(raw[i]);
    expect(Array.from(c.index)).toEqual([1, 1, 0, 0, 0, 2, 1]);
  });

  it("is compact: index width is 2 bytes/peak vs 8 for a raw f64 array", () => {
    const raw = Float64Array.from({ length: 1000 }, (_, i) => 0.6 + (i % 200) * 0.005);
    const c = packMobility(raw);
    expect(c.values.length).toBe(200); // only 200 distinct bins
    expect(c.index.byteLength).toBe(2000); // 1000 × Uint16
    expect(c.index.byteLength).toBeLessThan(raw.byteLength); // < 8000
  });

  it("handles a single-value frame and an empty input", () => {
    expect(Array.from(packMobility([1.1, 1.1, 1.1]).values)).toEqual([1.1]);
    const e = packMobility([]);
    expect(e.values.length).toBe(0);
    expect(e.index.length).toBe(0);
  });
});
