import { describe, it, expect } from "vitest";
import type { BrowseIndex } from "@mzpeak/contracts";
import { buildLevelIndex, activeSet, rankOf, absoluteOf } from "./levelIndex";

// Build a minimal BrowseIndex from an MS-level pattern. Only msLevel is exercised by
// the mapping; id/rt/tic are filled to satisfy the type.
function browseFrom(levels: number[]): BrowseIndex {
  const n = levels.length;
  return {
    id: levels.map((_, i) => `scan=${i + 1}`),
    msLevel: Int16Array.from(levels),
    rt: new Float32Array(n),
    tic: new Float32Array(n),
  };
}

describe("buildLevelIndex", () => {
  it("returns empty structure for null browse", () => {
    const li = buildLevelIndex(null);
    expect(li.all).toEqual([]);
    expect(li.byLevel.size).toBe(0);
  });

  it("interleaves MS1/MS2 into ascending per-level absolute-index arrays", () => {
    // Absolute idx: 0   1   2   3   4   5
    //       level : 1   2   1   2   1   2
    const li = buildLevelIndex(browseFrom([1, 2, 1, 2, 1, 2]));
    expect(li.all).toEqual([0, 1, 2, 3, 4, 5]);
    expect(li.byLevel.get(1)).toEqual([0, 2, 4]);
    expect(li.byLevel.get(2)).toEqual([1, 3, 5]);
  });

  it("keeps each per-level list strictly ascending regardless of input order", () => {
    const li = buildLevelIndex(browseFrom([2, 2, 1, 1, 2, 1]));
    expect(li.byLevel.get(1)).toEqual([2, 3, 5]);
    expect(li.byLevel.get(2)).toEqual([0, 1, 4]);
  });

  it("buckets the -1 absent-level sentinel (MSLEVEL_ABSENT) on its own", () => {
    // The engine writes -1 for a spectrum with no MS level (core/adapt/browse.ts).
    const li = buildLevelIndex(browseFrom([1, -1, 1, -1]));
    expect(li.byLevel.get(-1)).toEqual([1, 3]);
    expect(li.byLevel.get(1)).toEqual([0, 2]);
  });
});

describe("activeSet", () => {
  const li = buildLevelIndex(browseFrom([1, 2, 1, 2, 1, 2]));

  it("returns the full all-indices array for null (All mode)", () => {
    expect(activeSet(li, null)).toBe(li.all);
  });

  it("returns the requested level's array", () => {
    expect(activeSet(li, 2)).toEqual([1, 3, 5]);
  });

  it("returns an empty array for an absent level", () => {
    expect(activeSet(li, 3)).toEqual([]);
  });
});

describe("rankOf (1-based, binary search over ascending set)", () => {
  it("maps absolute index to within-level rank — never exceeding the level count", () => {
    const li = buildLevelIndex(browseFrom([1, 2, 1, 2, 1, 2])); // 3 MS1, 3 MS2
    const ms2 = activeSet(li, 2); // [1, 3, 5]
    expect(rankOf(ms2, 1)).toBe(1);
    expect(rankOf(ms2, 3)).toBe(2);
    expect(rankOf(ms2, 5)).toBe(3); // the 6th absolute spectrum is MS2 #3, NOT #6
  });

  it("equals absolute index + 1 for the All set", () => {
    const li = buildLevelIndex(browseFrom([1, 2, 1, 2, 1, 2]));
    expect(rankOf(li.all, 0)).toBe(1);
    expect(rankOf(li.all, 5)).toBe(6);
  });

  it("returns null for an index not in the set", () => {
    const li = buildLevelIndex(browseFrom([1, 2, 1, 2]));
    expect(rankOf(activeSet(li, 1), 1)).toBeNull(); // abs 1 is MS2, not in MS1 set
  });

  it("scales: rank within a 1000-spectrum level stays in 1..1000", () => {
    // 1000 MS1 then 1000 MS2 (absolute 0..999 = MS1, 1000..1999 = MS2).
    const levels = [...Array(1000).fill(1), ...Array(1000).fill(2)];
    const li = buildLevelIndex(browseFrom(levels));
    const ms2 = activeSet(li, 2);
    expect(ms2.length).toBe(1000);
    expect(rankOf(ms2, 1000)).toBe(1); // first MS2 → #1
    expect(rankOf(ms2, 1999)).toBe(1000); // last MS2 → #1000, not #2000
  });
});

describe("absoluteOf (1-based rank → absolute index)", () => {
  const li = buildLevelIndex(browseFrom([1, 2, 1, 2, 1, 2]));
  const ms1 = activeSet(li, 1); // [0, 2, 4]

  it("round-trips with rankOf", () => {
    for (const abs of ms1) {
      const r = rankOf(ms1, abs)!;
      expect(absoluteOf(ms1, r)).toBe(abs);
    }
  });

  it("All-mode rank r maps to absolute r - 1", () => {
    expect(absoluteOf(li.all, 1)).toBe(0);
    expect(absoluteOf(li.all, 6)).toBe(5);
  });

  it("rejects out-of-range and non-integer ranks", () => {
    expect(absoluteOf(ms1, 0)).toBeNull();
    expect(absoluteOf(ms1, 4)).toBeNull(); // only 3 MS1 spectra
    expect(absoluteOf(ms1, 1.5)).toBeNull();
    expect(absoluteOf(ms1, NaN)).toBeNull();
  });
});
