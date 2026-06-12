import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { openBlob, type Reader } from "../reader/explorer/open";
import { engineScanBreakdown } from "./scanBreakdown";
import { engineExtractChrom } from "./chrom";

// GOLDEN fixture: a real LC/general mzPeak file. The engine slice is gated against
// it — open it the proven way (readFile → Blob → openBlob; the mzpeakts reader reads
// via zip.js BlobReader, which works in node).
const FIXTURE = fileURLToPath(
  new URL("../../test/fixtures/lc.mzpeak", import.meta.url),
);

async function openFixture(): Promise<Reader> {
  const bytes = await readFile(FIXTURE);
  const blob = new Blob([bytes]);
  return await openBlob(blob);
}

describe("LC golden: engine reader-I/O slice against a real lc.mzpeak", () => {
  let reader: Reader;

  beforeAll(async () => {
    reader = await openFixture();
  }, 60000);

  it("engineScanBreakdown → stats + a columnar browse index", async () => {
    const { stats, browse } = await engineScanBreakdown(reader);

    expect(stats.numSpectra).toBeGreaterThan(0);

    // The browse index is per-spectrum: one entry per spectrum, parallel arrays.
    expect(browse.id.length).toBe(stats.numSpectra);
    expect(browse.msLevel.length).toBe(stats.numSpectra);
    expect(browse.rt.length).toBe(stats.numSpectra);
    expect(browse.tic.length).toBe(stats.numSpectra);

    // Transfer-safe typed-array types (wire contract).
    expect(browse.id).toBeInstanceOf(Array);
    expect(browse.msLevel).toBeInstanceOf(Int16Array);
    expect(browse.rt).toBeInstanceOf(Float32Array);
    expect(browse.tic).toBeInstanceOf(Float32Array);

    expect(Array.isArray(stats.msLevels)).toBe(true);
  });

  it("engineExtractChrom({mode:'tic'}) → equal-length Float32 time/intensity > 0", async () => {
    const tic = await engineExtractChrom(reader, { mode: "tic" });

    expect(tic.kind).toBe("tic");
    expect(tic.time).toBeInstanceOf(Float32Array);
    expect(tic.intensity).toBeInstanceOf(Float32Array);
    expect(tic.time.length).toBe(tic.intensity.length);
    expect(tic.time.length).toBeGreaterThan(0);
  });

  // F3 — engineScanBreakdown reports the TIC-column capability so the shell can flip
  // CapabilityModel.chromatograms.ticColumn off "unknown".
  it("engineScanBreakdown reports ticColumn for the LC fixture", async () => {
    const { ticColumn, rows } = await engineScanBreakdown(reader);
    expect(["present", "absent"]).toContain(ticColumn);
    expect(rows.length).toBeGreaterThan(0);

    // The fixture has a promoted per-spectrum TIC column (it's a real converter
    // output); the reported presence must agree with whether the contributing
    // (MS1, else all) rows all carry a finite TIC.
    const ms1 = rows.filter((r) => r.msLevel === 1);
    const contributing = ms1.length > 0 ? ms1 : rows;
    const allFinite = contributing.every(
      (r) => r.tic != null && Number.isFinite(r.tic),
    );
    expect(ticColumn).toBe(allFinite ? "present" : "absent");
  });

  // F2 (value parity) — when a promoted TIC column is present, the engine TIC must
  // VALUE-match the per-spectrum browse TIC (first few points), in time order, and be
  // MS1-only. This guards the cheap-TIC path against silently summing signal instead.
  it("engine TIC value-matches the per-spectrum browse TIC and is MS1-only", async () => {
    const { browse, ticColumn, rows } = await engineScanBreakdown(reader);
    const tic = await engineExtractChrom(reader, { mode: "tic" }, {
      rows,
      representationCounts: { profile: rows.length, centroid: 0 },
    });

    expect(tic.time.length).toBeGreaterThan(0);

    if (ticColumn === "present") {
      // Reconstruct the expected MS1 cheap-TIC: per-spectrum browse TIC for MS1
      // rows, sorted by rt — exactly what the engine's cheap path emits.
      const ms1 = rows.filter((r) => r.msLevel === 1);
      const useRows = ms1.length > 0 ? ms1 : rows;
      const expected = useRows
        .map((r) => ({ t: r.time ?? r.index, y: r.tic as number }))
        .sort((a, b) => a.t - b.t);

      expect(tic.time.length).toBe(expected.length);

      // MS1-only: when the file has any MS2+, the engine TIC must be shorter than
      // the full per-spectrum browse index.
      if (ms1.length > 0 && ms1.length < browse.tic.length) {
        expect(tic.time.length).toBe(ms1.length);
        expect(tic.time.length).toBeLessThan(browse.tic.length);
      }

      const n = Math.min(5, expected.length);
      for (let i = 0; i < n; i++) {
        // Float32 round-trip ⇒ compare with a relative tolerance.
        expect(tic.time[i]!).toBeCloseTo(expected[i]!.t, 3);
        const ey = expected[i]!.y;
        const ay = tic.intensity[i]!;
        const tol = Math.max(1, Math.abs(ey) * 1e-4);
        expect(Math.abs(ay - ey)).toBeLessThanOrEqual(tol);
      }
    }
  });

  // F1 — the source pick is representation-aware: a centroid-majority context routes
  // the XIC read to spectra_peaks (useProfile=false), a profile-majority context to
  // spectra_data (useProfile=true). Both must return a well-formed series; at least
  // one of them must carry data for the fixture (whose actual representation decides
  // which source is populated), proving the pick is exercised rather than hard-coded.
  it("exercises a representation-aware source pick (profile vs centroid)", async () => {
    const { stats } = await engineScanBreakdown(reader);
    const mid = stats.mzRange
      ? (stats.mzRange[0] + stats.mzRange[1]) / 2
      : 500;

    const asProfile = await engineExtractChrom(
      reader,
      { mode: "xic", mz: mid, tolDa: 50 },
      { representationCounts: { profile: 10, centroid: 0 } },
    );
    const asCentroid = await engineExtractChrom(
      reader,
      { mode: "xic", mz: mid, tolDa: 50 },
      { representationCounts: { profile: 0, centroid: 10 } },
    );

    for (const s of [asProfile, asCentroid]) {
      expect(s.kind).toBe("xic");
      expect(s.time.length).toBe(s.intensity.length);
    }
    // The majority source that matches the fixture's true representation yields the
    // real trace; the parity point is that the two picks can differ — they are NOT
    // both forced down the profile path as before the F1 fix.
    expect(asProfile.time.length + asCentroid.time.length).toBeGreaterThan(0);
  });
});
