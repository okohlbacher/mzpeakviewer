// Canonical guards for the XIC/TIC facet-selection fixes (adversarial review 2026-08-26,
// P0 item 8):
//  1. An ALL-LEVEL XIC on a MIXED-representation file must read BOTH facets and take each
//     spectrum's points from its DECLARED representation's facet — a single majority-facet
//     read silently drops the minority representation's signal, and naively summing both
//     facets double-counts dual-stored spectra.
//  2. The TIC signal-fallback (no promoted TIC column) must choose its facet from the MS1
//     rows' representation, NOT the whole-file majority — an MS2-dominated centroid file
//     with profile MS1 spectra otherwise yields an empty TIC despite valid MS1 signal.
// The reader I/O is mocked; only the engine's routing/merge logic is under test.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChromPoint } from "../reader/explorer/types";

const extractCalls: { useProfile: boolean }[] = [];
let profilePoints: ChromPoint[] = [];
let centroidPoints: ChromPoint[] = [];

vi.mock("../reader/explorer/browse", () => ({
  chromatogramIds: () => [],
  getStoredChromatogram: async () => null,
  extractChromatogram: async (_reader: unknown, opts: { useProfile: boolean }) => {
    extractCalls.push({ useProfile: opts.useProfile });
    return opts.useProfile ? profilePoints : centroidPoints;
  },
}));

import { engineExtractChrom } from "./chrom";

const reader = {} as never;
const row = (index: number, msLevel: number, representation: "profile" | "centroid", time: number) => ({
  index,
  id: `s${index}`,
  msLevel,
  representation,
  time,
  tic: null, // no promoted TIC → the TIC path must fall back to a signal read
});

beforeEach(() => {
  extractCalls.length = 0;
  profilePoints = [];
  centroidPoints = [];
});

describe("all-level XIC on a mixed file — dual-facet merge", () => {
  // profile MS1 (0,1) + centroid MS2 (2): majority profile.
  const ctx = {
    rows: [row(0, 1, "profile", 0), row(1, 1, "profile", 1), row(2, 2, "centroid", 2)],
    representationCounts: { profile: 2, centroid: 1, unknown: 0 },
  };

  it("reads both facets and routes each spectrum to its declared facet (no double-count)", async () => {
    profilePoints = [
      { index: 0, time: 0, intensity: 10 },
      { index: 1, time: 1, intensity: 20 },
      { index: 2, time: 2, intensity: 999 }, // dual-stored ghost — declared centroid, must be dropped
    ];
    centroidPoints = [
      { index: 2, time: 2, intensity: 30 },
      { index: 0, time: 0, intensity: 888 }, // dual-stored ghost — declared profile, must be dropped
    ];
    const series = await engineExtractChrom(reader, { mode: "xic", mz: 300, tolDa: 0.5 }, ctx);
    expect(extractCalls.map((c) => c.useProfile).sort()).toEqual([false, true]); // both facets read
    expect(Array.from(series.intensity)).toEqual([10, 20, 30]); // one point per spectrum, right facet
  });

  it("does NOT dual-read when the file is not mixed", async () => {
    const pureCtx = {
      rows: [row(0, 1, "profile", 0)],
      representationCounts: { profile: 1, centroid: 0, unknown: 0 },
    };
    profilePoints = [{ index: 0, time: 0, intensity: 10 }];
    await engineExtractChrom(reader, { mode: "xic", mz: 300, tolDa: 0.5 }, pureCtx);
    expect(extractCalls).toEqual([{ useProfile: true }]);
  });

  it("an MS-level-limited XIC still uses the single level-appropriate facet", async () => {
    centroidPoints = [{ index: 2, time: 2, intensity: 30 }];
    await engineExtractChrom(reader, { mode: "xic", mz: 300, tolDa: 0.5, msLevel: 2 }, ctx);
    expect(extractCalls).toEqual([{ useProfile: false }]); // MS2 is centroid
  });
});

describe("TIC signal-fallback — facet chosen from the MS1 rows, not the file majority", () => {
  it("profile-MS1 spectra in a centroid-majority file read the PROFILE facet", async () => {
    // 1 profile MS1 + 3 centroid MS2 → whole-file majority is centroid, but the TIC is
    // MS1-filtered, so the read must target the profile facet.
    const ctx = {
      rows: [row(0, 1, "profile", 0), row(1, 2, "centroid", 1), row(2, 2, "centroid", 2), row(3, 2, "centroid", 3)],
      representationCounts: { profile: 1, centroid: 3, unknown: 0 },
    };
    profilePoints = [
      { index: 0, time: 0, intensity: 42 },
      { index: 1, time: 1, intensity: 7 }, // MS2 — filtered out post-read
    ];
    const series = await engineExtractChrom(reader, { mode: "tic" }, ctx);
    expect(extractCalls).toEqual([{ useProfile: true }]);
    expect(Array.from(series.intensity)).toEqual([42]); // MS1-only
  });
});
