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
});
