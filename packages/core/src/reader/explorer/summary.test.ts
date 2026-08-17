// Canonical guard: the summary scan (scanSpectra) must resolve the promoted per-spectrum
// columns under BOTH the nested (legacy) and flat (metadata-refactor) layouts. The MS-level
// selector in the Spectra view is driven by stats.msLevels, which comes from
// aggregates.msLevelCounts here — if the column-name resolution regresses to nested-only,
// flat corpus files read every msLevel as absent, stats.msLevels goes empty, and the MS1/MS2
// selector disappears (plus m/z range shows "—"). Pure logic over a faked Arrow struct vector;
// no WASM/fixture needed.
import { describe, it, expect } from "vitest";
import { scanSpectra } from "./summary";
import { COL, COL_FLAT } from "./cv";
import type { Reader } from "./open";

// Three spectra: MS1 / MS2 / MS1; centroid / profile / centroid.
// (toRepresentation: MS:1000128 = profile, MS:1000127 = centroid.)
const DATA = {
  msLevel: [1, 2, 1],
  representation: ["MS:1000127", "MS:1000128", "MS:1000127"],
  time: [0.1, 0.2, 0.3],
  id: ["s1", "s2", "s3"],
  tic: [100, 200, 300],
  mzLow: [150, 120, 140],
  mzHigh: [900, 850, 880],
} as const;

/** Reader whose promoted struct exposes the DATA columns under the given layout's names. */
function fakeReader(names: typeof COL | typeof COL_FLAT): Reader {
  const byName: Record<string, readonly unknown[]> = {};
  (Object.keys(DATA) as (keyof typeof DATA)[]).forEach((k) => {
    byName[names[k]] = DATA[k];
  });
  const spectra = {
    length: DATA.msLevel.length,
    getChild: (n: string) =>
      byName[n] ? { get: (i: number) => byName[n]![i] } : null,
  };
  return {
    spectrumMetadata: { length: DATA.msLevel.length, spectra },
  } as unknown as Reader;
}

describe("scanSpectra — promoted columns resolve on both layouts (MS-level selector guard)", () => {
  for (const [layout, names] of [
    ["flat", COL_FLAT],
    ["nested", COL],
  ] as const) {
    it(`${layout} column names → MS levels, m/z range, representation`, async () => {
      const { rows, aggregates } = await scanSpectra(fakeReader(names));
      // Drives stats.msLevels → the MS1/MS2 selector. Empty here == selector gone.
      expect(aggregates.msLevelCounts).toEqual({ 1: 2, 2: 1 });
      expect(rows.map((r) => r.msLevel)).toEqual([1, 2, 1]);
      // Same column-name mechanism — regressed together on flat files.
      expect(aggregates.mzRange).toEqual([120, 900]);
      expect(aggregates.representationCounts).toEqual({
        profile: 1,
        centroid: 2,
        unknown: 0,
      });
    });
  }
});
