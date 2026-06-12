import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { openBlob, type Reader } from "./openUrl";
import { fileMeta, manifest, spectrumMeta, fileStats } from "./fileMeta";
import { getSpectrumArrays } from "./arrays";

// Canonical Phase-1 fixture: the small bundled imaging example (imzML
// Example_Continuous), a real imaging MSI file.
const FIXTURE = fileURLToPath(
  new URL("../../test/data/example.mzpeak", import.meta.url),
);

async function openFixture(): Promise<Reader> {
  const bytes = await readFile(FIXTURE);
  // Node Buffer -> Blob (mzpeakts reads via zip.js BlobReader).
  const blob = new Blob([bytes]);
  return await openBlob(blob);
}

describe("reader boundary against real example.mzpeak", () => {
  let reader: Reader;

  beforeAll(async () => {
    reader = await openFixture();
  });

  it("opens the file and reports numSpectra > 0", () => {
    const stats = fileStats(reader);
    expect(stats.numSpectra).toBeGreaterThan(0);
    expect(stats.numEntities).toBeGreaterThan(0);
  });

  it("returns plain file metadata with at least one non-empty group", () => {
    const fm = fileMeta(reader);
    const hasFileDescription =
      fm.fileDescription !== null &&
      typeof fm.fileDescription === "object" &&
      Object.keys(fm.fileDescription as object).length > 0;
    const hasInstrument = fm.instrumentConfigurations.length > 0;
    expect(hasFileDescription || hasInstrument).toBe(true);
    // No Arrow / bigint leaks: the whole thing must be JSON-serializable.
    expect(() => JSON.stringify(fm)).not.toThrow();
  });

  it("returns a non-empty manifest of plain entries", () => {
    const entries = manifest(reader);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.name).toBe("string");
      expect(typeof e.entityType).toBe("string");
      expect(typeof e.dataKind).toBe("string");
      expect(e.name.length).toBeGreaterThan(0);
    }
  });

  it("getSpectrumArrays(0) returns equal-length Float64 m/z + Float32 intensity", async () => {
    const arrays = await getSpectrumArrays(reader, 0);
    expect(arrays.mz).toBeInstanceOf(Float64Array);
    expect(arrays.intensity).toBeInstanceOf(Float32Array);
    expect(arrays.mz.length).toBeGreaterThan(0);
    expect(arrays.mz.length).toBe(arrays.intensity.length);
  });

  it("getSpectrumArrays(0) returns ascending m/z", async () => {
    const { mz } = await getSpectrumArrays(reader, 0);
    let ascending = true;
    for (let i = 1; i < mz.length; i++) {
      if (mz[i] < mz[i - 1]) {
        ascending = false;
        break;
      }
    }
    expect(ascending).toBe(true);
  });

  it("exposes spectrum representation at the boundary (R-01a)", () => {
    const meta = spectrumMeta(reader, 0);
    expect(meta.index).toBe(0);
    expect(typeof meta.id).toBe("string");
    // The demo fixture is a profile MS1 file; representation must be populated.
    expect(meta.representation).not.toBeNull();
    expect(["profile", "centroid"]).toContain(meta.representation);
  });
});
