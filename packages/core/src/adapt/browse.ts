// PURE adapter: per-spectrum Browse rows → the contract BrowseIndex.
// Follows the capability.ts template: a pure function from plain, already-extracted
// data (NO Arrow vectors, no reader handle) to a wire type, with a unit test. The
// reader-I/O (the single column pass that produces these rows) lives in the worker
// handler — this only columnarizes into transferable parallel typed arrays.

import type { BrowseIndex } from "@mzpeak/contracts";

/**
 * One per-spectrum Browse row carrying the load-bearing fields (id/msLevel/time/tic
 * per spectrum). `time` is retention time in SECONDS straight off the metadata
 * `time` column (number | null); null where the column is absent.
 * `msLevel`/`tic` are likewise nullable (numOrNull yields null for missing cells).
 */
export type BrowseRow = {
  /** Native spectrum id string (carries the native scan number when present). */
  id: string;
  /** MS level (1, 2, …); null when absent. */
  msLevel: number | null;
  /** Retention time in seconds; null when absent → NaN in the columnar output. */
  time: number | null;
  /** Total ion current; null when absent → 0 in the columnar output. */
  tic: number | null;
};

/**
 * Columnarize Browse rows into the wire `BrowseIndex` — parallel arrays of length
 * `rows.length`, order preserved. Absence sentinels (0 collides with real values —
 * a valid msLevel 0 / TIC 0 must be distinguishable from missing metadata):
 *   - `rt`  (Float32): NaN where `time` is absent.
 *   - `tic` (Float32): NaN where absent (NOT 0 — 0 is a real empty-spectrum TIC).
 *   - `msLevel` (Int16): {@link MSLEVEL_ABSENT} (-1) where absent (out of the valid
 *      ≥1 range, so the MS-level filter can exclude it). Index `i` = spectrum `i`.
 */
export const MSLEVEL_ABSENT = -1;

export function buildBrowseIndex(rows: BrowseRow[]): BrowseIndex {
  const n = rows.length;
  const id: string[] = new Array(n);
  const msLevel = new Int16Array(n);
  const rt = new Float32Array(n);
  const tic = new Float32Array(n);

  let i = 0;
  for (const r of rows) {
    id[i] = r.id;
    msLevel[i] = r.msLevel ?? MSLEVEL_ABSENT;
    rt[i] = r.time == null ? NaN : r.time;
    tic[i] = r.tic == null ? NaN : r.tic;
    i++;
  }

  return { id, msLevel, rt, tic };
}
