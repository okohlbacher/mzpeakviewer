import { describe, it, expect } from "vitest";
import { buildBrowseIndex, type BrowseRow } from "./browse";

const rows: BrowseRow[] = [
  { id: "scan=1", msLevel: 1, time: 0.5, tic: 100 },
  { id: "scan=2", msLevel: 2, time: null, tic: 200 }, // absent rt → NaN
  { id: "scan=3", msLevel: null, time: 1.5, tic: null }, // absent msLevel/tic → 0
];

describe("buildBrowseIndex", () => {
  it("produces parallel typed arrays of length rows.length", () => {
    const idx = buildBrowseIndex(rows);
    expect(idx.id).toHaveLength(3);
    expect(idx.msLevel).toBeInstanceOf(Int16Array);
    expect(idx.rt).toBeInstanceOf(Float32Array);
    expect(idx.tic).toBeInstanceOf(Float32Array);
    expect(idx.msLevel).toHaveLength(3);
    expect(idx.rt).toHaveLength(3);
    expect(idx.tic).toHaveLength(3);
  });

  it("preserves order and id strings", () => {
    const idx = buildBrowseIndex(rows);
    expect(idx.id).toEqual(["scan=1", "scan=2", "scan=3"]);
    expect(Array.from(idx.msLevel)).toEqual([1, 2, 0]);
  });

  it("an absent-rt row columnarizes to NaN", () => {
    const idx = buildBrowseIndex(rows);
    expect(idx.rt[0]).toBeCloseTo(0.5);
    expect(Number.isNaN(idx.rt[1])).toBe(true);
    expect(idx.rt[2]).toBeCloseTo(1.5);
  });

  it("absent msLevel/tic coerce to 0 (typed slots cannot hold null)", () => {
    const idx = buildBrowseIndex(rows);
    expect(idx.msLevel[2]).toBe(0);
    expect(idx.tic[2]).toBe(0);
    expect(idx.tic[0]).toBe(100);
  });

  it("empty input yields empty parallel arrays", () => {
    const idx = buildBrowseIndex([]);
    expect(idx.id).toEqual([]);
    expect(idx.msLevel).toHaveLength(0);
    expect(idx.rt).toHaveLength(0);
    expect(idx.tic).toHaveLength(0);
  });
});
