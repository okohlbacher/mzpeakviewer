/**
 * Tests for rasterize.ts — rasterizeTic (IMAGE-04 render transform).
 *
 * Pure-transform tests: a synthetic TIC Float32Array + a minimal ImagingGrid
 * (presenceMask/width/height). NO canvas, NO DOM — rasterizeTic is a pure
 * Float32Array -> Uint8ClampedArray function (RESEARCH Pitfall 4).
 *
 * Plan binding: 03-01 Task 2 behavior block, Tests 1–6.
 */
import { describe, it, expect } from "vitest";
import { rasterizeTic, viridis, rasterizeImage, inferno } from "./rasterize";
import type { Colormap, RasterizeOpts } from "./rasterize";
import type { ImagingGrid } from "../imaging/types";

// ── Fixture helper ────────────────────────────────────────────────────────────

/** Minimal grid: only width/height/presenceMask are read by rasterizeTic. */
function makeGrid(width: number, height: number, absent: number[] = []): ImagingGrid {
  const totalCells = width * height;
  const presenceMask = new Uint8Array(totalCells).fill(1);
  for (const k of absent) presenceMask[k] = 0;
  return {
    width,
    height,
    coordinateBase: 1,
    pixelSizeUm: null,
    coordToSpectrumIndex: new Map(),
    presenceMask,
    filledCount: totalCells - absent.length,
    totalCells,
    coordSourceStrategy: "promoted-columns",
    diagnostics: {
      spectrumCount: 0,
      uniqueCoordCount: 0,
      duplicateCount: 0,
      missingCount: absent.length,
      oobCount: 0,
      extentSource: "declared",
      geometrySource: "run-params",
      discoveryDisagreement: null,
    },
  };
}

const SENTINEL: [number, number, number] = [26, 26, 26];

function rgbaAt(out: Uint8ClampedArray, k: number): [number, number, number, number] {
  return [out[k * 4], out[k * 4 + 1], out[k * 4 + 2], out[k * 4 + 3]];
}

// ── Test 1: shape ─────────────────────────────────────────────────────────────

describe("rasterizeTic — output shape (Test 1)", () => {
  it("returns a Uint8ClampedArray of length width*height*4", () => {
    const grid = makeGrid(3, 2);
    const tic = new Float32Array(6);
    const out = rasterizeTic(tic, grid);
    expect(out).toBeInstanceOf(Uint8ClampedArray);
    expect(out.length).toBe(6 * 4);
  });
});

// ── Test 2: absent cell -> sentinel, distinct from zero-intensity ─────────────

describe("rasterizeTic — absent sentinel (Test 2)", () => {
  it("maps presenceMask[k]===0 to the sentinel RGBA, distinct from colormap(0)", () => {
    const grid = makeGrid(2, 1, [0]); // cell 0 absent, cell 1 present
    const tic = new Float32Array([0, 0]); // both zero-intensity
    const out = rasterizeTic(tic, grid);

    expect(rgbaAt(out, 0)).toEqual([...SENTINEL, 255]);
    // present zero-intensity cell uses colormap(0) — must differ from sentinel
    expect(rgbaAt(out, 1)).not.toEqual([...SENTINEL, 255]);
  });
});

// ── Test 3: present zero-intensity -> colormap(0) ─────────────────────────────

describe("rasterizeTic — present zero-intensity (Test 3)", () => {
  it("maps a present zero cell to colormap(0), distinct from the sentinel", () => {
    const grid = makeGrid(1, 1); // present
    const tic = new Float32Array([0]);
    const out = rasterizeTic(tic, grid);

    const expected = viridis(0);
    expect(rgbaAt(out, 0)).toEqual([...expected, 255]);
    expect(rgbaAt(out, 0)).not.toEqual([...SENTINEL, 255]);
  });
});

// ── Test 4: percentile clip ignores absent cells ──────────────────────────────

describe("rasterizeTic — percentile clip ignores absent (Test 4)", () => {
  it("derives the clip ceiling only from present cells; brightest present cell -> LUT top", () => {
    // 3 present cells with values 10,20,30 and one ABSENT cell holding a huge value.
    const grid = makeGrid(2, 2, [3]); // cell 3 absent
    const tic = new Float32Array([10, 20, 30, 1_000_000]);
    const out = rasterizeTic(tic, grid);

    // brightest present value (30) should normalize to 1.0 -> viridis(1) (LUT top)
    const top = viridis(1);
    expect(rgbaAt(out, 2)).toEqual([...top, 255]);
    // absent cell unaffected by its huge value — renders sentinel
    expect(rgbaAt(out, 3)).toEqual([...SENTINEL, 255]);
  });
});

// ── Test 5: non-finite / negative present value clamps ────────────────────────

describe("rasterizeTic — clamp non-finite/negative (Test 5)", () => {
  it("clamps non-finite or negative present values to a valid RGBA (no NaN, no OOB)", () => {
    const grid = makeGrid(3, 1); // all present
    const tic = new Float32Array([NaN, -50, 100]);
    const out = rasterizeTic(tic, grid);

    for (let k = 0; k < 3; k++) {
      const [r, g, b, a] = rgbaAt(out, k);
      for (const c of [r, g, b, a]) {
        expect(Number.isNaN(c)).toBe(false);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
    // negative/NaN normalize to 0 -> colormap(0)
    const zero = viridis(0);
    expect(rgbaAt(out, 0)).toEqual([...zero, 255]); // NaN -> 0
    expect(rgbaAt(out, 1)).toEqual([...zero, 255]); // -50 -> 0
  });
});

// ── Test 6: orientation passthrough — no reorder ──────────────────────────────

describe("rasterizeTic — orientation passthrough (Test 6)", () => {
  it("output cell k derives from input tic[k] (no transpose/reorder)", () => {
    const grid = makeGrid(2, 1); // 2 present cells
    // uniform-value array so the present-only percentile equals that value:
    // a flat bright field maps every cell to LUT top, and cell k tracks tic[k].
    const tic = new Float32Array([100, 100]);
    const out = rasterizeTic(tic, grid);

    const top = viridis(1);
    // both cells bright (norm 1.0); assert offset k*4 corresponds to tic[k]
    expect(rgbaAt(out, 0)).toEqual([...top, 255]);
    expect(rgbaAt(out, 1)).toEqual([...top, 255]);

    // distinct-value gradient over enough cells that the percentile preserves the
    // span: a uniform field of 100 with cell 0 set to 0. percentile99 of the
    // present values (mostly 100) ≈ 100, so the bright cells map to LUT top and the
    // single dim cell at index 0 maps to LUT bottom — order preserved, no reorder.
    const grid2 = makeGrid(4, 1);
    const tic2 = new Float32Array([0, 100, 100, 100]);
    const out2 = rasterizeTic(tic2, grid2);
    const zero = viridis(0);
    expect(rgbaAt(out2, 0)).toEqual([...zero, 255]); // dim cell stays at index 0
    expect(rgbaAt(out2, 3)).toEqual([...top, 255]); // bright cell stays at index 3
  });
});

// ── viridis sanity ────────────────────────────────────────────────────────────

describe("viridis — LUT bounds", () => {
  it("returns in-range RGB triples at the extremes", () => {
    for (const n of [0, 0.5, 1]) {
      const [r, g, b] = viridis(n);
      for (const c of [r, g, b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
        expect(Number.isInteger(c)).toBe(true);
      }
    }
  });
});

// ── IMAGE-03 tests — rasterizeImage ──────────────────────────────────────────
// These tests extend the Phase 3 suite without touching existing describes.

// ── Block 1: log scaling ──────────────────────────────────────────────────────

describe("rasterizeImage — log scaling", () => {
  it("raw=0 with logScale:true → norm=0 (no NaN, no negative in output)", () => {
    // 1×1 dense grid, value 0. With log scale raw=0 → Math.log1p(0)===0 → norm 0.
    const grid = makeGrid(1, 1);
    const values = new Float32Array([0]);
    const out = rasterizeImage(values, grid, {
      colormap: "viridis",
      percentile: 0.99,
      logScale: true,
    });
    const [r, g, b, a] = rgbaAt(out, 0);
    for (const c of [r, g, b, a]) {
      expect(Number.isNaN(c)).toBe(false);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
    // norm=0 → viridis(0) (not sentinel since cell is present)
    const [er, eg, eb] = viridis(0);
    expect([r, g, b]).toEqual([er, eg, eb]);
    expect(a).toBe(255);
  });

  it("raw>0 with logScale:true → pixel is brighter than raw=0 pixel", () => {
    // 1×3 dense grid: cell 0=0 (dim), cell 1=50 (mid, becomes clipMax at p=0.99 of [0,50,100]),
    // cell 2=100 (above clipMax → clipped to max brightness).
    // With log scale: norm(0)=0, norm(100)=min(log1p(100)/log1p(50),1)=1.0 (bright).
    // p=0.99 on 3 present values [0,50,100]: idx=floor(0.99*2)=1 → clipMax=50.
    const grid = makeGrid(1, 3);
    const values = new Float32Array([0, 50, 100]);
    const out = rasterizeImage(values, grid, {
      colormap: "viridis",
      percentile: 0.99,
      logScale: true,
    });
    const [r0, g0, b0] = rgbaAt(out, 0);
    const [r2, g2, b2] = rgbaAt(out, 2);
    const lum0 = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0;
    const lum2 = 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2;
    expect(lum2).toBeGreaterThan(lum0);
  });

  it("no pixel in a dense grid has NaN in RGBA channels (logScale:true)", () => {
    const grid = makeGrid(3, 2);
    const values = new Float32Array([10, 20, 30, 5, 50, 100]);
    const out = rasterizeImage(values, grid, {
      colormap: "viridis",
      percentile: 0.99,
      logScale: true,
    });
    for (let k = 0; k < 6; k++) {
      const [r, g, b, a] = rgbaAt(out, k);
      for (const c of [r, g, b, a]) {
        expect(Number.isNaN(c)).toBe(false);
      }
    }
  });
});

// ── Block 2: percentile param ─────────────────────────────────────────────────

describe("rasterizeImage — percentile param", () => {
  it("p=0.90 clips at a lower ceiling than p=0.99, causing more pixels to reach max brightness", () => {
    // 1×4 dense grid with values [10, 50, 90, 100].
    // 90th percentile of [10,50,90,100] → idx = floor(0.90*3)=2 → value 90.
    // 99th percentile of [10,50,90,100] → idx = floor(0.99*3)=2 → value 90.
    // Use a wider spread to see the difference: [10, 50, 90, 1000].
    // 90th: idx=floor(0.90*3)=2 → clipMax=90; 99th: idx=floor(0.99*3)=2 → clipMax=90.
    // With 5 values [10,20,30,40,100]: 90th=idx=floor(0.90*4)=3→40; 99th=idx=floor(0.99*4)=3→40.
    // Use [1,2,3,4,5,6,7,8,9,100] (10 values): 90th=idx=floor(0.90*9)=8→9; 99th=idx=floor(0.99*9)=8→9.
    // Use [1,2,...,10, 100] (11 values): 90th=idx=floor(0.90*10)=9→10; 99th=idx=floor(0.99*10)=9→10.
    // Use 20 values [1..19,100]: 90th=idx=floor(0.90*19)=17→18; 99th=idx=floor(0.99*19)=18→19.
    // With clipMax=18 (p=0.90): value=100 → norm=min(100/18,1)=1.0 → max brightness.
    // With clipMax=19 (p=0.99): value=100 → norm=min(100/19,1)=1.0 → also max brightness (same here).
    // Use 100 values [1..99,1000]: 90th=idx=floor(0.90*99)=89→90; 99th=idx=floor(0.99*99)=98→99.
    // clipMax90=90; clipMax99=99. Value=91 → norm90=min(91/90,1)=1.0; norm99=min(91/99,1)=0.919.
    // So under p=0.90, cell with value=91 renders at max; under p=0.99, same cell renders below max.
    const n = 100;
    const totalGrid = makeGrid(n, 1);
    const values = new Float32Array(n);
    for (let i = 0; i < n - 1; i++) values[i] = i + 1; // 1..99
    values[n - 1] = 1000; // one outlier

    const out90 = rasterizeImage(values, totalGrid, {
      colormap: "viridis",
      percentile: 0.90,
      logScale: false,
    });
    const out99 = rasterizeImage(values, totalGrid, {
      colormap: "viridis",
      percentile: 0.99,
      logScale: false,
    });

    // Cell at index 90 (value=91) should be at LUT top under p=0.90, below top under p=0.99.
    const top = viridis(1);
    expect(rgbaAt(out90, 90)).toEqual([...top, 255]); // clipped to max under p=0.90
    // Under p=0.99 clipMax=99, so value=91 gives norm=91/99≈0.919 — not max brightness.
    expect(rgbaAt(out99, 90)).not.toEqual([...top, 255]);
  });

  it("percentileClip n=2 p=0.99 returns the higher value, not the minimum", () => {
    // 1×2 dense grid: values=[1,2]. With Math.ceil(0.99*2)-1 = ceil(1.98)-1 = 2-1 = 1,
    // present[1]=2 → clipMax=2. Cell value=2: norm=2/2=1.0 → viridis(1).
    // Cell value=1: norm=1/2=0.5 → viridis(0.5). The two cells must be distinguishable.
    const grid = makeGrid(2, 1);
    const values = new Float32Array([1, 2]);
    const out = rasterizeImage(values, grid, {
      colormap: "viridis",
      percentile: 0.99,
      logScale: false,
    });
    // The two cells must differ (higher-value cell is brighter)
    expect(rgbaAt(out, 1)).not.toEqual(rgbaAt(out, 0));
    // The max-value cell (index 1, value=2) renders at LUT top under p=0.99 with n=2
    expect(rgbaAt(out, 1)).toEqual([...viridis(1), 255]);
  });
});

// ── Block 3: inferno colormap ─────────────────────────────────────────────────

describe("rasterizeImage — inferno colormap", () => {
  it("monotonic luminance: inferno increases from 0 through 0.25, 0.5, 0.75, 0.875 to 1.0", () => {
    const lum = (norm: number) => {
      const [r, g, b] = inferno(norm);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(lum(0)).toBeLessThan(lum(0.25));
    expect(lum(0.25)).toBeLessThan(lum(0.5));
    expect(lum(0.5)).toBeLessThan(lum(0.75));
    expect(lum(0.75)).toBeLessThan(lum(0.875));
    expect(lum(0.875)).toBeLessThan(lum(1.0));
  });

  it("inferno LUT returns integer RGB in [0,255] at extremes and midpoint", () => {
    for (const n of [0, 0.5, 1]) {
      const [r, g, b] = inferno(n);
      for (const c of [r, g, b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
        expect(Number.isInteger(c)).toBe(true);
      }
    }
  });
});

// ── Block 4: gray colormap ────────────────────────────────────────────────────

describe("rasterizeImage — gray colormap", () => {
  it("R === G === B for every present pixel", () => {
    // 1×3 dense grid with varying values.
    const grid = makeGrid(1, 3);
    const values = new Float32Array([0, 50, 100]);
    const out = rasterizeImage(values, grid, {
      colormap: "gray",
      percentile: 0.99,
      logScale: false,
    });
    for (let k = 0; k < 3; k++) {
      const [r, g, b] = rgbaAt(out, k);
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
  });

  it("gray colormap: zero-value present cell renders as R=G=B=0 (darkest gray)", () => {
    const grid = makeGrid(1, 1);
    const values = new Float32Array([0]);
    const out = rasterizeImage(values, grid, {
      colormap: "gray",
      percentile: 0.99,
      logScale: false,
    });
    const [r, g, b, a] = rgbaAt(out, 0);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
    expect(a).toBe(255);
  });
});

// ── Block 5: sentinel preserved across colormaps ──────────────────────────────

describe("rasterizeImage — sentinel preserved across all colormaps", () => {
  for (const colormap of ["viridis", "inferno", "gray"] as Colormap[]) {
    it(`absent cell renders as SENTINEL [0x1a,0x1a,0x1a,255] for colormap="${colormap}"`, () => {
      // 1×2 grid: cell 0 absent, cell 1 present.
      const grid = makeGrid(1, 2, [0]);
      const values = new Float32Array([0, 50]);
      const opts: RasterizeOpts = { colormap, percentile: 0.99, logScale: false };
      const out = rasterizeImage(values, grid, opts);
      expect(rgbaAt(out, 0)).toEqual([0x1a, 0x1a, 0x1a, 255]);
    });
  }
});

// ── Block 6: rasterizeTic regression wrapper ──────────────────────────────────

describe("rasterizeTic — regression wrapper (IMAGE-03)", () => {
  it("rasterizeTic(values, grid) === rasterizeImage(values, grid, {colormap:'viridis', percentile:0.99, logScale:false})", () => {
    const grid = makeGrid(2, 2);
    const values = new Float32Array([10, 20, 30, 40]);
    const fromWrapper = rasterizeTic(values, grid);
    const fromGeneral = rasterizeImage(values, grid, {
      colormap: "viridis",
      percentile: 0.99,
      logScale: false,
    });
    // Byte-for-byte identical output.
    expect(Array.from(fromWrapper)).toEqual(Array.from(fromGeneral));
  });
});
