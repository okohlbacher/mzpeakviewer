/**
 * Tests for scanCoords.ts — extractCoords (CoordSource chain) + readGridGeometry.
 *
 * Productionized, bulk-read generalization of stats.ts::probeIsImaging. Extends
 * the stats.test.ts Reader-shaped POJO mock pattern (Pitfall 4 / D-01): no real
 * Apache Arrow, no WASM. The `scans` Arrow Struct vector is mocked as a tiny
 * object exposing `.length` + `.getChild(name) → { get(i) }`.
 *
 * IMAGING-SPEC bindings:
 *   D-15: accept Int64 (bigint) AND UInt32 (number) coordinate column types.
 *   D-08 / Pitfall 3: only plain `number` crosses the reader boundary (no bigint).
 *   Pattern-1 note: scan rows join to spectra on `source_index`, NOT row index.
 *   D-16: promoted-columns → cv-params → id-parse strategy chain; winner recorded.
 *   Pitfall 1: geometry sources — discovery block → raw run JSON → null.
 *   T-02-01-RD: adversarial spectrum-id never throws (bounded parse).
 */
import { describe, it, expect } from "vitest";
import type { Reader } from "./openUrl";
import { extractCoords, readGridGeometry } from "./scanCoords";

// ── Mock builders ─────────────────────────────────────────────────────────────

type Cell = bigint | number | null;

/**
 * Build a mock `scans` Arrow-Struct-like vector exposing `.length` and
 * `.getChild(name)`. Columns provided as `{ name: Cell[] }`; absent names →
 * getChild returns null (mirrors Arrow's behaviour for a missing child).
 */
function makeScans(
  length: number,
  columns: Record<string, Cell[]>,
): { length: number; getChild(name: string): { get(i: number): Cell } | null } {
  return {
    length,
    getChild(name: string) {
      const col = columns[name];
      if (!col) return null;
      return { get: (i: number) => col[i] ?? null };
    },
  };
}

/** Per-record mock for the cv-params (Strategy 2) and id-parse (Strategy 3) paths. */
function makeRecord(opts: {
  id?: string;
  cvX?: number;
  cvY?: number;
}): unknown {
  return {
    id: opts.id ?? "",
    scans: [
      {
        meta: {},
        getParamByAccession: (acc: string) => {
          if (acc === "IMS:1000050" && opts.cvX !== undefined) {
            return { accession: acc, name: "position x", value: opts.cvX };
          }
          if (acc === "IMS:1000051" && opts.cvY !== undefined) {
            return { accession: acc, name: "position y", value: opts.cvY };
          }
          return undefined;
        },
      },
    ],
  };
}

/**
 * Assemble a Reader-shaped POJO. `scans` mounts on spectrumMetadata.scans (bulk
 * path). `records` provide the per-spectrum `get(i)` for the fallback paths.
 * `fileIndexMeta` is reader.store.fileIndex.metadata (discovery block).
 * `runJson` is the raw `run` keyValueMetadata JSON string for the run-params path.
 */
function makeReader(opts: {
  scans?: ReturnType<typeof makeScans> | null;
  records?: unknown[];
  fileIndexMeta?: unknown;
  runJson?: string | null;
}): Reader {
  const records = opts.records ?? [];
  const runMap = new Map<string, string>();
  if (opts.runJson != null) runMap.set("run", opts.runJson);

  return {
    store: {
      fileIndex: { metadata: opts.fileIndexMeta ?? {} },
    },
    spectrumMetadata: {
      length: records.length,
      get: (i: number) => records[i],
      scans: opts.scans ?? null,
      handle: {
        metadata: () => ({
          fileMetadata: () => ({
            keyValueMetadata: () => ({
              get: (k: string) => runMap.get(k) ?? null,
            }),
          }),
        }),
      },
    },
  } as unknown as Reader;
}

// ── extractCoords: Strategy 1 — promoted columns ──────────────────────────────

describe("extractCoords — promoted columns (Strategy 1)", () => {
  it("Test 1: Int64 (bigint) columns → coords as plain numbers, strategy=promoted-columns", () => {
    const scans = makeScans(2, {
      IMS_1000050_position_x: [1n, 2n],
      IMS_1000051_position_y: [3n, 4n],
      source_index: [0n, 1n],
    });
    const result = extractCoords(makeReader({ scans }));
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("promoted-columns");
    expect(result!.coords).toEqual([
      { x: 1, y: 3 },
      { x: 2, y: 4 },
    ]);
    // D-08 / Pitfall 3: no bigint leak across the reader boundary.
    expect(typeof result!.coords[0].x).toBe("number");
    expect(typeof result!.coords[0].y).toBe("number");
    expect(result!.spectrumIndices).toEqual([0, 1]);
    expect(typeof result!.spectrumIndices[0]).toBe("number");
  });

  it("Test 2: UInt32 (plain number) columns → same coords, no bigint", () => {
    const scans = makeScans(2, {
      IMS_1000050_position_x: [5, 6],
      IMS_1000051_position_y: [7, 8],
      source_index: [0, 1],
    });
    const result = extractCoords(makeReader({ scans }));
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("promoted-columns");
    expect(result!.coords).toEqual([
      { x: 5, y: 7 },
      { x: 6, y: 8 },
    ]);
    expect(typeof result!.coords[0].x).toBe("number");
  });

  it("Test 3: source_index join — out-of-order scan rows map to joined spectrum index, not row i", () => {
    // Scan rows are NOT in spectrum order: row 0 belongs to spectrum 5, row 1 to spectrum 2.
    const scans = makeScans(2, {
      IMS_1000050_position_x: [10n, 20n],
      IMS_1000051_position_y: [11n, 21n],
      source_index: [5n, 2n],
    });
    const result = extractCoords(makeReader({ scans }));
    expect(result).not.toBeNull();
    // The coordinate at row 0 must be keyed to spectrum 5, not 0.
    expect(result!.spectrumIndices).toEqual([5, 2]);
    expect(result!.coords).toEqual([
      { x: 10, y: 11 },
      { x: 20, y: 21 },
    ]);
  });

  it("skips null cells in the coordinate columns", () => {
    const scans = makeScans(3, {
      IMS_1000050_position_x: [1n, null, 3n],
      IMS_1000051_position_y: [1n, 2n, 3n],
      source_index: [0n, 1n, 2n],
    });
    const result = extractCoords(makeReader({ scans }));
    expect(result).not.toBeNull();
    expect(result!.coords).toEqual([
      { x: 1, y: 1 },
      { x: 3, y: 3 },
    ]);
    expect(result!.spectrumIndices).toEqual([0, 2]);
  });

  it("returns null from Strategy 1 when a coordinate column is absent (falls through)", () => {
    const scans = makeScans(1, {
      IMS_1000050_position_x: [1n],
      // no y column
      source_index: [0n],
    });
    // No records → Strategy 2/3 also yield nothing → overall null.
    const result = extractCoords(makeReader({ scans, records: [] }));
    expect(result).toBeNull();
  });
});

// ── extractCoords: Strategy 2 — cv-params ─────────────────────────────────────

describe("extractCoords — cv-params (Strategy 2)", () => {
  it("Test 4: no promoted columns, cv-params present → strategy=cv-params", () => {
    const reader = makeReader({
      scans: null,
      records: [
        makeRecord({ id: "s0", cvX: 1, cvY: 2 }),
        makeRecord({ id: "s1", cvX: 3, cvY: 4 }),
      ],
    });
    const result = extractCoords(reader);
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("cv-params");
    expect(result!.coords).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(result!.spectrumIndices).toEqual([0, 1]);
    expect(typeof result!.coords[0].x).toBe("number");
  });
});

// ── extractCoords: Strategy 3 — id-parse ──────────────────────────────────────

describe("extractCoords — id-parse (Strategy 3)", () => {
  it("Test 5: only id strings carry coords → strategy=id-parse; garbage id skipped, no throw", () => {
    const reader = makeReader({
      scans: null,
      records: [
        makeRecord({ id: "x=1 y=2" }),
        // adversarial / ReDoS-bait id — must be skipped, never hang or throw.
        makeRecord({ id: "x".repeat(5000) + "=" }),
        makeRecord({ id: "x=3 y=4" }),
      ],
    });
    let result: ReturnType<typeof extractCoords> = null;
    expect(() => {
      result = extractCoords(reader);
    }).not.toThrow();
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("id-parse");
    expect(result!.coords).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    // Unparseable id at row 1 is skipped → its spectrum index is absent.
    expect(result!.spectrumIndices).toEqual([0, 2]);
  });
});

// ── extractCoords: no coords anywhere ─────────────────────────────────────────

describe("extractCoords — no coordinates", () => {
  it("Test 6: no coords in any source → returns null", () => {
    const reader = makeReader({
      scans: null,
      records: [makeRecord({ id: "no coords here" })],
    });
    expect(extractCoords(reader)).toBeNull();
  });
});

// ── readGridGeometry ──────────────────────────────────────────────────────────

describe("readGridGeometry", () => {
  it("Test 7: geometry from discovery block → geometrySource=discovery-block", () => {
    const reader = makeReader({
      fileIndexMeta: {
        imaging: {
          pixel_count: { x: 260, y: 134 },
          pixel_size_um: { x: 10, y: 10 },
          coordinate_base: 1,
        },
      },
    });
    const geom = readGridGeometry(reader);
    expect(geom).not.toBeNull();
    expect(geom!.geometrySource).toBe("discovery-block");
    expect(geom!.pixelCount).toEqual({ x: 260, y: 134 });
    expect(geom!.pixelSizeUm).toEqual({ x: 10, y: 10 });
    expect(geom!.coordinateBase).toBe(1);
  });

  it("Test 8: geometry from raw run JSON params (discovery absent) → geometrySource=run-params", () => {
    const runJson = JSON.stringify({
      id: "run1",
      parameters: [
        { accession: "IMS:1000042", name: "max count of pixels x", value: 260 },
        { accession: "IMS:1000043", name: "max count of pixels y", value: 134 },
        { accession: "IMS:1000046", name: "pixel size x", value: 10 },
        { accession: "IMS:1000047", name: "pixel size y", value: 10 },
      ],
    });
    const reader = makeReader({ fileIndexMeta: {}, runJson });
    const geom = readGridGeometry(reader);
    expect(geom).not.toBeNull();
    expect(geom!.geometrySource).toBe("run-params");
    expect(geom!.pixelCount).toEqual({ x: 260, y: 134 });
    expect(geom!.pixelSizeUm).toEqual({ x: 10, y: 10 });
  });

  it("Test 9: neither geometry source → returns null", () => {
    const reader = makeReader({ fileIndexMeta: {}, runJson: null });
    expect(readGridGeometry(reader)).toBeNull();
  });

  it("discovery block wins over run-params when both present", () => {
    const runJson = JSON.stringify({
      parameters: [
        { accession: "IMS:1000042", value: 99 },
        { accession: "IMS:1000043", value: 99 },
      ],
    });
    const reader = makeReader({
      fileIndexMeta: { imaging: { pixel_count: { x: 260, y: 134 }, coordinate_base: 1 } },
      runJson,
    });
    const geom = readGridGeometry(reader);
    expect(geom!.geometrySource).toBe("discovery-block");
    expect(geom!.pixelCount).toEqual({ x: 260, y: 134 });
  });

  it("defaults coordinateBase to 1 when discovery block omits it", () => {
    const reader = makeReader({
      fileIndexMeta: { imaging: { pixel_count: { x: 4, y: 5 } } },
    });
    const geom = readGridGeometry(reader);
    expect(geom!.coordinateBase).toBe(1);
  });
});
