// Canonical guard for the Spectra navigator's RECORD model: a spectrum stored as both
// profile and centroid is TWO records (profile first), so a dual-stored file pages through
// 2×N; the representation filter behaves like the MS-level filter; and files without
// stored info keep exactly today's one-record-per-spectrum navigation.
import { describe, it, expect } from "vitest";
import type { BrowseIndex, FileStats } from "@mzpeak/contracts";
import {
  buildRecordIndex, activeRecords, currentRecordKey, isDualRecord,
  recordKey, recordRep, recordSpectrum, spectrumCounts,
} from "./recordIndex";
import { rankOf, absoluteOf } from "./levelIndex";

function browse(levels: number[], facets?: number[]): BrowseIndex {
  const n = levels.length;
  return {
    id: levels.map((_, i) => `scan=${i + 1}`),
    msLevel: Int16Array.from(levels),
    rt: new Float32Array(n),
    tic: new Float32Array(n),
    ...(facets ? { facets: Uint8Array.from(facets) } : {}),
  };
}

describe("buildRecordIndex", () => {
  it("dual-stored: 2 records per spectrum, profile before centroid, spectrum order kept", () => {
    const b = browse([1, 2, 1], [3, 3, 3]);
    const ri = buildRecordIndex(b);
    expect(ri.all.map((k) => `${recordSpectrum(k)}${recordRep(k)[0]}`)).toEqual(["0p", "0c", "1p", "1c", "2p", "2c"]);
    expect(ri.hasBoth).toBe(true);
    expect(ri.hasDual).toBe(true);
    expect(ri.byLevel.get(1)!.length).toBe(4);
    expect(ri.byLevel.get(2)!.length).toBe(2);
  });

  it("no stored info (facets absent or all 0) = one record per spectrum, no filter", () => {
    for (const b of [browse([1, 1, 2]), browse([1, 1, 2], [0, 0, 0])]) {
      const ri = buildRecordIndex(b);
      expect(ri.all.map(recordSpectrum)).toEqual([0, 1, 2]);
      expect(ri.hasBoth).toBe(false);
      expect(activeRecords(ri, b, null, "centroid")).toEqual(ri.all); // a stale sig= never empties the list
    }
  });

  it("mixed single-representation spectra: both stored in the FILE, none dual", () => {
    const b = browse([1, 2, 2], [1, 2, 2]);
    const ri = buildRecordIndex(b);
    expect(ri.all.map((k) => `${recordSpectrum(k)}${recordRep(k)[0]}`)).toEqual(["0p", "1c", "2c"]);
    expect(ri.hasBoth).toBe(true);
    expect(ri.hasDual).toBe(false);
    expect(activeRecords(ri, b, null, "centroid").map(recordSpectrum)).toEqual([1, 2]);
  });
});

describe("activeRecords — MS level × representation", () => {
  const b = browse([1, 2, 1, 1], [3, 3, 1, 2]);
  const ri = buildRecordIndex(b);
  it("All = every stored record", () => {
    expect(activeRecords(ri, b, null, "all").length).toBe(6);
  });
  it("Profile / Centroid keep only records actually stored in that representation", () => {
    expect(activeRecords(ri, b, null, "profile").map(recordSpectrum)).toEqual([0, 1, 2]);
    expect(activeRecords(ri, b, null, "centroid").map(recordSpectrum)).toEqual([0, 1, 3]);
  });
  it("combines with the MS-level filter", () => {
    expect(activeRecords(ri, b, 1, "centroid").map(recordSpectrum)).toEqual([0, 3]);
    expect(activeRecords(ri, b, 2, "all").map((k) => recordRep(k))).toEqual(["profile", "centroid"]);
  });
  it("rank/position navigation works on record keys (1-based within the active set)", () => {
    const set = activeRecords(ri, b, null, "all");
    expect(absoluteOf(set, 2)).toBe(recordKey(0, "centroid"));
    expect(rankOf(set, recordKey(1, "profile"))).toBe(3);
  });
});

describe("currentRecordKey", () => {
  const b = browse([1, 1], [3, 2]);
  it("the explicitly requested representation wins", () => {
    expect(currentRecordKey(b, 0, "centroid", { index: 0, sourceUsed: "profile" })).toBe(recordKey(0, "centroid"));
  });
  it("else what the displayed spectrum truthfully came from", () => {
    expect(currentRecordKey(b, 0, undefined, { index: 0, sourceUsed: "centroid" })).toBe(recordKey(0, "centroid"));
  });
  it("a stale displayed spectrum (different index) is ignored; centroid-only resolves to centroid", () => {
    expect(currentRecordKey(b, 1, undefined, { index: 0, sourceUsed: "profile" })).toBe(recordKey(1, "centroid"));
    expect(currentRecordKey(b, 0, undefined, null)).toBe(recordKey(0, "profile"));
  });
  it("isDualRecord", () => {
    expect(isDualRecord(b, recordKey(0, "centroid"))).toBe(true);
    expect(isDualRecord(b, recordKey(1, "centroid"))).toBe(false);
  });
});

describe("spectrumCounts", () => {
  const base: FileStats = {
    numSpectra: 13200, numEntities: 10, mzRange: null, rtRange: null, msLevels: [1],
    representationCounts: { profile: 13200, centroid: 0 },
  };
  it("dual-stored file reports 2×N records", () => {
    const c = spectrumCounts({ ...base, storedRepresentation: { profile: 13200, centroid: 13200, both: 13200, records: 26400 } });
    expect(c).toEqual({ records: 26400, scans: 13200, hasBoth: true, profile: 13200, centroid: 13200, both: 13200 });
  });
  it("no stored info falls back to the scan count", () => {
    expect(spectrumCounts(base)).toMatchObject({ records: 13200, hasBoth: false, profile: null });
  });
});
