import { describe, it, expect } from "vitest";
import { pickUseProfileForLevel } from "./chrom";

// A mixed file: profile MS1, centroid MS2. An MS-level-limited XIC must pick its source from
// the REQUESTED level's rows, not the whole-file majority (else a centroid-MS2 XIC reads the
// profile array and comes back empty/wrong).
const rows = [
  { index: 0, id: "s0", msLevel: 1, representation: "profile" as const, time: 0, tic: 1 },
  { index: 1, id: "s1", msLevel: 1, representation: "profile" as const, time: 1, tic: 1 },
  { index: 2, id: "s2", msLevel: 2, representation: "centroid" as const, time: 1, tic: 1 },
];
const ctx = { rows, representationCounts: { profile: 2, centroid: 1 } };

describe("pickUseProfileForLevel", () => {
  it("uses the requested level's representation, not the file majority", () => {
    expect(pickUseProfileForLevel(ctx, 1)).toBe(true); // MS1 is profile
    expect(pickUseProfileForLevel(ctx, 2)).toBe(false); // MS2 is centroid (majority is profile)
  });
  it("falls back to file majority when level unknown / no msLevel given", () => {
    expect(pickUseProfileForLevel(ctx, null)).toBe(true); // majority profile
    expect(pickUseProfileForLevel(ctx, 3)).toBe(true); // level absent → fall back to majority
    expect(pickUseProfileForLevel(undefined, 1)).toBe(true); // no ctx → default profile
  });
});
