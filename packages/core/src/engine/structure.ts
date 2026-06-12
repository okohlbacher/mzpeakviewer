// Engine: Structure / Parquet inspection — the archive member list + per-parquet
// footer summary for the Structure tab. Metadata-only: reads the ZIP entry list
// (filenames + sizes) and, for parquet members, the footer FileMetaData (row/column
// counts and per-column footprint/stats). NO bulk column data is materialized
// (except the optional bounded engineSampleColumn preview).
//
// HARVESTED:
//   - Archive listing from mzPeakExplorer/src/reader/archive.ts (listArchive):
//     read `reader.store.entries` (zip.js entries), classify by extension, attach
//     the `data_kind` role from `store.fileIndex.files`.
//   - Footer decode via hyparquet (mzPeakExplorer/src/reader/parquetDeep.ts pattern):
//     `parquetMetadataAsync(asyncBuffer)` → num_rows / row_groups / created_by, then
//     aggregate each leaf column across row groups (type/codec/numValues/nullCount/
//     sizes/min/max). Logical type is read from the footer schema's leaf elements.
//   - The pure adapter adapt/footer.ts (adaptParquetFooter) maps the plain decoded
//     FooterInput → the wire ParquetFooter. ENUM ints are never produced here:
//     hyparquet already yields string physical-types + codec names, so they pass
//     straight through.
//
// IV's hand-rolled Thrift decoder (src/worker/parquetFooter.ts) was the fallback,
// but hyparquet — already a @mzpeak/core dependency and proven against these
// fixtures in Explorer — reads the FULL footer (logical types, statistics, min/max,
// created_by) that the IV decoder deliberately omits, so we use it instead.
//
// ── CACHE-IDENTITY (the spike) ──────────────────────────────────────────────────
// Explorer keyed its footer cache on a `WeakMap<Reader, ...>` that auto-invalidates
// when a new file is loaded (a new Reader object). In the worker there is exactly ONE
// long-lived Reader per open file (the engine context), and the worker REOPENS on
// each new file — so cross-boundary Reader identity is not a reliable cache key here.
// Instead we key a small in-module Map by `archivePath` (the ZIP member path). The
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
import type { Reader } from "../reader/explorer/open";

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
};
type ColumnMetaData = {
  type: string; // physical type as a string, e.g. "INT64", "DOUBLE", "BYTE_ARRAY"
  path_in_schema: string[];
  codec: string; // codec name, e.g. "ZSTD", "SNAPPY", "UNCOMPRESSED"
  num_values: bigint;
  total_uncompressed_size: bigint;
  total_compressed_size: bigint;
  statistics?: Statistics;
};
type SchemaElement = {
  name: string;
  type?: string;
  converted_type?: string;
  logical_type?: { type?: string } | string | null;
};
type FileMetaData = {
  num_rows: bigint;
  created_by?: string | null;
  schema?: SchemaElement[];
  row_groups: { columns: { meta_data?: ColumnMetaData }[] }[];
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
 * — no member is opened. Harvested from Explorer's `listArchive`.
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

// ── Footer decode (hyparquet) with the archivePath-keyed cache ───────────────────

// SPIKE cache: keyed by archivePath, NOT by Reader identity (see file header).
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
    compressedBytes: number;
    uncompressedBytes: number;
    min: unknown;
    max: unknown;
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
          compressedBytes: 0,
          uncompressedBytes: 0,
          min: undefined,
          max: undefined,
        };
        byCol.set(name, a);
      }
      a.numValues += num(md.num_values);
      a.compressedBytes += num(md.total_compressed_size);
      a.uncompressedBytes += num(md.total_uncompressed_size);
      const s = md.statistics;
      if (s) {
        if (s.null_count != null) a.nullCount = (a.nullCount ?? 0) + Number(s.null_count);
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
    };
  });

  const input: FooterInput = {
    numRows: Number(meta.num_rows),
    numRowGroups: meta.row_groups?.length ?? 0,
    createdBy: meta.created_by ?? null,
    columns,
  };
  return adaptParquetFooter(archivePath, input);
}

// ── Bounded column preview (optional) ────────────────────────────────────────────

/**
 * A small bounded preview of one leaf column's values via hyparquet. Reads only the
 * first `n` rows of the chosen column (range reads — never the whole file). Values are
 * stringified for display (the wire `ColumnSample.preview` is `string[]`). No histogram
 * is computed here (that's a separate Explorer operation; left null). Used by the
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

    const preview: string[] = [];
    for (const row of rows) {
      let v: unknown = row;
      for (const seg of segments) {
        v = (v as Record<string, unknown> | null | undefined)?.[seg];
      }
      preview.push(stringifyCell(v));
    }
    return { archivePath, column, preview, totalRows, histogram: null };
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
