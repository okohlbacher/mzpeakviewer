// Per-MS-level index mapping for the Spectra picker.
//
// The Spectra view numbers spectra by their position WITHIN the selected MS level
// (1-based), NOT by their absolute index or their native scan number. With 1000 MS1
// and 1000 MS2 spectra, the MS1 picker runs 1..1000 and the MS2 picker runs 1..1000 —
// the displayed number never exceeds the per-level count. "All" mode is the single
// exception: it numbers 1..numSpectra by absolute index + 1.
//
// To make that numbering navigable we precompute, once per file (memoized on the
// `browse` index), the ascending list of ABSOLUTE spectrum indices at each MS level.
// Relative index k (1-based) at level L  ↦  byLevel.get(L)![k-1] = the absolute index
// to hand to selectSpectrum. The reverse (absolute → 1-based rank) is a binary search
// because each per-level list is ascending. "All" mode uses `all` = [0, 1, …, n-1],
// for which rank(i) === i + 1 and absolute(r) === r - 1.

import type { BrowseIndex } from "@mzpeak/contracts";

export type LevelIndex = {
  /** MS level → ascending list of absolute spectrum indices at that level. */
  byLevel: Map<number, number[]>;
  /** Every absolute index in order — the "All" set: [0, 1, …, numSpectra-1]. */
  all: number[];
};

/**
 * Build the per-level mapping from the browse index. O(n), one pass. Called once per
 * file via a `browse`-keyed useMemo, so the arrays persist across renders and across
 * MS-level switches (switching just selects a different prebuilt array).
 */
export function buildLevelIndex(browse: BrowseIndex | null | undefined): LevelIndex {
  const byLevel = new Map<number, number[]>();
  const all: number[] = [];
  if (!browse) return { byLevel, all };
  const n = browse.msLevel.length;
  for (let i = 0; i < n; i++) {
    all.push(i);
    const lvl = browse.msLevel[i]!; // in-bounds (i < length); -1 = absent (MSLEVEL_ABSENT, see core/adapt/browse.ts)
    const arr = byLevel.get(lvl);
    if (arr) arr.push(i);
    else byLevel.set(lvl, [i]);
  }
  return { byLevel, all };
}

/**
 * The active set of absolute indices for the current filter: a single level's list,
 * or `all` when no level is selected (ALL mode). Returns a stable reference held by
 * the LevelIndex (no per-call allocation), so callers can compare/slice freely.
 */
export function activeSet(li: LevelIndex, level: number | null): number[] {
  if (level == null) return li.all;
  return li.byLevel.get(level) ?? [];
}

/**
 * 1-based rank of an absolute index within an (ascending) set, or null if absent.
 * Binary search since the per-level lists — and `all` — are strictly ascending.
 */
export function rankOf(set: number[], absIndex: number): number | null {
  let lo = 0;
  let hi = set.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = set[mid]!;
    if (v === absIndex) return mid + 1;
    if (v < absIndex) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/**
 * Absolute spectrum index for a 1-based rank within the active set, or null if the
 * rank is out of range. This is the navigation primitive: typed number → absolute.
 */
export function absoluteOf(set: number[], rank: number): number | null {
  if (!Number.isInteger(rank) || rank < 1 || rank > set.length) return null;
  return set[rank - 1]!;
}
