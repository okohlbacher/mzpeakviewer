import { describe, it, expect } from "vitest";
import { adaptParquetFooter, showStat, type FooterInput } from "./footer";

describe("showStat", () => {
  it("returns null for null/undefined", () => {
    expect(showStat(null)).toBeNull();
    expect(showStat(undefined)).toBeNull();
  });
  it("passes strings through", () => {
    expect(showStat("hello")).toBe("hello");
  });
  it("stringifies bigint", () => {
    expect(showStat(9007199254740993n)).toBe("9007199254740993");
  });
  it("renders integers plainly and trims fractional sig-figs", () => {
    expect(showStat(42)).toBe("42");
    expect(showStat(123.456789)).toBe("123.457");
    expect(showStat(1.5)).toBe("1.5");
  });
  it("hex-encodes byte arrays with an ellipsis past 8 bytes", () => {
    expect(showStat(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe("0xdeadbeef");
    expect(showStat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe("0x0102030405060708…");
  });
});

const base: FooterInput = {
  numRows: 1000,
  numRowGroups: 4,
  createdBy: "mzpeak-rs version 0.3",
  columns: [
    {
      name: "scan.IMS_1000050_position_x",
      type: "INT64",
      logicalType: null,
      numValues: 1000,
      nullCount: 0,
      codec: "SNAPPY",
      compressedBytes: 2048,
      uncompressedBytes: 8000,
      min: 1n,
      max: 260n,
    },
    {
      name: "spectrum.id",
      type: "BYTE_ARRAY",
      logicalType: "STRING",
      numValues: 1000,
      // nullCount/codec absent → should normalize to null
      min: "controllerType=0 scan=1",
      max: "controllerType=0 scan=1000",
    },
    {
      name: "data.intensity",
      type: "DOUBLE",
      numValues: 50000,
      nullCount: 12,
      codec: "ZSTD",
      compressedBytes: 100000,
      uncompressedBytes: 400000,
      min: 0,
      max: 1234.5678,
    },
  ],
};

describe("adaptParquetFooter", () => {
  it("carries archivePath, row/group counts, and createdBy", () => {
    const f = adaptParquetFooter("spectra_metadata.parquet", base);
    expect(f.archivePath).toBe("spectra_metadata.parquet");
    expect(f.numRows).toBe(1000);
    expect(f.numRowGroups).toBe(4);
    expect(f.createdBy).toBe("mzpeak-rs version 0.3");
    expect(f.columns).toHaveLength(3);
  });

  it("defaults a missing createdBy to null", () => {
    const f = adaptParquetFooter("x.parquet", { ...base, createdBy: undefined });
    expect(f.createdBy).toBeNull();
  });

  it("maps a column's pass-through stats and stringifies bigint min/max", () => {
    const f = adaptParquetFooter("x.parquet", base);
    const c = f.columns[0];
    expect(c.name).toBe("scan.IMS_1000050_position_x");
    expect(c.type).toBe("INT64");
    expect(c.logicalType).toBeNull();
    expect(c.numValues).toBe(1000);
    expect(c.nullCount).toBe(0);
    expect(c.codec).toBe("SNAPPY");
    expect(c.compressedBytes).toBe(2048);
    expect(c.uncompressedBytes).toBe(8000);
    expect(c.min).toBe("1");
    expect(c.max).toBe("260");
  });

  it("normalizes absent optional fields to null", () => {
    const f = adaptParquetFooter("x.parquet", base);
    const c = f.columns[1]; // spectrum.id — nullCount/codec/bytes absent
    expect(c.logicalType).toBe("STRING");
    expect(c.nullCount).toBeNull();
    expect(c.codec).toBeNull();
    expect(c.compressedBytes).toBeNull();
    expect(c.uncompressedBytes).toBeNull();
    // string min/max pass through unchanged
    expect(c.min).toBe("controllerType=0 scan=1");
    expect(c.max).toBe("controllerType=0 scan=1000");
  });

  it("stringifies numeric min/max (integer plain, fractional trimmed)", () => {
    const f = adaptParquetFooter("x.parquet", base);
    const c = f.columns[2];
    expect(c.nullCount).toBe(12);
    expect(c.min).toBe("0");
    expect(c.max).toBe("1234.57");
  });

  it("handles an empty column list", () => {
    const f = adaptParquetFooter("empty.parquet", {
      numRows: 0,
      numRowGroups: 0,
      columns: [],
    });
    expect(f.columns).toEqual([]);
    expect(f.createdBy).toBeNull();
  });
});
