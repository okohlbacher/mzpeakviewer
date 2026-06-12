import { describe, it, expect } from "vitest";
import { computeIonImageStats } from "./ionImage";

describe("computeIonImageStats", () => {
  it("computes nonzeroCount/min/max over a mixed array", () => {
    const img = new Float32Array([0, 5, 0, 2, 9, 0, 3]);
    const stats = computeIonImageStats(img);
    expect(stats.nonzeroCount).toBe(4); // 5, 2, 9, 3
    expect(stats.min).toBe(2);
    expect(stats.max).toBe(9);
  });

  it("excludes zero cells from min (background not counted as a low)", () => {
    const img = new Float32Array([0, 0, 7]);
    const stats = computeIonImageStats(img);
    expect(stats.nonzeroCount).toBe(1);
    expect(stats.min).toBe(7);
    expect(stats.max).toBe(7);
  });

  it("all-zero image → {0, 0, 0} (no Infinity leak)", () => {
    const stats = computeIonImageStats(new Float32Array([0, 0, 0, 0]));
    expect(stats).toEqual({ nonzeroCount: 0, min: 0, max: 0 });
  });

  it("empty image → {0, 0, 0}", () => {
    expect(computeIonImageStats(new Float32Array(0))).toEqual({
      nonzeroCount: 0,
      min: 0,
      max: 0,
    });
  });

  it("skips non-finite cells (NaN/Infinity)", () => {
    const img = new Float32Array([NaN, Infinity, 4, 8]);
    const stats = computeIonImageStats(img);
    expect(stats.nonzeroCount).toBe(2);
    expect(stats.min).toBe(4);
    expect(stats.max).toBe(8);
  });

  it("with a presenceMask: a PRESENT pixel of intensity 0 counts toward min (IV parity)", () => {
    // pixel 0 present & zero, pixel 1 present & 5, pixel 2 ABSENT & 99 (garbage).
    const img = new Float32Array([0, 5, 99]);
    const mask = new Uint8Array([1, 1, 0]);
    const stats = computeIonImageStats(img, mask);
    expect(stats.min).toBe(0); // present 0 included — NOT excluded as background
    expect(stats.max).toBe(5); // absent 99 excluded
    expect(stats.nonzeroCount).toBe(1); // only the present, non-zero pixel
  });

  it("with an all-absent presenceMask → safe zeros", () => {
    expect(computeIonImageStats(new Float32Array([3, 4]), new Uint8Array([0, 0]))).toEqual({
      nonzeroCount: 0,
      min: 0,
      max: 0,
    });
  });
});
