// Canonical guard: STORED representations are known at open, from the metadata counts
// (number_of_data_points > 0 ⇒ profile facet, number_of_peaks > 0 ⇒ centroid facet),
// independent of the DECLARED representation and of any spectrum read. A dual-stored file
// (every spectrum in both facets) declares one representation yet stores both — the
// Summary and the Spectra navigator are built on this, so a regression here makes
// centroids vanish from the UI again. Pure logic over a faked Arrow struct (both
// layouts), plus the real fixtures through the engine for the facet-truth check.
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scanSpectra } from "./summary";
import { COL, COL_FLAT } from "./cv";
import type { Reader } from "./open";
import { openEngineFile } from "../../engine/open";
import { engineScanBreakdown } from "../../engine/scanBreakdown";

// 4 spectra — dual / profile-only / centroid-only / empty; all DECLARED profile.
const DATA = {
  msLevel: [1, 1, 2, 2],
  representation: ["MS:1000128", "MS:1000128", "MS:1000128", "MS:1000128"],
  time: [0.1, 0.2, 0.3, 0.4],
  id: ["a", "b", "c", "d"],
  tic: [1, 2, 3, 0],
  mzLow: [100, 100, 100, null],
  mzHigh: [900, 900, 900, null],
  nPoints: [40n, 25n, 0n, 0n], // uint64 columns arrive as bigint
  nPeaks: [5n, 0n, 7n, 0n],
} as const;

function fakeReader(names: typeof COL | typeof COL_FLAT, omit: (keyof typeof DATA)[] = []): Reader {
  const byName: Record<string, readonly unknown[]> = {};
  (Object.keys(DATA) as (keyof typeof DATA)[]).forEach((k) => {
    if (!omit.includes(k)) byName[names[k]] = DATA[k];
  });
  const spectra = {
    length: DATA.msLevel.length,
    getChild: (n: string) => (byName[n] ? { get: (i: number) => byName[n]![i] } : null),
  };
  return { spectrumMetadata: { length: DATA.msLevel.length, spectra } } as unknown as Reader;
}

describe("scanSpectra — stored representations from the count columns", () => {
  for (const [layout, names] of [["flat", COL_FLAT], ["nested", COL]] as const) {
    it(`${layout}: per-spectrum bitmask, totals and per-level counts`, async () => {
      const { rows, aggregates } = await scanSpectra(fakeReader(names));
      expect(rows.map((r) => r.stored)).toEqual([3, 1, 2, 0]);
      // records: dual counts twice, every other spectrum (empty included) once
      expect(aggregates.storedTotals).toEqual({ profile: 2, centroid: 2, both: 1, records: 5 });
      expect(aggregates.storedPerLevel).toEqual({
        1: { profile: 2, centroid: 1, both: 1 },
        2: { profile: 0, centroid: 1, both: 0 },
      });
      // the DECLARED counts are untouched — they answer a different question
      expect(aggregates.representationCounts.profile).toBe(4);
    });
  }

  it("half a pair falls back to declared-only (one column cannot prove absence)", async () => {
    const { rows, aggregates } = await scanSpectra(fakeReader(COL_FLAT, ["nPeaks"]));
    expect(rows.every((r) => r.stored === 0)).toBe(true);
    expect(aggregates.storedTotals).toBeNull();
  });
});

describe("engineScanBreakdown — stored representations on real fixtures", () => {
  const fx = (n: string) => fileURLToPath(new URL(`../../../test/fixtures/${n}`, import.meta.url));
  async function breakdown(name: string) {
    const b = await readFile(fx(name));
    const ef = await openEngineFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, name);
    return engineScanBreakdown(ef.reader);
  }

  it("dual.mzpeak (flat): every spectrum stored twice → 6 records", async () => {
    const { stats, browse } = await breakdown("dual.mzpeak");
    expect(Array.from(browse.facets!)).toEqual([3, 3, 3]);
    expect(stats.storedRepresentation).toEqual({ profile: 3, centroid: 3, both: 3, records: 6 });
    expect(stats.storedPerLevel).toEqual({ 1: { profile: 3, centroid: 3, both: 3 } });
  }, 60000);

  it("lc.mzpeak (legacy nested layout): no stored info claimed → one record per spectrum", async () => {
    // The current reader exposes the nested file's ROOT table (spectrum|scan|precursor|
    // selected_ion), so no promoted column resolves there — the deprecated layout (P3-33).
    // Graceful fallback, not a guess: declared representation only, navigation unchanged.
    const { stats, browse } = await breakdown("lc.mzpeak");
    expect(stats.storedRepresentation).toBeUndefined();
    expect(browse.facets!.length).toBe(stats.numSpectra);
    expect(browse.facets!.every((f) => f === 0)).toBe(true);
  }, 60000);
});
