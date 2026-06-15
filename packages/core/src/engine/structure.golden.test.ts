import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { openBlob, type Reader } from "../reader/explorer/open";
import {
  engineArchiveList,
  engineParquetFooter,
  engineSampleColumn,
  clearStructureCache,
} from "./structure";
import { engineScanBreakdown } from "./scanBreakdown";

// GOLDEN fixture: a real LC/general mzPeak file. Open it the proven node way
// (readFile → Blob → openBlob; mzpeakts reads via zip.js BlobReader, works in node).
const FIXTURE = fileURLToPath(
  new URL("../../test/fixtures/lc.mzpeak", import.meta.url),
);

async function openFixture(): Promise<Reader> {
  const bytes = await readFile(FIXTURE);
  return await openBlob(new Blob([bytes]));
}

describe("Structure golden: engine archive/footer slice against a real lc.mzpeak", () => {
  let reader: Reader;

  beforeAll(async () => {
    reader = await openFixture();
  }, 60000);

  // Mirror the worker open handler: clear the path-keyed footer cache per file open.
  beforeEach(() => {
    clearStructureCache();
  });

  it("engineArchiveList → members with a parquet + role from the index", async () => {
    const { members } = await engineArchiveList(reader);
    expect(members.length).toBeGreaterThanOrEqual(1);

    // At least one parquet member.
    const parquets = members.filter((m) => m.isParquet);
    expect(parquets.length).toBeGreaterThan(0);

    // Every member carries a path + non-negative sizes; parquet flag matches extension.
    for (const m of members) {
      expect(typeof m.path).toBe("string");
      expect(m.path.length).toBeGreaterThan(0);
      expect(m.bytes).toBeGreaterThanOrEqual(0);
      expect(m.compressedBytes).toBeGreaterThanOrEqual(0);
      expect(m.isParquet).toBe(m.path.toLowerCase().endsWith(".parquet"));
    }

    // The index roles (data_kind) are surfaced as `kind` on the data members.
    const dataMember = members.find((m) => m.path.includes("spectra_data"));
    expect(dataMember).toBeDefined();
    expect(dataMember!.kind).toBeTruthy(); // e.g. "data arrays"
  });

  it("engineParquetFooter(spectra_metadata) → numRows≥0, typed columns", async () => {
    const footer = await engineParquetFooter(reader, "spectra_metadata.parquet");

    expect(footer.archivePath).toBe("spectra_metadata.parquet");
    expect(footer.numRows).toBeGreaterThanOrEqual(0);
    expect(footer.numRowGroups).toBeGreaterThanOrEqual(1);
    expect(footer.columns.length).toBeGreaterThan(0);

    // Every column has a name + physical type; codec/sizes present from the footer.
    for (const c of footer.columns) {
      expect(typeof c.name).toBe("string");
      expect(c.name.length).toBeGreaterThan(0);
      expect(typeof c.type).toBe("string");
      expect(c.type.length).toBeGreaterThan(0);
    }

    // createdBy is surfaced from the footer (parquet-rs writer signature).
    expect(footer.createdBy).toBeTruthy();

    // At least one column should carry a logical type (e.g. the id STRING column).
    expect(footer.columns.some((c) => c.logicalType != null)).toBe(true);
  });

  // Chunk/row-group structure (Structure tab "chunk scanning"): one entry per row group,
  // each with a row count + uncompressed byte size; page-index presence is a boolean.
  it("engineParquetFooter surfaces per-row-group sizes + page-index presence", async () => {
    const footer = await engineParquetFooter(reader, "spectra_metadata.parquet");
    expect(footer.rowGroupSizes).toBeDefined();
    expect(footer.rowGroupSizes!.length).toBe(footer.numRowGroups);
    for (const g of footer.rowGroupSizes!) {
      expect(g.rows).toBeGreaterThanOrEqual(0);
      expect(g.bytes).toBeGreaterThan(0); // a non-empty row group has a real footprint
    }
    // Row counts across groups sum to the file's total rows.
    expect(footer.rowGroupSizes!.reduce((s, g) => s + g.rows, 0)).toBe(footer.numRows);
    expect(typeof footer.hasPageIndex === "boolean" || footer.hasPageIndex === null).toBe(true);
  });

  // VALUE-SANITY: the spectra_metadata footer numRows must equal the spectrum count
  // determined independently via the scan breakdown.
  it("spectra_metadata numRows == numSpectra (value parity)", async () => {
    const { stats } = await engineScanBreakdown(reader);
    clearStructureCache();
    const footer = await engineParquetFooter(reader, "spectra_metadata.parquet");
    expect(footer.numRows).toBe(stats.numSpectra);
  });

  it("engineSampleColumn → bounded preview of a leaf column", async () => {
    const sample = await engineSampleColumn(
      reader,
      "spectra_metadata.parquet",
      "spectrum.index",
      8,
    );
    expect(sample.archivePath).toBe("spectra_metadata.parquet");
    expect(sample.column).toBe("spectrum.index");
    expect(sample.totalRows).toBeGreaterThan(0);
    expect(sample.preview.length).toBeGreaterThan(0);
    expect(sample.preview.length).toBeLessThanOrEqual(8);
    // spectrum.index is a 0-based counter → the first previewed value is "0".
    expect(sample.preview[0]).toBe("0");
  });

  // Absent member → fail-soft empty footer (Structure tab renders an empty table).
  it("engineParquetFooter(missing) → empty footer, no throw", async () => {
    const footer = await engineParquetFooter(reader, "does_not_exist.parquet");
    expect(footer.numRows).toBe(0);
    expect(footer.columns).toEqual([]);
  });
});
