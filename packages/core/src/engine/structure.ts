// Engine: Structure / Parquet inspection — the archive member list + per-parquet
// footer summary for the Structure tab. Metadata-only: reads the ZIP entry list
// (filenames + sizes) and, for parquet members, the footer FileMetaData (row/column
// counts and per-column footprint/stats). NO bulk column data is materialized
// (except the optional bounded engineSampleColumn preview).
//
// Two parts:
//   - Archive listing (listArchive): read `reader.store.entries` (zip.js entries),
//     classify by extension, attach the `data_kind` role from `store.fileIndex.files`.
//   - Footer decode via hyparquet: `parquetMetadataAsync(asyncBuffer)` → num_rows /
//     row_groups / created_by, then aggregate each leaf column across row groups
//     (type/codec/numValues/nullCount/sizes/min/max). Logical type is read from the
//     footer schema's leaf elements.
//   - The pure adapter adapt/footer.ts (adaptParquetFooter) maps the plain decoded
//     FooterInput → the wire ParquetFooter. ENUM ints are never produced here:
//     hyparquet already yields string physical-types + codec names, so they pass
//     straight through.
//
// hyparquet is already a @mzpeak/core dependency and reads the FULL footer (logical
// types, statistics, min/max, created_by), so it is used here rather than a
// hand-rolled Thrift decoder.
//
// ── CACHE-IDENTITY ──────────────────────────────────────────────────────────────
// A `WeakMap<Reader, ...>` footer cache auto-invalidates when a new file is loaded (a
// new Reader object). In the worker there is exactly ONE long-lived Reader per open
// file (the engine context), and the worker REOPENS on each new file — so
// cross-boundary Reader identity is not a reliable cache key here. Instead we key a
// small in-module Map by `archivePath` (the ZIP member path). The
// worker's open handler MUST call `clearStructureCache()` on every file open so a
// stale footer from a previous file cannot leak (archive paths repeat across files —
// e.g. every LC file has a "spectra_data.parquet"). Only PLAIN JSON / typed arrays
// cross the boundary; the cache holds reader-side decode promises, never wire types.

import type {
  ArchiveMemberList,
  ColumnSample,
  ParquetFooter,
} from "@mzpeak/contracts";
import { adaptParquetFooter, type FooterColumnInput, type FooterInput } from "../adapt/footer";
import type { Reader } from "../reader/openUrl";

// ── Reader/store structural views (the opaque Reader's internals we touch) ───────

type RawZipEntry = {
  filename?: unknown;
  compressedSize?: unknown;
  uncompressedSize?: unknown;
  directory?: unknown;
};

/** A zip.js-backed remote member: size + range-reading slice() → arrayBuffer(). */
type RemoteBlob = {
  size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
};

type Store = {
  entries?: RawZipEntry[];
  fileIndex?: { files?: { name?: unknown; data_kind?: unknown }[] };
  open?: (name: string) => Promise<RemoteBlob | undefined>;
};

function readerStore(reader: Reader): Store | undefined {
  return (reader as unknown as { store?: Store }).store;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v as number);
  return Number.isFinite(n) ? n : 0;
}

// ── hyparquet footer types (loose — hyparquet's own types are stricter) ──────────

type Statistics = {
  min?: unknown;
  max?: unknown;
  min_value?: unknown;
  max_value?: unknown;
  null_count?: bigint;
  distinct_count?: bigint;
};
type ColumnMetaData = {
  type: string; // physical type as a string, e.g. "INT64", "DOUBLE", "BYTE_ARRAY"
  path_in_schema: string[];
  codec: string; // codec name, e.g. "ZSTD", "SNAPPY", "UNCOMPRESSED"
  num_values: bigint;
  total_uncompressed_size: bigint;
  total_compressed_size: bigint;
  statistics?: Statistics;
  encodings?: unknown[];
  dictionary_page_offset?: bigint | number | null;
  encoding_stats?: { page_type?: unknown; count?: number }[];
};
type SchemaElement = {
  name: string;
  type?: string;
  converted_type?: string;
  logical_type?: { type?: string } | string | null;
};
/** A column chunk: its meta_data PLUS the page-index pointers (present iff the writer
 *  emitted an offset/column index — that's what lets a reader seek within a row group). */
type ColumnChunk = {
  meta_data?: ColumnMetaData;
  offset_index_offset?: bigint | number | null;
  offset_index_length?: bigint | number | null;
  column_index_offset?: bigint | number | null;
  column_index_length?: bigint | number | null;
};
type RowGroup = {
  columns: ColumnChunk[];
  /** Rows in this row group. */
  num_rows?: bigint | number;
  /** Total UNCOMPRESSED bytes in this row group (the per-random-read decode cost). */
  total_byte_size?: bigint | number;
};
type FileMetaData = {
  num_rows: bigint;
  created_by?: string | null;
  schema?: SchemaElement[];
  row_groups: RowGroup[];
};

// ── Archive member listing ───────────────────────────────────────────────────────

/** Map a ZIP member path → its logical role from mzpeak_index.json (data_kind). */
function roleMap(store: Store | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of store?.fileIndex?.files ?? []) {
    if (f && typeof f.name === "string" && typeof f.data_kind === "string") {
      out.set(f.name, f.data_kind);
    }
  }
  return out;
}

/**
 * List every member of the backing ZIP archive (path, stored/expanded sizes, parquet
 * flag, index role, directory flag). Pure read of the already-parsed zip.js entry list
 * — no member is opened.
 */
export async function engineArchiveList(reader: Reader): Promise<ArchiveMemberList> {
  const store = readerStore(reader);
  const roles = roleMap(store);
  const raw = store?.entries ?? [];
  const members = raw
    .filter((e) => e && typeof e.filename === "string")
    .map((e) => {
      const path = String(e.filename);
      const isDirectory = e.directory === true || path.endsWith("/");
      const kind = roles.get(path) ?? null;
      return {
        path,
        bytes: num(e.uncompressedSize),
        compressedBytes: num(e.compressedSize),
        isParquet: path.toLowerCase().endsWith(".parquet"),
        kind,
        isDirectory,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return { members };
}

/**
 * Read the raw bytes of a single archive member (e.g. `mzpeak_index.json`) via the
 * reader's range-reading `store.open()`. Capped at `maxBytes` — if the member is larger
 * the result is truncated and `truncated: true` is returned (a guard against a
 * pathologically large member exhausting worker memory; the manifest is normally tiny).
 */
export async function engineArchiveMemberBytes(
  reader: Reader,
  archivePath: string,
  maxBytes: number,
): Promise<{ archivePath: string; bytes: ArrayBuffer; truncated: boolean }> {
  const store = readerStore(reader);
  const rb = store?.open ? await store.open(archivePath) : undefined;
  if (!rb) throw new Error(`archive member not found: ${archivePath}`);
  const size = num(rb.size);
  const cap = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : size;
  const truncated = size > cap;
  const end = truncated ? cap : size;
  const bytes = await rb.slice(0, end).arrayBuffer();
  return { archivePath, bytes, truncated };
}

// ── Footer decode (hyparquet) with the archivePath-keyed cache ───────────────────

// Footer cache: keyed by archivePath, NOT by Reader identity (see file header).
// Holds the in-flight/decoded hyparquet FileMetaData promise so expanding several
// columns / re-reading one parquet member decodes its footer once.
const footerCache = new Map<string, Promise<FileMetaData>>();

/**
 * Drop all cached footers. The worker open handler MUST call this on every file open
 * — archive paths repeat across files (every LC file has a "spectra_data.parquet"),
 * so a path-keyed cache would otherwise serve a previous file's footer.
 */
export function clearStructureCache(): void {
  footerCache.clear();
}

/** Adapt a zip.js RemoteBlob to hyparquet's AsyncBuffer (range reads only). */
function asyncBufferFor(rb: RemoteBlob) {
  return {
    byteLength: rb.size,
    slice: (start: number, end?: number) =>
      rb.slice(start, end ?? rb.size).arrayBuffer(),
  };
}

async function footerFor(reader: Reader, archivePath: string): Promise<FileMetaData | null> {
  let p = footerCache.get(archivePath);
  if (!p) {
    p = (async () => {
      const store = readerStore(reader);
      const rb = store?.open ? await store.open(archivePath) : undefined;
      if (!rb) throw new Error(`archive member not found: ${archivePath}`);
      const { parquetMetadataAsync } = await import("hyparquet");
      return (await parquetMetadataAsync(asyncBufferFor(rb))) as unknown as FileMetaData;
    })();
    footerCache.set(archivePath, p);
  }
  try {
    return await p;
  } catch {
    footerCache.delete(archivePath); // allow a retry next call
    return null;
  }
}

/**
 * Map each leaf column path (dot-joined, e.g. "spectrum.MS_1000511_ms_level") to its
 * logical/converted type, read from the footer schema's leaf elements. hyparquet's
 * flat schema list is the parquet schema in name order; leaf elements (those with a
 * physical `type`) carry `converted_type` (e.g. "UTF8", "UINT_64") and/or
 * `logical_type` ({type:"STRING"|"INTEGER"|...}). Parent/group elements have no type.
 *
 * The schema is a flat DFS list WITHOUT explicit paths, so we reconstruct the leaf
 * path from a structural walk is unnecessary here: parquet leaf column paths come
 * from `path_in_schema` on the ColumnMetaData; we instead map by the leaf NAME (the
 * last path segment), which is unambiguous for these single-nesting mzPeak schemas.
 */
function logicalTypeByLeafName(meta: FileMetaData): Map<string, string> {
  const out = new Map<string, string>();
  for (const el of meta.schema ?? []) {
    if (!el || el.type === undefined) continue; // group/root element — no physical type
    const lt =
      typeof el.logical_type === "object" && el.logical_type
        ? el.logical_type.type
        : typeof el.logical_type === "string"
          ? el.logical_type
          : undefined;
    const resolved = lt ?? el.converted_type;
    if (resolved) out.set(el.name, String(resolved));
  }
  return out;
}

/** Compare two decoded statistic values (number | bigint | string) for min/max. */
function lt(a: unknown, b: unknown): boolean {
  if (typeof a === "bigint" || typeof b === "bigint") return BigInt(a as number) < BigInt(b as number);
  if (typeof a === "number" && typeof b === "number") return a < b;
  return String(a) < String(b);
}

/**
 * Read a parquet member's footer and assemble the wire `ParquetFooter`. Aggregates
 * each leaf column ACROSS row groups (sizes/values/null-count summed; min/max reduced).
 * Decoding goes through hyparquet; mapping to the wire type goes through the pure
 * `adaptParquetFooter` adapter (which stringifies min/max for display).
 *
 * Returns a footer with `numRows: 0` and `columns: []` if the member is absent or its
 * footer can't be decoded (fail-soft — the Structure tab renders an empty table rather
 * than crashing on an unreadable member).
 */
export async function engineParquetFooter(
  reader: Reader,
  archivePath: string,
): Promise<ParquetFooter> {
  const meta = await footerFor(reader, archivePath);
  if (!meta) {
    return adaptParquetFooter(archivePath, { numRows: 0, numRowGroups: 0, columns: [] });
  }

  const logicalTypes = logicalTypeByLeafName(meta);

  // Aggregate per leaf column across row groups, preserving first-seen order.
  type Agg = {
    name: string;
    type: string;
    codec: string;
    numValues: number;
    nullCount: number | null;
    distinctCount: number | null;
    compressedBytes: number;
    uncompressedBytes: number;
    min: unknown;
    max: unknown;
    encodings: Set<string>;
    dictionary: boolean;
    dataPages: number;
    dictionaryPages: number;
    rowGroups: number;
  };
  const byCol = new Map<string, Agg>();
  for (const group of meta.row_groups ?? []) {
    for (const col of group.columns ?? []) {
      const md = col.meta_data;
      if (!md) continue;
      const name = md.path_in_schema.join(".");
      let a = byCol.get(name);
      if (!a) {
        a = {
          name,
          type: String(md.type),
          codec: String(md.codec),
          numValues: 0,
          nullCount: null,
          distinctCount: null,
          compressedBytes: 0,
          uncompressedBytes: 0,
          min: undefined,
          max: undefined,
          encodings: new Set<string>(),
          dictionary: false,
          dataPages: 0,
          dictionaryPages: 0,
          rowGroups: 0,
        };
        byCol.set(name, a);
      }
      a.rowGroups += 1;
      a.numValues += num(md.num_values);
      a.compressedBytes += num(md.total_compressed_size);
      a.uncompressedBytes += num(md.total_uncompressed_size);
      for (const e of md.encodings ?? []) a.encodings.add(String(e));
      if (md.dictionary_page_offset != null) a.dictionary = true;
      for (const es of md.encoding_stats ?? []) {
        if (/DICT/i.test(String(es.page_type))) a.dictionaryPages += Number(es.count ?? 0);
        else a.dataPages += Number(es.count ?? 0);
      }
      const s = md.statistics;
      if (s) {
        if (s.null_count != null) a.nullCount = (a.nullCount ?? 0) + Number(s.null_count);
        if (s.distinct_count != null) a.distinctCount = Number(s.distinct_count);
        const lo = s.min_value ?? s.min;
        const hi = s.max_value ?? s.max;
        if (lo != null && (a.min === undefined || lt(lo, a.min))) a.min = lo;
        if (hi != null && (a.max === undefined || lt(a.max, hi))) a.max = hi;
      }
    }
  }

  const columns: FooterColumnInput[] = [...byCol.values()].map((a) => {
    const leaf = a.name.includes(".") ? a.name.slice(a.name.lastIndexOf(".") + 1) : a.name;
    return {
      name: a.name,
      type: a.type,
      logicalType: logicalTypes.get(leaf) ?? null,
      numValues: a.numValues,
      nullCount: a.nullCount,
      codec: a.codec,
      compressedBytes: a.compressedBytes,
      uncompressedBytes: a.uncompressedBytes,
      min: a.min,
      max: a.max,
      encodings: [...a.encodings],
      dictionary: a.dictionary,
      dataPages: a.dataPages,
      dictionaryPages: a.dictionaryPages,
      distinctCount: a.distinctCount,
      rowGroups: a.rowGroups,
    };
  });

  // Per-row-group footprint (uncompressed bytes + rows) — the signal that exposes a
  // monolithic single 942 MB row group vs uniform ~25 MB groups. `total_byte_size` is the
  // footer's uncompressed row-group size; fall back to summing the columns' uncompressed
  // sizes if a writer omits it. Page index presence: any column chunk carrying an
  // offset/column-index pointer means a reader can seek WITHIN a group to a spectrum's pages.
  let hasPageIndex = false;
  const rowGroupSizes = (meta.row_groups ?? []).map((g) => {
    let bytes = num(g.total_byte_size);
    if (bytes === 0) {
      for (const c of g.columns ?? []) bytes += num(c.meta_data?.total_uncompressed_size);
    }
    for (const c of g.columns ?? []) {
      if (c.offset_index_offset != null || c.column_index_offset != null) hasPageIndex = true;
    }
    return { rows: num(g.num_rows), bytes };
  });

  const input: FooterInput = {
    numRows: Number(meta.num_rows),
    numRowGroups: meta.row_groups?.length ?? 0,
    createdBy: meta.created_by ?? null,
    columns,
    rowGroupSizes,
    hasPageIndex,
  };
  return adaptParquetFooter(archivePath, input);
}

// ── Bounded column preview (optional) ────────────────────────────────────────────

/**
 * A small bounded preview of one leaf column's values via hyparquet. Reads only the
 * first `n` rows of the chosen column (range reads — never the whole file). Values are
 * stringified for display (the wire `ColumnSample.preview` is `string[]`). Used by the
 * Structure tab's per-column preview.
 *
 * Fails soft to an empty preview if the member/footer can't be read.
 */
export async function engineSampleColumn(
  reader: Reader,
  archivePath: string,
  column: string,
  n = 20,
): Promise<ColumnSample> {
  const empty: ColumnSample = {
    archivePath,
    column,
    preview: [],
    totalRows: 0,
    histogram: null,
    histRange: null,
    stats: null,
  };
  const meta = await footerFor(reader, archivePath);
  const store = readerStore(reader);
  const rb = store?.open ? await store.open(archivePath) : undefined;
  if (!meta || !rb) return empty;

  const totalRows = Number(meta.num_rows);
  const rowEnd = Math.max(0, Math.min(n, totalRows));
  if (rowEnd === 0) return { ...empty, totalRows };

  const segments = column.split(".");
  const topLevel = segments[0] ?? column;
  try {
    const { parquetReadObjects } = await import("hyparquet");
    const { compressors } = await import("hyparquet-compressors");
    const rows = (await parquetReadObjects({
      file: asyncBufferFor(rb),
      columns: [topLevel], // top-level column (hyparquet returns the nested struct)
      rowStart: 0,
      rowEnd,
      compressors,
    })) as Record<string, unknown>[];

    // Walk to the leaf cell, build a small preview + a numeric vector for stats.
    const PREVIEW_MAX = 50;
    const preview: string[] = [];
    const nums: number[] = [];
    let nonNumeric = 0;
    for (const row of rows) {
      let v: unknown = row;
      for (const seg of segments) v = (v as Record<string, unknown> | null | undefined)?.[seg];
      if (preview.length < PREVIEW_MAX) preview.push(stringifyCell(v));
      if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
      else if (typeof v === "bigint") nums.push(Number(v));
      else nonNumeric++;
    }

    // Compute numeric stats + a 24-bin histogram over the sampled values.
    let histogram: number[] | null = null;
    let histRange: [number, number] | null = null;
    let stats: ColumnSample["stats"] = null;
    if (nums.length > 0) {
      const sorted = nums.slice().sort((x, y) => x - y);
      const min = sorted[0]!;
      const max = sorted[sorted.length - 1]!;
      const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]!;
      const mean = nums.reduce((s, x) => s + x, 0) / nums.length;
      const variance = nums.reduce((s, x) => s + (x - mean) * (x - mean), 0) / nums.length;
      stats = {
        count: nums.length,
        nulls: nonNumeric,
        sampled: rows.length,
        min,
        max,
        mean,
        median: q(0.5),
        stddev: Math.sqrt(variance),
        p25: q(0.25),
        p75: q(0.75),
      };
      const BINS = 24;
      histogram = new Array<number>(BINS).fill(0);
      histRange = [min, max];
      const span = max - min;
      if (span > 0) {
        for (const x of nums) {
          let b = Math.floor(((x - min) / span) * BINS);
          if (b >= BINS) b = BINS - 1;
          if (b < 0) b = 0;
          histogram[b]!++;
        }
      } else {
        histogram[0] = nums.length; // all identical
      }
    }
    return { archivePath, column, preview, totalRows, histogram, histRange, stats };
  } catch {
    return { ...empty, totalRows };
  }
}

/** Stringify one decoded cell value for the preview (matches footer min/max style). */
function stringifyCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, "");
  }
  if (v instanceof Uint8Array) {
    return `0x${[...v.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}${v.length > 8 ? "…" : ""}`;
  }
  return String(v);
}
