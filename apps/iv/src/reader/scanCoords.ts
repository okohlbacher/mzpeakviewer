// Per-spectrum coordinate extraction + run-level grid geometry for the imaging
// grid (IMG-01 / IMG-02). The productionized, bulk-read generalization of
// stats.ts::probeIsImaging: instead of returning `true` on first hit, this
// returns ALL per-spectrum {x,y} coordinates plus the run-level geometry,
// behind a swappable CoordSource strategy chain (D-16).
//
// BOUNDARY: this file lives in src/reader/ — the ONLY place that may touch
// Apache Arrow, mzpeakts internals, or `bigint`. Every coordinate is converted
// with `Number()` INSIDE this file so only plain `number` crosses upward
// (D-08 / Pitfall 3). Imports only the opaque Reader type from this folder.
import type { Reader } from "./openUrl";

// ── CV accession constants (byte-identical to stats.ts) ───────────────────────

// IMS:1000050 = position x; IMS:1000051 = position y (imaging-mzpeak-spec v0.3).
// Promoted column names in the scan table (authoritative path).
const IMS_POS_X_COL = "IMS_1000050_position_x";
const IMS_POS_Y_COL = "IMS_1000051_position_y";
// Accession strings (for fallback CV-param probing).
const IMS_POS_X_ACC = "IMS:1000050";
const IMS_POS_Y_ACC = "IMS:1000051";

// IMS:1000042/43 = max pixel count x/y; IMS:1000046/47 = pixel size x/y (µm).
// Run-level grid geometry params (imaging-mzpeak-spec v0.3 §4.2).
const IMS_PIXELS_X_ACC = "IMS:1000042";
const IMS_PIXELS_Y_ACC = "IMS:1000043";
const IMS_PXSIZE_X_ACC = "IMS:1000046";
const IMS_PXSIZE_Y_ACC = "IMS:1000047";

// ── Public types (plain POJO — no Arrow/bigint) ───────────────────────────────

/** Result of the coordinate extraction chain. Coordinates are 1-based per the
 *  spec; normalization to 0-based happens ABOVE the reader in the grid builder. */
export type CoordResult = {
  /** One {x,y} per extracted spectrum, in extraction order. Always plain numbers. */
  coords: { x: number; y: number }[];
  /** The joined spectrum index for `coords[k]` (via source_index, not row order). */
  spectrumIndices: number[];
  /** Which strategy produced the result (surfaced in grid diagnostics). */
  strategy: "promoted-columns" | "cv-params" | "id-parse";
};

/** Run-level grid geometry. `null` sub-fields mean "not declared by the file". */
export type GridGeometry = {
  pixelCount: { x: number; y: number } | null;
  pixelSizeUm: { x: number; y: number } | null;
  /** 1-based by spec default; read from the discovery block when present (D-10). */
  coordinateBase: number;
  geometrySource: "discovery-block" | "run-params";
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert an Arrow coordinate cell to a plain finite number, or null.
 * Handles Int64 (`bigint`) AND UInt32 (`number`) columns uniformly (D-15):
 * `Number(bigint)` is exact for pixel-scale values (≪ 2^53, Pitfall 3) and a
 * no-op for plain numbers.
 */
function toCoordNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "bigint") {
    // MSI pixel coords are always small (≪ 2^53), but guard against pathological
    // files to avoid silent precision loss on unsafe integers.
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return null;
}

/** A minimal view over the Arrow `scans` Struct vector we depend on. */
type ScanStruct = {
  length: number;
  getChild(name: string): { get(i: number): unknown } | null;
};

/** Defensive read of `reader.spectrumMetadata.scans` as our minimal view. */
function getScans(reader: Reader): ScanStruct | null {
  const sm = reader.spectrumMetadata as unknown as
    | { scans?: unknown; length?: number }
    | null
    | undefined;
  const scans = sm?.scans as ScanStruct | null | undefined;
  if (!scans || typeof scans.getChild !== "function") return null;
  return scans;
}

// ── Strategy 1: promoted columns (PRIMARY) ────────────────────────────────────

/**
 * Bulk read the promoted `IMS_1000050_position_x` / `..._y` columns plus the
 * `source_index` child from the `scans` Arrow Struct vector. One column object
 * per axis, then a tight numeric loop (Pitfall 5 — no per-record get(i)).
 *
 * Scan rows join to spectra on `source_index`, NOT row order (Pattern 1 note):
 * each row's joined spectrum index is read from the `source_index` column and
 * defaults to the row index only when that column is absent.
 */
function fromPromotedColumns(reader: Reader): CoordResult | null {
  const scans = getScans(reader);
  if (!scans) return null;

  const xCol = scans.getChild(IMS_POS_X_COL);
  const yCol = scans.getChild(IMS_POS_Y_COL);
  if (!xCol || !yCol) return null;

  // source_index maps each scan row to its spectrum.index (the join key, Pattern 1).
  // When absent (non-conformant file), fall back to row order and warn — this is
  // plausible but WRONG for files where scan-row order diverges from spectrum order.
  const srcCol = scans.getChild("source_index");
  if (!srcCol) {
    console.warn(
      "scanCoords: source_index column absent — falling back to row-index join. " +
        "Spectrum mappings may be incorrect for non-conformant scan tables.",
    );
  }

  const coords: { x: number; y: number }[] = [];
  const spectrumIndices: number[] = [];

  for (let i = 0; i < scans.length; i++) {
    const x = toCoordNumber(xCol.get(i));
    const y = toCoordNumber(yCol.get(i));
    if (x === null || y === null) continue; // skip null cells

    const joined = srcCol ? toCoordNumber(srcCol.get(i)) : i;
    coords.push({ x, y });
    spectrumIndices.push(joined === null ? i : joined);
  }

  return coords.length ? { coords, spectrumIndices, strategy: "promoted-columns" } : null;
}

// ── Strategy 2: cv-params (FALLBACK) ──────────────────────────────────────────

type ScanRecord = {
  meta?: Record<string, unknown> | null;
  getParamByAccession?: (acc: string) => unknown;
};
type SpectrumRecord = { id?: unknown; scans?: ScanRecord[] | null };

/** Extract a numeric value from a cvParam object (`{ value }`) or raw value. */
function cvParamValue(param: unknown): number | null {
  if (param == null) return null;
  if (typeof param === "object") {
    const v = (param as Record<string, unknown>)["value"];
    return toCoordNumber(v);
  }
  return toCoordNumber(param);
}

/**
 * Per-record fallback: for each spectrum, read IMS:1000050/51 off its scans via
 * `getParamByAccession`. Used when promoted columns are absent (non-promoted
 * storage). Spectrum index = record index (the metadata table is index-ordered
 * for the per-record accessor).
 */
function fromCvParams(reader: Reader): CoordResult | null {
  const sm = reader.spectrumMetadata as unknown as
    | { length?: number; get?: (i: number) => unknown }
    | null
    | undefined;
  const n = sm?.length ?? 0;
  if (!sm || typeof sm.get !== "function" || n === 0) return null;

  const coords: { x: number; y: number }[] = [];
  const spectrumIndices: number[] = [];

  for (let i = 0; i < n; i++) {
    const rec = sm.get(i) as SpectrumRecord | undefined;
    const scans = rec?.scans;
    if (!scans || scans.length === 0) continue;

    let x: number | null = null;
    let y: number | null = null;
    for (const scan of scans) {
      if (typeof scan?.getParamByAccession !== "function") continue;
      if (x === null) x = cvParamValue(scan.getParamByAccession(IMS_POS_X_ACC));
      if (y === null) y = cvParamValue(scan.getParamByAccession(IMS_POS_Y_ACC));
      if (x !== null && y !== null) break;
    }
    if (x === null || y === null) continue;
    coords.push({ x, y });
    spectrumIndices.push(i);
  }

  return coords.length ? { coords, spectrumIndices, strategy: "cv-params" } : null;
}

// ── Strategy 3: id-parse (LAST RESORT) ────────────────────────────────────────

// Bounded, non-backtracking patterns (T-02-01-RD / V5 ReDoS guard). The `{1,9}`
// digit bound caps the match length so an adversarial id cannot cause runaway
// backtracking; an unparseable id simply yields no match and is skipped.
const ID_X_RE = /x=(\d{1,9})/i;
const ID_Y_RE = /y=(\d{1,9})/i;

/**
 * Last-resort fallback: parse `x=<n> y=<n>` out of the spectrum `id` string with
 * a bounded regex. Unparseable / adversarial ids are skipped, never throw.
 */
function fromIdParse(reader: Reader): CoordResult | null {
  const sm = reader.spectrumMetadata as unknown as
    | { length?: number; get?: (i: number) => unknown }
    | null
    | undefined;
  const n = sm?.length ?? 0;
  if (!sm || typeof sm.get !== "function" || n === 0) return null;

  const coords: { x: number; y: number }[] = [];
  const spectrumIndices: number[] = [];

  for (let i = 0; i < n; i++) {
    const rec = sm.get(i) as SpectrumRecord | undefined;
    const id = typeof rec?.id === "string" ? rec.id : "";
    if (!id) continue;
    const mx = ID_X_RE.exec(id);
    const my = ID_Y_RE.exec(id);
    if (!mx || !my) continue;
    const x = Number(mx[1]);
    const y = Number(my[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    coords.push({ x, y });
    spectrumIndices.push(i);
  }

  return coords.length ? { coords, spectrumIndices, strategy: "id-parse" } : null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract per-spectrum {x,y} coordinates via the CoordSource chain (D-16):
 * promoted-columns → cv-params → id-parse, tagging the winning strategy.
 * Returns `null` when no source yields coordinates (non-imaging file).
 */
export function extractCoords(reader: Reader): CoordResult | null {
  return fromPromotedColumns(reader) ?? fromCvParams(reader) ?? fromIdParse(reader);
}

// ── Geometry ──────────────────────────────────────────────────────────────────

/** Safely read an `{x, y}` numeric pair from an unknown object, or null. */
function readXYPair(obj: unknown): { x: number; y: number } | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const x = toCoordNumber(rec["x"]);
  const y = toCoordNumber(rec["y"]);
  if (x === null || y === null) return null;
  return { x, y };
}

/** Geometry from the `metadata.imaging` discovery block (always accessible). */
function fromDiscoveryBlock(reader: Reader): GridGeometry | null {
  const fileIndexMeta = (
    reader as unknown as { store?: { fileIndex?: { metadata?: unknown } } }
  ).store?.fileIndex?.metadata;
  if (!fileIndexMeta || typeof fileIndexMeta !== "object") return null;

  const imaging = (fileIndexMeta as Record<string, unknown>)["imaging"];
  if (!imaging || typeof imaging !== "object") return null;
  const block = imaging as Record<string, unknown>;

  const pixelCount = readXYPair(block["pixel_count"]);
  const pixelSizeUm = readXYPair(block["pixel_size_um"]);
  const baseRaw = toCoordNumber(block["coordinate_base"]);
  // Return a partial geometry even when only coordinate_base is present — the
  // base value is authoritative (C3) and must not be silently discarded.
  if (pixelCount === null && pixelSizeUm === null && baseRaw === null) return null;

  return {
    pixelCount,
    pixelSizeUm,
    coordinateBase: baseRaw === null ? 1 : baseRaw,
    geometrySource: "discovery-block",
  };
}

/**
 * Geometry from the raw `run` keyValueMetadata JSON `parameters` (Pitfall 1:
 * the vendored MSRun.fromJSON drops `parameters`, so we read the raw JSON
 * ourselves). Pulls IMS:1000042/43 (extent) + IMS:1000046/47 (pixel size) by
 * accession. coordinate_base is not carried here → defaults to 1.
 */
function fromRunParams(reader: Reader): GridGeometry | null {
  const handle = (
    reader as unknown as {
      spectrumMetadata?: {
        handle?: {
          metadata?: () => {
            fileMetadata?: () => {
              keyValueMetadata?: () => { get?: (k: string) => string | null };
            };
          };
        };
      };
    }
  ).spectrumMetadata?.handle;

  let runRaw: string | null | undefined;
  try {
    runRaw = handle?.metadata?.()?.fileMetadata?.()?.keyValueMetadata?.()?.get?.("run");
  } catch {
    return null;
  }
  if (!runRaw || typeof runRaw !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(runRaw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const params = (parsed as Record<string, unknown>)["parameters"];
  if (!Array.isArray(params)) return null;

  const byAcc = new Map<string, number>();
  for (const p of params) {
    if (!p || typeof p !== "object") continue;
    const acc = (p as Record<string, unknown>)["accession"];
    const val = toCoordNumber((p as Record<string, unknown>)["value"]);
    if (typeof acc === "string" && val !== null) byAcc.set(acc, val);
  }

  const px = byAcc.get(IMS_PIXELS_X_ACC);
  const py = byAcc.get(IMS_PIXELS_Y_ACC);
  const sx = byAcc.get(IMS_PXSIZE_X_ACC);
  const sy = byAcc.get(IMS_PXSIZE_Y_ACC);

  const pixelCount = px !== undefined && py !== undefined ? { x: px, y: py } : null;
  const pixelSizeUm = sx !== undefined && sy !== undefined ? { x: sx, y: sy } : null;
  if (pixelCount === null && pixelSizeUm === null) return null;

  return {
    pixelCount,
    pixelSizeUm,
    coordinateBase: 1,
    geometrySource: "run-params",
  };
}

/**
 * Read run-level grid geometry, source order (Pitfall 1 / C4):
 *   (a) metadata.imaging discovery block (the only run-level source the vendored
 *       reader reliably surfaces) — WINS when present;
 *   (b) raw `run` JSON `parameters` by accession;
 *   (c) null (caller falls back to derived max-coordinate above the boundary).
 */
export function readGridGeometry(reader: Reader): GridGeometry | null {
  return fromDiscoveryBlock(reader) ?? fromRunParams(reader);
}
