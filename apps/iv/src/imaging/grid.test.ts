/**
 * Tests for grid.ts — buildImagingGrid (IMG-02 geometry/presence + IMG-03 diagnostics).
 *
 * These are pure-transform tests: synthetic plain `{x,y}[]` coordinate arrays plus a
 * parallel `spectrumIndices` array. NO reader mock, NO binary fixture — the imaging
 * layer receives only plain numbers (D-08). Test 8 is the PXD001283 unlock test, gated
 * on file presence (D-01) and using a dynamic import of the reader so the suite still
 * collects while src/reader/scanCoords.ts (plan 02-01) is unmerged.
 *
 * Plan binding: 02-02 behavior block, Tests 1–8.
 */
import { describe, it, test, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildImagingGrid } from "./grid";
import type { GridGeometry } from "./types";

// ── Fixture helpers ───────────────────────────────────────────────────────────

type Coord = { x: number; y: number };

/** Build a dense w×h coord set (1-based) row-major, returning coords + parallel indices. */
function denseCoords(
  w: number,
  h: number,
  base = 1,
): { coords: Coord[]; spectrumIndices: number[] } {
  const coords: Coord[] = [];
  const spectrumIndices: number[] = [];
  let idx = 0;
  for (let y = base; y < base + h; y++) {
    for (let x = base; x < base + w; x++) {
      coords.push({ x, y });
      spectrumIndices.push(idx++);
    }
  }
  return { coords, spectrumIndices };
}

function geometry(over: Partial<GridGeometry> = {}): GridGeometry {
  return {
    pixelCount: null,
    pixelSizeUm: null,
    coordinateBase: 1,
    geometrySource: "run-params",
    ...over,
  };
}

// ── Test 1: dense 5×4, declared 5×4 ──────────────────────────────────────────

describe("buildImagingGrid — dense 5×4 (Test 1)", () => {
  it("maps every cell; extentSource=declared, no missing/duplicates", () => {
    const { coords, spectrumIndices } = denseCoords(5, 4);
    const grid = buildImagingGrid(
      coords,
      spectrumIndices,
      geometry({ pixelCount: { x: 5, y: 4 } }),
      "promoted-columns",
    );
    expect(grid).not.toBeNull();
    if (!grid) return;
    expect(grid.width).toBe(5);
    expect(grid.height).toBe(4);
    expect(grid.filledCount).toBe(20);
    expect(grid.totalCells).toBe(20);
    expect(grid.diagnostics.missingCount).toBe(0);
    expect(grid.diagnostics.oobCount).toBe(0);
    expect(grid.diagnostics.extentSource).toBe("declared");
    expect(grid.diagnostics.duplicateCount).toBe(0);
    expect(grid.diagnostics.discoveryDisagreement).toBeNull();
    expect(grid.coordinateBase).toBe(1);
    expect(grid.coordSourceStrategy).toBe("promoted-columns");
  });
});

// ── Test 2: sparse 5×4 (15 of 20) ────────────────────────────────────────────

describe("buildImagingGrid — sparse 5×4 (Test 2)", () => {
  it("filledCount=15, missingCount=5", () => {
    const { coords, spectrumIndices } = denseCoords(5, 4);
    // Drop the last 5 coords → 15 filled.
    const sparseCoords = coords.slice(0, 15);
    const sparseIdx = spectrumIndices.slice(0, 15);
    const grid = buildImagingGrid(
      sparseCoords,
      sparseIdx,
      geometry({ pixelCount: { x: 5, y: 4 } }),
      "promoted-columns",
    );
    expect(grid).not.toBeNull();
    if (!grid) return;
    expect(grid.filledCount).toBe(15);
    expect(grid.totalCells).toBe(20);
    expect(grid.diagnostics.missingCount).toBe(5);
  });
});

// ── Test 3: declared-extent-wins (coords span 3×2, declared 5×4) ──────────────

describe("buildImagingGrid — declared-extent-wins (Test 3)", () => {
  it("uses declared 5×4 even though coords only span 3×2", () => {
    const { coords, spectrumIndices } = denseCoords(3, 2);
    const grid = buildImagingGrid(
      coords,
      spectrumIndices,
      geometry({ pixelCount: { x: 5, y: 4 } }),
      "promoted-columns",
    );
    expect(grid).not.toBeNull();
    if (!grid) return;
    expect(grid.width).toBe(5);
    expect(grid.height).toBe(4);
    expect(grid.diagnostics.extentSource).toBe("declared");
    expect(grid.filledCount).toBe(6);
    expect(grid.totalCells).toBe(20);
  });
});

// ── Test 4: extent disagreement (declared 3×3, coords reach x=5) ──────────────

describe("buildImagingGrid — extent disagreement (Test 4)", () => {
  it("declared 3×3 wins; out-of-range coords skipped, disagreement flagged", () => {
    // coords reach x=5,y=2 but declared is 3×3.
    const coords: Coord[] = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 5, y: 2 }, // x=5 is out of declared range (width 3 → x0 ∈ {0,1,2})
    ];
    const spectrumIndices = [0, 1, 2, 3];
    const grid = buildImagingGrid(
      coords,
      spectrumIndices,
      geometry({ pixelCount: { x: 3, y: 3 } }),
      "promoted-columns",
    );
    expect(grid).not.toBeNull();
    if (!grid) return;
    expect(grid.width).toBe(3); // declared wins (C4)
    expect(grid.height).toBe(3);
    expect(grid.diagnostics.discoveryDisagreement).not.toBeNull();
    // The x=5 coord is out of range → not written → 3 filled, not 4.
    expect(grid.filledCount).toBe(3);
  });
});

// ── Test 5: coordinateBase=0 (proves no −1 hard-coding) ───────────────────────

describe("buildImagingGrid — coordinateBase=0 (Test 5)", () => {
  it("a 0-based fixture maps with x0 = x − 0", () => {
    // 0-based dense 2×2: coords (0,0)(1,0)(0,1)(1,1).
    const coords: Coord[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const spectrumIndices = [10, 11, 12, 13];
    const grid = buildImagingGrid(
      coords,
      spectrumIndices,
      geometry({ pixelCount: { x: 2, y: 2 }, coordinateBase: 0 }),
      "promoted-columns",
    );
    expect(grid).not.toBeNull();
    if (!grid) return;
    expect(grid.coordinateBase).toBe(0);
    expect(grid.filledCount).toBe(4);
    expect(grid.totalCells).toBe(4);
    expect(grid.diagnostics.missingCount).toBe(0);
    // Lookup: coord (0,0) → key 0*width + 0 = 0 → spectrum 10.
    expect(grid.coordToSpectrumIndex.get(0)).toBe(10);
    // coord (1,1) → x0=1,y0=1 → key 1*2 + 1 = 3 → spectrum 13.
    expect(grid.coordToSpectrumIndex.get(3)).toBe(13);
  });
});

// ── Test 6: duplicate coord ──────────────────────────────────────────────────

describe("buildImagingGrid — duplicate coord (Test 6)", () => {
  it("duplicateCount=1; first writer kept, filled counts unique", () => {
    const coords: Coord[] = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 1 }, // duplicate of the first
    ];
    const spectrumIndices = [100, 101, 102];
    const grid = buildImagingGrid(
      coords,
      spectrumIndices,
      geometry({ pixelCount: { x: 2, y: 1 } }),
      "promoted-columns",
    );
    expect(grid).not.toBeNull();
    if (!grid) return;
    expect(grid.diagnostics.duplicateCount).toBe(1);
    expect(grid.filledCount).toBe(2);
    // First writer kept (100), not overwritten by 102.
    // coord (1,1) base 1 → x0=0,y0=0 → key 0 → 100.
    expect(grid.coordToSpectrumIndex.get(0)).toBe(100);
  });
});

// ── Test 7: empty coords → null ──────────────────────────────────────────────

describe("buildImagingGrid — empty coords (Test 7)", () => {
  it("returns null (non-imaging is a valid null state, D-04)", () => {
    const grid = buildImagingGrid([], [], geometry(), "promoted-columns");
    expect(grid).toBeNull();
  });
});

// ── Test 7b: NaN / OOB coordinate guard ──────────────────────────────────────

describe("buildImagingGrid — NaN and OOB coordinate guard (Test 7b)", () => {
  it("skips NaN coords without corrupting the Map or presenceMask", () => {
    // Two valid pixels + one NaN coordinate pair
    const coords = [
      { x: 1, y: 1 },
      { x: NaN, y: 2 }, // non-finite — must be skipped, not written to Map
      { x: 2, y: 1 },
    ];
    const spectrumIndices = [0, 1, 2];
    const grid = buildImagingGrid(coords, spectrumIndices, geometry({ pixelCount: { x: 5, y: 4 } }), "promoted-columns");
    expect(grid).not.toBeNull();
    if (!grid) return;
    expect(grid.filledCount).toBe(2); // only the 2 valid pixels filled
    expect(grid.diagnostics.oobCount).toBe(1); // NaN counted as OOB
    // Confirm Map has no NaN key
    expect(grid.coordToSpectrumIndex.has(NaN)).toBe(false);
  });

  it("counts out-of-declared-extent coords in oobCount", () => {
    const coords = [
      { x: 1, y: 1 },
      { x: 99, y: 99 }, // outside declared 5×4 extent
    ];
    const spectrumIndices = [0, 1];
    const grid = buildImagingGrid(coords, spectrumIndices, geometry({ pixelCount: { x: 5, y: 4 } }), "promoted-columns");
    expect(grid).not.toBeNull();
    if (!grid) return;
    expect(grid.filledCount).toBe(1);
    expect(grid.diagnostics.oobCount).toBe(1);
  });
});

// ── Test 8: PXD001283 unlock (skipped until operator drops the file) ──────────

const PXD = fileURLToPath(
  new URL("../../test/data/PXD001283.mzpeak", import.meta.url),
);

test.skipIf(!existsSync(PXD))(
  "validates 260×134 grid against PXD001283 (Test 8)",
  async () => {
    // Dynamic imports so the suite still collects while scanCoords.ts (02-01) is
    // unmerged in this worktree. When the PXD file exists AND scanCoords is present,
    // this drives the real reader path end-to-end.
    const { openBlob } = await import("../reader/openUrl");
    // Path held in a variable so `tsc -b` does not statically resolve the module
    // while src/reader/scanCoords.ts (plan 02-01) is unmerged in this worktree.
    // The body only runs when the PXD file exists (test.skipIf guards collection).
    const scanCoordsPath = "../reader/scanCoords";
    const { extractCoords, readGridGeometry } = (await import(
      /* @vite-ignore */ scanCoordsPath
    )) as {
      extractCoords: (r: unknown) => { coords: { x: number; y: number }[]; spectrumIndices: number[]; strategy: string } | null;
      readGridGeometry: (r: unknown) => GridGeometry;
    };
    const { readFile } = await import("node:fs/promises");

    const bytes = await readFile(PXD);
    const reader = await openBlob(new Blob([bytes]));
    const result = extractCoords(reader);
    expect(result).not.toBeNull();
    if (!result) return;
    // Use the source_index-joined spectrumIndices from CoordResult — do NOT synthesize by array index.
    const { coords, spectrumIndices, strategy } = result;
    expect(strategy).toBe("promoted-columns");
    const geom = readGridGeometry(reader);
    const grid = buildImagingGrid(
      coords,
      spectrumIndices,
      geom,
      strategy as import("./types").CoordSourceStrategy,
    );
    expect(grid).not.toBeNull();
    if (!grid) return;
    expect(grid.width).toBe(260);
    expect(grid.height).toBe(134);
    expect(grid.diagnostics.uniqueCoordCount).toBe(34840);
    expect(grid.diagnostics.spectrumCount).toBe(34840);
    expect(grid.coordinateBase).toBe(1);
    expect(grid.pixelSizeUm).not.toBeNull();
    if (grid.pixelSizeUm) {
      expect(grid.pixelSizeUm.x).toBeCloseTo(10, 0);
      expect(grid.pixelSizeUm.y).toBeCloseTo(10, 0);
    }
  },
);
