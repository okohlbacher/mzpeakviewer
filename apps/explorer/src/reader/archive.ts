// ZIP + parquet structure inspection for the Structure tab. Reads the raw ZIP
// entry list (filenames + sizes) and, for parquet members, the footer metadata
// (row/column counts and per-column byte footprint) — all metadata-only, no bulk
// data is materialized.
import { tableFromIPC } from "apache-arrow";
import type { Reader } from "./open";
import type {
  ArchiveKind,
  ArchiveListing,
  ArchiveEntry,
  ParquetColumn,
  ParquetInfo,
} from "./types";

const IMAGE_EXT = /\.(tiff?|png|jpe?g|gif|bmp|webp)$/i;

/** Classify a ZIP member by path: data tables vs attached images / sample
 *  metadata (SDRF/ISA) / the index / any other embedded "Other" member. */
export function classifyArchiveKind(path: string): ArchiveKind {
  const p = path.toLowerCase();
  if (p.endsWith(".parquet")) return "parquet";
  if (p.startsWith("images/") || IMAGE_EXT.test(p)) return "image";
  if (p.startsWith("sample_metadata/") || p.endsWith(".sdrf.tsv")) return "sample-metadata";
  if (p.endsWith("mzpeak_index.json")) return "index";
  return "other";
}

type RawZipEntry = {
  filename?: unknown;
  compressedSize?: unknown;
  uncompressedSize?: unknown;
  directory?: unknown;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v as number);
  return Number.isFinite(n) ? n : 0;
}

// parquet-wasm Compression enum order (note: not the Thrift order).
const CODECS = ["UNCOMPRESSED", "SNAPPY", "GZIP", "BROTLI", "LZ4", "ZSTD", "LZ4_RAW", "LZO"];
function codecName(c: unknown): string {
  const n = typeof c === "number" ? c : Number(c);
  return Number.isInteger(n) && n >= 0 && n < CODECS.length ? CODECS[n] : String(c);
}

/** List every member of the backing ZIP archive with its stored/expanded size. */
export function listArchive(reader: Reader): ArchiveListing {
  const store = (reader as unknown as { store?: { entries?: RawZipEntry[] } }).store;
  const raw = store?.entries ?? [];
  const entries: ArchiveEntry[] = raw
    .filter((e) => e && typeof e.filename === "string")
    .map((e) => {
      const path = String(e.filename);
      const isDirectory = e.directory === true || path.endsWith("/");
      return {
        path,
        compressedSize: num(e.compressedSize),
        uncompressedSize: num(e.uncompressedSize),
        isDirectory,
        isParquet: path.toLowerCase().endsWith(".parquet"),
        kind: classifyArchiveKind(path),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  let totalCompressed = 0;
  let totalUncompressed = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    totalCompressed += e.compressedSize;
    totalUncompressed += e.uncompressedSize;
  }
  return { entries, totalCompressed, totalUncompressed };
}

/** Read a single ZIP member's raw bytes + UTF-8 text, bounded by `maxBytes`.
 *  Used to pull the embedded SDRF/ISA blob (review §A-13). Returns null when the
 *  member is absent; throws when it exceeds the size cap. */
export async function readArchiveMember(
  reader: Reader,
  name: string,
  maxBytes = 8 * 1024 * 1024,
): Promise<{ bytes: Uint8Array; text: string } | null> {
  const store = (reader as unknown as {
    store?: { open?: (n: string) => Promise<{ size?: number; bytes(): Promise<Uint8Array> } | undefined> };
  }).store;
  if (!store?.open) return null;
  const blob = await store.open(name);
  if (!blob) return null;
  if (typeof blob.size === "number" && blob.size > maxBytes) {
    throw new Error(`Archive member "${name}" is ${blob.size} bytes (> ${maxBytes} cap).`);
  }
  const bytes = await blob.bytes();
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Archive member "${name}" is ${bytes.byteLength} bytes (> ${maxBytes} cap).`);
  }
  return { bytes, text: new TextDecoder("utf-8").decode(bytes) };
}

// Minimal structural view of parquet-wasm's footer metadata objects.
type ColumnChunk = {
  columnPath(): string[];
  compressedSize(): number;
  uncompressedSize(): number;
  numValues(): number;
  compression(): unknown;
};
type ParquetHandle = {
  metadata(): {
    fileMetadata(): { numRows(): number; createdBy(): string | undefined };
    numRowGroups(): number;
    rowGroup(i: number): { columns(): ColumnChunk[] };
  };
  schema(): { intoIPCStream(): Uint8Array };
};

// Structural view of an Arrow Field / DataType from the reader's decoded vectors.
// (parquet-wasm's schema-only IPC stream can't be read by the app's apache-arrow
// build — it rejects LargeList — so we read types from the live vectors instead.)
type ArrowType = { toString(): string; children?: ArrowField[] };
type ArrowField = { name: string; type: ArrowType };
type StructVector = { type?: ArrowType } | null | undefined;

function isList(t: ArrowType): boolean {
  return /^(?:Large)?(?:FixedSize)?List/.test(String(t));
}

/** Walk one field, emitting leaf paths that mirror parquet's columnPath(). */
function walkField(field: ArrowField, prefix: string, out: Map<string, string>): void {
  const path = prefix ? `${prefix}.${field.name}` : field.name;
  const t = field.type;
  const children = t?.children;
  if (children && children.length > 0) {
    if (isList(t)) {
      // Parquet inserts a "list" group above the element field ("item"/"element").
      walkField(children[0], `${path}.list`, out);
    } else {
      for (const c of children) walkField(c, path, out); // struct
    }
  } else {
    out.set(path, String(t));
  }
}

function walkStruct(vec: StructVector, prefix: string, out: Map<string, string>): void {
  for (const c of vec?.type?.children ?? []) walkField(c, prefix, out);
}

/**
 * Map each leaf column path (e.g. "spectrum.time", "scan.MS_1000512_filter_string")
 * to its Arrow logical type, read from the reader's already-decoded struct vectors.
 * Covers the metadata tables (the rich ones); other members get an empty map and
 * the column table renders without a type.
 */
function columnTypes(reader: Reader, filename: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const r = reader as unknown as {
      spectrumMetadata?: Record<string, StructVector>;
      chromatogramMetadata?: Record<string, StructVector>;
    };
    const f = filename.toLowerCase();
    const meta = f.includes("meta");
    if (meta && f.includes("spectr") && r.spectrumMetadata) {
      const sm = r.spectrumMetadata;
      walkStruct(sm.spectra, "spectrum", out);
      walkStruct(sm.scans, "scan", out);
      walkStruct(sm.precursors, "precursor", out);
      walkStruct(sm.selectedIons, "selected_ion", out);
    } else if (meta && f.includes("chrom") && r.chromatogramMetadata) {
      const cm = r.chromatogramMetadata;
      walkStruct(cm.chromatograms, "chromatogram", out);
      walkStruct(cm.precursors, "precursor", out);
      walkStruct(cm.selectedIons, "selected_ion", out);
    }
  } catch {
    /* leave empty — types are best-effort */
  }
  return out;
}

/**
 * Fallback for the data/peaks members (no decoded vector): read the Arrow schema
 * from the parquet footer. Works for point-layout files; chunked-layout files use
 * LargeList, which the app's apache-arrow build can't decode from IPC, so they
 * fall through to an empty map (those columns render without a type).
 */
function ipcColumnTypes(handle: ParquetHandle): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const schema = tableFromIPC(handle.schema().intoIPCStream()).schema;
    for (const field of schema.fields as unknown as ArrowField[]) {
      walkField(field, "", out);
    }
  } catch {
    /* unsupported schema type (e.g. LargeList) — leave empty */
  }
  return out;
}
type ParquetStore = Record<string, (() => Promise<ParquetHandle | undefined>) | undefined>;

/**
 * Map a ZIP member name to the ZipStorage accessor that yields its footer-only
 * ParquetFile handle. The mzPeak archive's parquet files are a fixed, small set
 * (spectra/chromatograms × metadata/data/peaks); their names follow the spec's
 * conventions, so a name match is reliable and avoids re-downloading the file.
 */
async function openParquet(
  reader: Reader,
  filename: string,
): Promise<ParquetHandle | null> {
  const store = (reader as unknown as { store?: ParquetStore }).store;
  if (!store) return null;
  const f = filename.toLowerCase();
  const meta = f.includes("meta");
  let accessor: keyof ParquetStore | null = null;
  if (f.includes("chrom")) {
    accessor = meta ? "chromatogramMetadata" : "chromatogramData";
  } else if (f.includes("wavelength")) {
    accessor = meta ? "wavelengthSpectrumMetadata" : "wavelengthSpectrumData";
  } else if (f.includes("spectr")) {
    accessor = meta ? "spectrumMetadata" : f.includes("peak") ? "spectrumPeaks" : "spectrumData";
  }
  const fn = accessor ? store[accessor] : undefined;
  if (typeof fn !== "function") return null;
  try {
    return (await fn.call(store)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Internal table structure of a parquet member: row/column/row-group counts and
 * the per-column byte footprint summed across all row groups. Returns null for a
 * non-parquet member or one whose footer can't be read.
 */
export async function readParquetInfo(
  reader: Reader,
  filename: string,
): Promise<ParquetInfo | null> {
  const handle = await openParquet(reader, filename);
  if (!handle) return null;
  let md: ReturnType<ParquetHandle["metadata"]>;
  try {
    md = handle.metadata();
  } catch {
    return null;
  }

  const fileMd = md.fileMetadata();
  const numRows = num(fileMd.numRows());
  const createdBy = fileMd.createdBy() ?? null;
  const numRowGroups = md.numRowGroups();
  // Prefer the reader's decoded vectors (metadata tables); fall back to the
  // parquet footer schema for data/peaks members.
  let types = columnTypes(reader, filename);
  if (types.size === 0) types = ipcColumnTypes(handle);

  // Sum each column's footprint across all row groups.
  const byColumn = new Map<string, ParquetColumn>();
  for (let g = 0; g < numRowGroups; g++) {
    for (const cc of md.rowGroup(g).columns()) {
      const name = cc.columnPath().join(".");
      const existing = byColumn.get(name);
      const compressedSize = num(cc.compressedSize());
      const uncompressedSize = num(cc.uncompressedSize());
      const numValues = num(cc.numValues());
      if (existing) {
        existing.compressedSize += compressedSize;
        existing.uncompressedSize += uncompressedSize;
        existing.numValues += numValues;
      } else {
        byColumn.set(name, {
          name,
          type: types.get(name) ?? "—",
          compressedSize,
          uncompressedSize,
          numValues,
          compression: codecName(cc.compression()),
        });
      }
    }
  }

  const columns = [...byColumn.values()].sort(
    (a, b) => b.compressedSize - a.compressedSize,
  );
  return {
    numRows,
    numColumns: columns.length,
    numRowGroups,
    totalCompressed: columns.reduce((s, c) => s + c.compressedSize, 0),
    totalUncompressed: columns.reduce((s, c) => s + c.uncompressedSize, 0),
    columns,
    createdBy,
  };
}
