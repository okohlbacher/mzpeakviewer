// PURE adapter: a plain-decoded parquet footer → the contract ParquetFooter.
// Follows the package template (see ./capability.ts): a pure function from plain,
// already-extracted data (NO mzpeakts/parquet-wasm/hyparquet handle) to a wire type,
// with a unit test. The reader-I/O — range-reading the footer bytes and decoding the
// Thrift FileMetaData — lives in the handler. The two decoders this mirrors:
//
//   - mzPeakIV/src/worker/parquetFooter.ts (hand-rolled Thrift compact decoder):
//     per-column `ColInfo` carries parquetType (enum int), codec (enum int),
//     numValues, compressedSize, uncompressedSize, dataPageOffset, encodings[].
//     It exposes NO logical type, no null count, no min/max, no createdBy.
//   - mzPeakExplorer/src/reader/parquetDeep.ts (hyparquet `deepColumn`):
//     aggregates ACROSS row groups → physicalType (string), codec (string),
//     numValues, nullCount, compressed, uncompressed, and STRINGIFIED min/max via
//     `show()` (bigint→toString, number→trimmed, Uint8Array→hex). Explorer's footer
//     read (`readParquetInfo`, archive.ts) also surfaces logicalType (Arrow-walked)
//     and createdBy from the file metadata.
//
// This adapter accepts the SUPERSET of those raw per-column fields and normalizes them
// to the wire `ParquetColumn`. Codec/physical-type ENUM ints are intentionally NOT
// resolved here — the handler decodes IV's enum ints to names (it owns the parquet-wasm
// enum order, archive.ts CODECS) before calling this. min/max are stringified for
// display; everything else passes through, with `undefined` → `null`.

import type { ParquetColumn, ParquetFooter } from "@mzpeak/contracts";

/** One decoded column's raw footer fields (superset of IV ColInfo + Explorer deepColumn). */
export type FooterColumnInput = {
  /** Leaf column path (dot-joined, e.g. "scan.IMS_1000050_position_x"). */
  name: string;
  /** Physical parquet type as a string (e.g. "INT64", "DOUBLE", "BYTE_ARRAY"). */
  type: string;
  /** Logical/converted type (e.g. "STRING", "TIMESTAMP"); null/absent when none. */
  logicalType?: string | null;
  /** Total values across row groups. */
  numValues?: number | null;
  /** Null count, when the footer carries statistics. */
  nullCount?: number | null;
  /** Compression codec name (e.g. "SNAPPY", "ZSTD", "UNCOMPRESSED"). */
  codec?: string | null;
  /** Total compressed bytes across row groups. */
  compressedBytes?: number | null;
  /** Total uncompressed bytes across row groups. */
  uncompressedBytes?: number | null;
  /** Raw min/max statistic (number | bigint | string | Uint8Array | null). Stringified here. */
  min?: unknown;
  max?: unknown;
};

/** The plain decoded footer the handler hands to the adapter. */
export type FooterInput = {
  numRows: number;
  numRowGroups: number;
  /** Writer signature from the footer (e.g. "parquet-mr", "mzpeak-rs"); null when absent. */
  createdBy?: string | null;
  columns: FooterColumnInput[];
};

/**
 * Stringify a footer min/max statistic for display. Mirrors Explorer's `show()`
 * (parquetDeep.ts): null→null, bigint→decimal string, integer number→plain, fractional
 * number→6-sig-fig trimmed, byte arrays→short hex, everything else→String(). Keeps the
 * wire type a plain string and matches what the Structure tab already renders.
 */
export function showStat(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    return Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, "");
  }
  if (v instanceof Uint8Array) {
    const hex = [...v.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `0x${hex}${v.length > 8 ? "…" : ""}`;
  }
  return String(v);
}

/** Map one raw decoded column to the wire `ParquetColumn` (undefined → null). */
function adaptColumn(col: FooterColumnInput): ParquetColumn {
  return {
    name: col.name,
    type: col.type,
    logicalType: col.logicalType ?? null,
    numValues: col.numValues ?? null,
    nullCount: col.nullCount ?? null,
    codec: col.codec ?? null,
    compressedBytes: col.compressedBytes ?? null,
    uncompressedBytes: col.uncompressedBytes ?? null,
    min: showStat(col.min),
    max: showStat(col.max),
  };
}

/**
 * Assemble a wire `ParquetFooter` from a plain decoded footer. `archivePath` is the
 * member path inside the .mzpeak ZIP (the handler knows it; the decoder does not). Each
 * column's stats pass through; min/max are stringified for display.
 */
export function adaptParquetFooter(archivePath: string, input: FooterInput): ParquetFooter {
  return {
    archivePath,
    numRows: input.numRows,
    numRowGroups: input.numRowGroups,
    columns: input.columns.map(adaptColumn),
    createdBy: input.createdBy ?? null,
  };
}
