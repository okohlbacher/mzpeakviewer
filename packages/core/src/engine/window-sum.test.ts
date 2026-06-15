// windowSumSorted (binary-search, cache-hit path) must equal windowSumScan (full scan, build
// path) for ascending m/z, with INCLUSIVE [lo,hi] boundaries and NaN/Inf skipped — the compact
// ion-cache's correctness rests on this equivalence.
import { describe, it, expect } from "vitest";
import { windowSumScan, windowSumSorted } from "./imaging";

describe("window-sum: scan vs sorted equivalence", () => {
  const mz = Float32Array.from([100, 200, 300, 400, 500, 600, 700]);
  const inten = Float32Array.from([1, 2, 3, 4, 5, 6, 7]);

  it("inclusive on both ends", () => {
    // [200,400] includes 200,300,400 → 2+3+4 = 9
    expect(windowSumScan(mz, inten, 200, 400)).toBe(9);
    expect(windowSumSorted(mz, inten, 200, 400)).toBe(9);
  });

  it("matches across many windows (incl. exact-boundary and empty)", () => {
    const bounds: [number, number][] = [
      [0, 1000], [150, 650], [200, 200], [199.9, 200.1], [700, 700],
      [701, 800], [0, 99], [350, 450], [100, 100], [600, 700],
    ];
    for (const [lo, hi] of bounds) {
      expect(windowSumSorted(mz, inten, lo, hi), `[${lo},${hi}]`).toBe(windowSumScan(mz, inten, lo, hi));
    }
  });

  it("skips NaN/Inf intensities", () => {
    const i2 = Float32Array.from([1, NaN, 3, Infinity, 5, 6, 7]);
    expect(windowSumScan(mz, i2, 100, 500)).toBe(1 + 3 + 5);
    expect(windowSumSorted(mz, i2, 100, 500)).toBe(1 + 3 + 5);
  });

  it("randomized equivalence on ascending data", () => {
    const n = 500;
    const m = new Float32Array(n);
    const v = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += 0.1 + ((i * 37) % 11) / 7; // strictly ascending
      m[i] = acc;
      v[i] = ((i * 13) % 97);
    }
    for (let k = 0; k < 40; k++) {
      const lo = (k * 17) % acc;
      const hi = lo + ((k * 29) % 50);
      expect(windowSumSorted(m, v, lo, hi)).toBe(windowSumScan(m, v, lo, hi));
    }
  });
});
