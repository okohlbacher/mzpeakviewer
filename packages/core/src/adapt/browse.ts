// PURE adapter: Explorer's per-spectrum Browse rows → the contract BrowseIndex.
// Follows the capability.ts template: a pure function from plain, already-extracted
// data (NO Arrow vectors, no reader handle) to a wire type, with a unit test. The
// reader-I/O (Explorer's `scanByColumns` single column pass that produces these
// rows) lives in the worker handler — this only columnarizes into transferable
// parallel typed arrays.

import type { BrowseIndex } from "@mzpeak/contracts";

/**
 * One per-spectrum Browse row, mirroring the load-bearing fields of Explorer's
 * `SpectrumIndexRow` (summary.ts `scanByColumns`, lines 178-185: id/msLevel/time/tic
 * per spectrum). `time` is retention time in SECONDS straight off the metadata
 * `time` column (numOrNull → number | null); null where the column is absent.
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
 * `rows.length`, order preserved. `rt` carries NaN where `time` is absent (the wire
 * contract: "Float32Array; NaN where absent"); a missing `msLevel`/`tic` coerces to
 * 0 (typed-array slots cannot hold null). Index `i` of every array is spectrum `i`.
 */
export function buildBrowseIndex(rows: BrowseRow[]): BrowseIndex {
  const n = rows.length;
  const id: string[] = new Array(n);
  const msLevel = new Int16Array(n);
  const rt = new Float32Array(n);
  const tic = new Float32Array(n);

  let i = 0;
  for (const r of rows) {
    id[i] = r.id;
    msLevel[i] = r.msLevel ?? 0;
    rt[i] = r.time == null ? NaN : r.time;
    tic[i] = r.tic ?? 0;
    i++;
  }

  return { id, msLevel, rt, tic };
}
