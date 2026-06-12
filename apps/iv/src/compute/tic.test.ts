/**
 * Tests for tic.ts — buildTic (IMAGE-01 intensity-sum TIC raster).
 *
 * Pure-transform tests: synthetic ImagingGrid + a synthetic XIC-shaped object.
 * NO reader mock, NO binary fixture — buildTic receives only plain numbers and a
 * grid (D-08 boundary discipline). The bigint XICPoint.index is converted at the
 * FIRST op (Pitfall 1), so these tests deliberately feed `bigint` indices.
 *
 * Plan binding: 03-01 Task 1 behavior block, Tests 1–5.
 */
import { describe, it, expect } from "vitest";
import { buildTic } from "./tic";
import type { ImagingGrid } from "../imaging/types";

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Build a minimal dense `ImagingGrid` (only the fields buildTic reads), row-major
 * key = y0*width + x0, spectrum index == cell key. `absent` lists cell keys to
 * leave OUT of coordToSpectrumIndex (presenceMask 0).
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
 * Indices are emitted as `bigint` to exercise the boundary conversion.
 */
function makeXic(perSpectrum: Map<number, number[]>): XicLike {
  const points: XicLike["points"] = [];
  for (const [idx, arr] of perSpectrum) {
    points.push({ index: BigInt(idx), dataArrays: { "intensity array": arr } });
  }
  return { points };
}

// ── Test 1: dense 3×2 sum onto correct cell ───────────────────────────────────

describe("buildTic — dense 3×2 intensity sum (Test 1)", () => {
  it("sums each point's intensity array onto cell key = y0*width+x0", () => {
    const grid = makeGrid(3, 2);
    const per = new Map<number, number[]>();
    // key 0 -> sum 6, key 4 -> sum 30
    per.set(0, [1, 2, 3]);
    per.set(4, [10, 20]);
    const tic = buildTic(makeXic(per) as never, grid);

    expect(tic).toBeInstanceOf(Float32Array);
    expect(tic.length).toBe(6);
    expect(tic[0]).toBeCloseTo(6);
    expect(tic[4]).toBeCloseTo(30);
    // untouched present cells stay 0
    expect(tic[1]).toBe(0);
  });
});

// ── Test 2: orientation — no transpose/flip ───────────────────────────────────

describe("buildTic — orientation (Test 2)", () => {
  it("a spectrum at grid coord (x=2,y=0) lands at index 2, not a transposed index", () => {
    const grid = makeGrid(3, 2);
    // cell key for (x=2,y=0) zero-based = 0*3 + 2 = 2
    const per = new Map<number, number[]>();
    per.set(2, [5, 5]); // sum 10 at index 2
    const tic = buildTic(makeXic(per) as never, grid);

    expect(tic[2]).toBeCloseTo(10);
    // a flipped/transposed grid would have placed it at 0 (0*height+0) — assert NOT there
    expect(tic[0]).toBe(0);
  });
});

// ── Test 3: bigint boundary conversion ────────────────────────────────────────

describe("buildTic — bigint index boundary (Test 3)", () => {
  it("a bigint index scatters onto the same cell Number(index) would", () => {
    const grid = makeGrid(3, 2);
    // emit the point with an explicit bigint index; a Map.get(bigint) would miss
    const xic: XicLike = {
      points: [{ index: 4n, dataArrays: { "intensity array": [7, 8] } }],
    };
    const tic = buildTic(xic as never, grid);
    expect(tic[4]).toBeCloseTo(15);
  });
});

// ── Test 4: sparse skip ───────────────────────────────────────────────────────

describe("buildTic — sparse skip (Test 4)", () => {
  it("leaves an absent cell at 0 and skips off-grid spectrum indices without throwing", () => {
    const grid = makeGrid(3, 2, [5]); // cell key 5 absent
    const per = new Map<number, number[]>();
    per.set(0, [1, 1]); // present -> sum 2
    per.set(5, [99, 99]); // not on grid (absent) -> must be skipped
    per.set(999, [1, 1]); // off-grid spectrum index -> must be skipped
    let tic!: Float32Array;
    expect(() => {
      tic = buildTic(makeXic(per) as never, grid);
    }).not.toThrow();
    expect(tic[0]).toBeCloseTo(2);
    expect(tic[5]).toBe(0);
  });
});

// ── Test 5: missing / empty / non-finite intensity ────────────────────────────

describe("buildTic — missing/empty/non-finite intensity (Test 5)", () => {
  it("a point with no intensity array contributes nothing; non-finite elements treated as 0", () => {
    const grid = makeGrid(3, 2);
    const xic: XicLike = {
      points: [
        { index: 0n, dataArrays: {} }, // no "intensity array" key
        { index: 1n, dataArrays: { "intensity array": [1, NaN, Infinity, 4] } }, // NaN/Inf -> 0
      ],
    };
    let tic!: Float32Array;
    expect(() => {
      tic = buildTic(xic as never, grid);
    }).not.toThrow();
    expect(tic[0]).toBe(0); // no contribution, no NaN
    expect(Number.isNaN(tic[0])).toBe(false);
    expect(tic[1]).toBeCloseTo(5); // 1 + 0 + 0 + 4
  });
});
