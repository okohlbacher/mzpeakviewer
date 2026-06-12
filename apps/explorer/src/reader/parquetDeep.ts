// Deep per-column inspection of a parquet member, powered by hyparquet (a pure-JS
// parquet reader). hyparquet decodes the footer + column data directly to JS
// values — no Arrow IPC — so it reads the full Thrift metadata (encodings, page
// stats, min/max/null/distinct statistics) and can sample a column's values for a
// histogram, including the LargeList-bearing files apache-arrow's IPC can't decode.
//
// hyparquet + hyparquet-compressors are dynamically imported so they (and the
// zstd/snappy/etc. codecs) load only when a deep-column panel is first opened.
import type { Reader } from "./open";
import type { DeepColumn } from "./types";

type Awaitable<T> = T | Promise<T>;
type AsyncBuffer = {
  byteLength: number;
  slice(start: number, end?: number): Awaitable<ArrayBuffer>;
};

type Statistics = {
  min?: unknown;
  max?: unknown;
  min_value?: unknown;
  max_value?: unknown;
  null_count?: bigint;
  distinct_count?: bigint;
};
type ColumnMetaData = {
  type: string;
  encodings?: unknown[];
  path_in_schema: string[];
  codec: string;
  num_values: bigint;
  total_uncompressed_size: bigint;
  total_compressed_size: bigint;
  dictionary_page_offset?: bigint;
  statistics?: Statistics;
  encoding_stats?: { page_type: string; encoding: string; count: number }[];
};
type FileMetaData = {
  num_rows: bigint;
  row_groups: { columns: { meta_data?: ColumnMetaData }[] }[];
};

// A RemoteBlob (zip.js-backed) exposes size + a slice() that returns another
// RemoteBlob; adapt it to hyparquet's AsyncBuffer (range reads only — never the
// whole file unless a column read needs it).
type RemoteBlob = {
  size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
};
type Store = { open(name: string): Promise<RemoteBlob | undefined> } | undefined;

async function asyncBufferFor(reader: Reader, filename: string): Promise<AsyncBuffer | null> {
  const store = (reader as unknown as { store?: Store }).store;
  const rb = store?.open ? await store.open(filename) : undefined;
  if (!rb) return null;
  return {
    byteLength: rb.size,
    slice: (start, end) => rb.slice(start, end ?? rb.size).arrayBuffer(),
  };
}

// Footer metadata cached per (reader, filename) so expanding several columns of
// one file reads the footer once. WeakMap-by-reader auto-invalidates on new load.
const metaCache = new WeakMap<object, Map<string, Promise<FileMetaData>>>();

async function metadataFor(reader: Reader, filename: string): Promise<FileMetaData | null> {
  let byFile = metaCache.get(reader as object);
  if (!byFile) {
    byFile = new Map();
    metaCache.set(reader as object, byFile);
  }
  let p = byFile.get(filename);
  if (!p) {
    p = (async () => {
      const file = await asyncBufferFor(reader, filename);
      if (!file) throw new Error("member not found");
      const { parquetMetadataAsync } = await import("hyparquet");
      return (await parquetMetadataAsync(file)) as unknown as FileMetaData;
    })();
    byFile.set(filename, p);
  }
  try {
    return await p;
  } catch {
    byFile.delete(filename); // allow a retry next time
    return null;
  }
}

/** Compare two decoded statistic values (number | bigint | string) for min/max. */
function lt(a: unknown, b: unknown): boolean {
  if (typeof a === "bigint" || typeof b === "bigint") return BigInt(a as number) < BigInt(b as number);
  if (typeof a === "number" && typeof b === "number") return a < b;
  return String(a) < String(b);
}
function show(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, "");
  if (v instanceof Uint8Array) return `0x${[...v.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}${v.length > 8 ? "…" : ""}`;
  return String(v);
}

/** Aggregate the footer metadata for one leaf column across all row groups. */
export async function deepColumn(
  reader: Reader,
  filename: string,
  columnPath: string,
): Promise<DeepColumn | null> {
  const meta = await metadataFor(reader, filename);
  if (!meta) return null;

  const encodings = new Set<string>();
  let physicalType = "";
  let codec = "";
  let dictionary = false;
  let dataPages = 0;
  let dictionaryPages = 0;
  let numValues = 0;
  let compressed = 0;
  let uncompressed = 0;
  let rowGroups = 0;
  let nullCount: number | null = null;
  let distinctCount: number | null = null;
  let minV: unknown;
  let maxV: unknown;
  let found = false;

  for (const group of meta.row_groups) {
    for (const col of group.columns) {
      const md = col.meta_data;
      if (!md || md.path_in_schema.join(".") !== columnPath) continue;
      found = true;
      rowGroups++;
      physicalType = String(md.type);
      codec = String(md.codec);
      for (const e of md.encodings ?? []) encodings.add(String(e));
      numValues += Number(md.num_values);
      compressed += Number(md.total_compressed_size);
      uncompressed += Number(md.total_uncompressed_size);
      if (md.dictionary_page_offset != null) dictionary = true;
      for (const es of md.encoding_stats ?? []) {
        if (/DICT/i.test(String(es.page_type))) dictionaryPages += es.count;
        else dataPages += es.count;
      }
      const s = md.statistics;
      if (s) {
        if (s.null_count != null) nullCount = (nullCount ?? 0) + Number(s.null_count);
        if (s.distinct_count != null) distinctCount = Number(s.distinct_count);
        const lo = s.min_value ?? s.min;
        const hi = s.max_value ?? s.max;
        if (lo != null && (minV === undefined || lt(lo, minV))) minV = lo;
        if (hi != null && (maxV === undefined || lt(maxV, hi))) maxV = hi;
      }
    }
  }
  if (!found) return null;

  return {
    path: columnPath,
    physicalType,
    codec,
    encodings: [...encodings],
    dictionary,
    dataPages,
    dictionaryPages,
    numValues,
    nullCount,
    distinctCount,
    min: show(minV),
    max: show(maxV),
    compressed,
    uncompressed,
    rowGroups,
    scalar: !columnPath.includes(".list."),
  };
}

/**
 * Sample up to `limit` numeric values of a scalar leaf column for a histogram.
 * Returns null for repeated (list) or non-numeric columns. Reads only the chosen
 * column's pages over the first `limit` rows — not the whole file.
 */
export async function sampleColumnNumbers(
  reader: Reader,
  filename: string,
  columnPath: string,
  limit = 20000,
): Promise<number[] | null> {
  if (columnPath.includes(".list.")) return null;
  const meta = await metadataFor(reader, filename);
  const file = await asyncBufferFor(reader, filename);
  if (!meta || !file) return null;

  const { parquetReadObjects } = await import("hyparquet");
  const { compressors } = await import("hyparquet-compressors");
  const segments = columnPath.split(".");
  const rowEnd = Math.min(limit, Number(meta.num_rows));
  // metadata omitted (optional): hyparquet re-reads the small footer itself,
  // which keeps our loose local types out of its strict FileMetaData signature.
  const rows = (await parquetReadObjects({
    file,
    columns: [segments[0]],
    rowStart: 0,
    rowEnd,
    compressors,
  })) as Record<string, unknown>[];

  const out: number[] = [];
  for (const row of rows) {
    let v: unknown = row;
    for (const seg of segments) v = (v as Record<string, unknown> | null | undefined)?.[seg];
    if (v == null) continue; // null value — skip (expected; columns can be sparse)
    if (typeof v === "number") {
      if (Number.isFinite(v)) out.push(v);
    } else if (typeof v === "bigint") {
      out.push(Number(v));
    } else {
      return null; // a genuine non-numeric value (string/bool) — no histogram
    }
  }
  return out;
}
