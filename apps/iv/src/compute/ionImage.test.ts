/**
 * Tests for ionImage.ts — ppmToDa, buildIonImage, computeIonImageStats (IMAGE-02).
 *
 * Pure-transform tests: synthetic ImagingGrid + a synthetic XIC-shaped object.
 * NO reader mock, NO binary fixture — all functions receive only plain numbers and a
 * grid (boundary discipline, mirrors tic.test.ts). BigInt XICPoint.index is
 * converted at the FIRST op (Pitfall 1), so these tests deliberately feed `bigint`
 * indices.
 *
 * Plan binding: 04-01 Task 2 behavior block.
 */
import { describe, it, expect } from "vitest";
import { buildIonImage, computeIonImageStats, ppmToDa } from "./ionImage";
import type { ImagingGrid } from "../imaging/types";

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Build a minimal dense `ImagingGrid` (only the fields the compute functions
 * read), row-major key = y0*width + x0, spectrum index == cell key. `absent`
 * lists cell keys to leave OUT of coordToSpectrumIndex (presenceMask 0).
 */
function makeGrid(width: number, height: number, absent: number[] = []): ImagingGrid {
  const totalCells = width * height;
  const coordToSpectrumIndex = new Map<number, number>();
  const presenceMask = new Uint8Array(totalCells);
  const absentSet = new Set(absent);
  for (let key = 0; key < totalCells; key++) {
    if (absentSet.has(key)) continue;
    coordToSpectrumIndex.set(key, key); // spectrum index == cell key for these fixtures
    presenceMask[key] = 1;
  }
  return {
    width,
    height,
    coordinateBase: 1,
    pixelSizeUm: null,
    coordToSpectrumIndex,
    presenceMask,
    filledCount: coordToSpectrumIndex.size,
    totalCells,
    coordSourceStrategy: "promoted-columns",
    diagnostics: {
      spectrumCount: coordToSpectrumIndex.size,
      uniqueCoordCount: coordToSpectrumIndex.size,
      duplicateCount: 0,
      missingCount: totalCells - coordToSpectrumIndex.size,
      oobCount: 0,
      extentSource: "declared",
      geometrySource: "run-params",
      discoveryDisagreement: null,
    },
  };
}

type XicLike = {
  points: { index: bigint | number; dataArrays: Record<string, ArrayLike<number> | undefined> }[];
};

/**
 * Build an XIC-shaped object from a map of spectrumIndex -> intensity array.
 * Indices are emitted as `bigint` to exercise the boundary conversion (Pitfall 1).
 */
function makeXic(perSpectrum: Map<number, number[]>): XicLike {
  const points: XicLike["points"] = [];
  for (const [idx, arr] of perSpectrum) {
    points.push({ index: BigInt(idx), dataArrays: { "intensity array": arr } });
  }
  return { points };
}

// ── describe("ppmToDa") ───────────────────────────────────────────────────────

describe("ppmToDa", () => {
  it("ppmToDa(500, 10) returns exactly 0.005 — D-03 formula", () => {
    expect(ppmToDa(500, 10)).toBeCloseTo(0.005, 10);
  });

  it("ppmToDa(1000, 5) returns exactly 0.005 — D-03 formula", () => {
    expect(ppmToDa(1000, 5)).toBeCloseTo(0.005, 10);
  });

  it("ppmToDa(0, 10) returns 0 — zero m/z", () => {
    expect(ppmToDa(0, 10)).toBe(0);
  });

  it("ppmToDa(100, 0) returns 0 — zero ppm", () => {
    expect(ppmToDa(100, 0)).toBe(0);
  });

  it("ppmToDa formula: result === (mz * ppm) / 1e6", () => {
    const mz = 756.8;
    const ppm = 15;
    expect(ppmToDa(mz, ppm)).toBeCloseTo((mz * ppm) / 1e6, 10);
  });
});

// ── describe("buildIonImage — aggregation") ──────────────────────────────────

describe("buildIonImage — aggregation", () => {
  it("sums windowed intensities per grid cell for a dense 2×2 grid", () => {
    const grid = makeGrid(2, 2);
    const per = new Map<number, number[]>();
    // spectrum 0 → cell 0 (key=0): intensities [10, 20] → sum 30
    // spectrum 1 → cell 1 (key=1): intensities [5]    → sum 5
    per.set(0, [10, 20]);
    per.set(1, [5]);
    const img = buildIonImage(makeXic(per) as never, grid);

    expect(img).toBeInstanceOf(Float32Array);
    expect(img.length).toBe(4); // 2*2
    expect(img[0]).toBeCloseTo(30);
    expect(img[1]).toBeCloseTo(5);
    expect(img[2]).toBe(0);
    expect(img[3]).toBe(0);
  });

  it("output length equals width * height", () => {
    const grid = makeGrid(3, 4);
    const img = buildIonImage(makeXic(new Map()) as never, grid);
    expect(img.length).toBe(12);
  });

  it("off-grid spectrum indices are silently skipped (no throw, no corruption)", () => {
    const grid = makeGrid(2, 2);
    const per = new Map<number, number[]>();
    per.set(0, [10]);
    per.set(999, [99]); // off-grid
    let img!: Float32Array;
    expect(() => {
      img = buildIonImage(makeXic(per) as never, grid);
    }).not.toThrow();
    expect(img[0]).toBeCloseTo(10);
    // off-grid spectrum's value must not appear anywhere
    expect(img[1]).toBe(0);
    expect(img[2]).toBe(0);
    expect(img[3]).toBe(0);
  });

  it("non-finite values in dataArrays (NaN, Infinity) contribute 0, not NaN", () => {
    const grid = makeGrid(2, 2);
    const xic: XicLike = {
      points: [
        { index: 0n, dataArrays: { "intensity array": [1, NaN, Infinity, 4] } },
        { index: 1n, dataArrays: {} }, // no intensity array key
      ],
    };
    const img = buildIonImage(xic as never, grid);
    expect(img[0]).toBeCloseTo(5); // 1 + 0 + 0 + 4
    expect(Number.isNaN(img[0])).toBe(false);
    expect(img[1]).toBe(0); // no contribution
  });

  it("absent cells (not in coordToSpectrumIndex) stay at 0 even when XIC has data", () => {
    // cell key 2 is absent — if a spectrum claims index 2, it's skipped
    const grid = makeGrid(2, 2, [2]);
    const per = new Map<number, number[]>();
    per.set(0, [7]);
    per.set(2, [999]); // key 2 is absent from grid
    const img = buildIonImage(makeXic(per) as never, grid);
    expect(img[0]).toBeCloseTo(7);
    expect(img[2]).toBe(0); // absent → stays 0
  });
});

// ── describe("buildIonImage — bigint boundary") ──────────────────────────────

describe("buildIonImage — bigint boundary (Pitfall 1)", () => {
  it("BigInt(0) index resolves to cell 0, same as number 0", () => {
    const grid = makeGrid(2, 2);
    const per = new Map<number, number[]>();
    per.set(0, [10, 20]);
    per.set(1, [5]);
    // makeXic already emits BigInt indices
    const img = buildIonImage(makeXic(per) as never, grid);
    expect(img[0]).toBeCloseTo(30);
    expect(img[1]).toBeCloseTo(5);
  });

  it("explicit 4n index resolves to cell 4 in a 3×2 grid", () => {
    const grid = makeGrid(3, 2); // 6 cells
    const xic: XicLike = {
      points: [{ index: 4n, dataArrays: { "intensity array": [7, 8] } }],
    };
    const img = buildIonImage(xic as never, grid);
    expect(img[4]).toBeCloseTo(15);
    // no scatter to other cells
    for (let k = 0; k < 6; k++) {
      if (k !== 4) expect(img[k]).toBe(0);
    }
  });
});

// ── describe("computeIonImageStats") ─────────────────────────────────────────

describe("computeIonImageStats", () => {
  it("absent cells (presenceMask=0) are excluded from min, max, nonzeroCount", () => {
    // 2×2 grid; cell 2 is absent
    const grid = makeGrid(2, 2, [2]);
    // values: [10, 5, 999, 3] — cell 2 is absent, 999 must NOT appear in min/max
    const values = new Float32Array([10, 5, 999, 3]);
    const stats = computeIonImageStats(values, grid);
    expect(stats.min).toBeCloseTo(3);
    expect(stats.max).toBeCloseTo(10);
    expect(stats.nonzeroCount).toBe(3); // cells 0,1,3 are present and nonzero
  });

  it("present cell with value 0 is NOT counted in nonzeroCount", () => {
    const grid = makeGrid(2, 2);
    // cell 1 is present but has value 0
    const values = new Float32Array([5, 0, 0, 8]);
    const stats = computeIonImageStats(values, grid);
    expect(stats.nonzeroCount).toBe(2); // only cells 0 and 3 are nonzero
    expect(stats.min).toBeCloseTo(0);   // 0 is present, so it is the min
    expect(stats.max).toBeCloseTo(8);
  });

  it("all-absent grid returns { nonzeroCount: 0, min: 0, max: 0 } — not Infinity", () => {
    const grid = makeGrid(2, 2, [0, 1, 2, 3]); // all absent
    const values = new Float32Array([1, 2, 3, 4]);
    const stats = computeIonImageStats(values, grid);
    expect(stats.nonzeroCount).toBe(0);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
    expect(Number.isFinite(stats.min)).toBe(true);
    expect(Number.isFinite(stats.max)).toBe(true);
  });

  it("computes correct min/max over present cells in a typical case", () => {
    const grid = makeGrid(3, 2); // 6 cells, all present
    const values = new Float32Array([100, 50, 200, 10, 75, 150]);
    const stats = computeIonImageStats(values, grid);
    expect(stats.min).toBeCloseTo(10);
    expect(stats.max).toBeCloseTo(200);
    expect(stats.nonzeroCount).toBe(6); // all nonzero
  });

  it("non-finite values in Float32Array are excluded from stats", () => {
    const grid = makeGrid(2, 1); // 2 cells
    const values = new Float32Array([Infinity, 5]);
    const stats = computeIonImageStats(values, grid);
    // Infinity is excluded, only 5 counts
    expect(stats.min).toBeCloseTo(5);
    expect(stats.max).toBeCloseTo(5);
    expect(stats.nonzeroCount).toBe(1);
  });
});
