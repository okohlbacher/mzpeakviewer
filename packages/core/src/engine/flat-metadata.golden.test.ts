// GOLDEN guards for the 2026-09-01 adversarial-review fixes, pinned against the FLAT
// dual fixture (the current converter layout). Each assertion was a live defect:
//  - mapped `time` columns never reached Spectrum.time (every flat record read 0 min),
//  - the LAST spectrum lost its scans/precursors rows (terminal-group off-by-one),
//  - m/z-window slicing returned empty for narrow windows (betweenSorted),
//  - manifest entityType/dataKind stringified as "[object Object]",
//  - an explicit zero-length profile row blocked the centroid fallback.
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openEngineFile, type EngineFile } from "./open";
import { reconstructSpectrum } from "./spectrum";
import { extractChromatogram } from "../reader/explorer/browse";
import { manifest } from "../reader/fileMeta";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/dual.mzpeak", import.meta.url));
let ef: EngineFile;

describe("flat-metadata golden (dual.mzpeak)", () => {
  beforeAll(async () => {
    const b = await readFile(FIXTURE);
    ef = await openEngineFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, "dual.mzpeak");
  }, 60000);

  it("mapped time column populates Spectrum.time in file units (minutes)", () => {
    const sm = ef.reader.spectrumMetadata as unknown as { get(i: number): { time?: number } };
    const times = [0, 1, 2].map((i) => sm.get(i)?.time ?? NaN);
    expect(times[0]).toBeCloseTo(0.1, 6);
    expect(times[1]).toBeCloseTo(0.2, 6);
    expect(times[2]).toBeCloseTo(0.3, 6);
  });

  it("the LAST spectrum keeps its scan rows (terminal-group fix)", () => {
    const sm = ef.reader.spectrumMetadata as unknown as { get(i: number): { scans?: unknown[] } };
    expect([0, 1, 2].map((i) => (sm.get(i)?.scans ?? []).length)).toEqual([1, 1, 1]);
  });

  it("a narrow centroid-facet m/z window finds the boundary peak", async () => {
    // spectrum 0 has a centroid at exactly 150 (height 100).
    const pts = await extractChromatogram(ef.reader, { mz: 150, tolDa: 0.1, timeRange: null, useProfile: false });
    const s0 = pts.find((p) => p.index === 0);
    expect(s0?.intensity).toBeCloseTo(100, 3);
    expect(s0?.time).toBeCloseTo(6, 3); // 0.1 min → 6 s on the wire
  });

  it("manifest entity/data-kind stringify as raw index tokens, not [object Object]", () => {
    const m = manifest(ef.reader);
    expect(m.length).toBeGreaterThan(0);
    for (const e of m) {
      expect(e.entityType).not.toContain("object");
      expect(e.dataKind).not.toContain("object");
    }
    expect(m[0]!.dataKind).toBe("data_arrays");
    expect(m[0]!.entityType).toBe("spectrum");
  });

  it("zero-length profile arrays fall through to the centroid facet", () => {
    const spectrum = {
      id: "z",
      dataArrays: { "m/z array": new Float64Array(0), "intensity array": new Float32Array(0) },
      centroids: [{ mz: 150, intensity: 5 }],
    } as never;
    const r = reconstructSpectrum(spectrum, 0, "profile");
    expect(r.mz.length).toBe(1);
    expect(r.sourceUsed).toBe("centroid");
    expect(r.representation).toBe("profile"); // declaration never rewritten
  });
});
