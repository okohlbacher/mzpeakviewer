// render.ts — pure, DOM-free raster transforms for the imaging views.
//
// A faithful port of mzPeakIV's `src/ui/rasterize.ts`, adapted to the merged app's
// `ImagingGridWire` (only width/height/presenceMask are needed here). No `react`,
// no canvas/DOM — so it stays unit-testable in isolation.
//
// Correctness invariants carried verbatim from IV (C2 / C8 / D-09):
//   - Absent pixels (presenceMask[k] === 0) render to a fixed near-black SENTINEL,
//     NEVER colormap-bottom — "no data" must read as visually distinct from zero.
//   - The percentile clip ceiling is computed from PRESENT cells only, so a stray
//     value in an absent cell can never blow out the normalization.
//   - No cell reorder: out[k*4..] derives from values[k]. The wire's coordKey is
//     `y*width + x`, so NO transpose / flip here — orientation is owned upstream.

/** Minimal grid shape the rasterizers need (structurally satisfied by ImagingGridWire). */
export type RenderGrid = { width: number; height: number; presenceMask: Uint8Array };

/**
 * Sparse / absent-pixel sentinel (#1a1a1a, RGBA 26,26,26,255). Near-black, visually
 * distinct from viridis's dark-purple bottom (~#440154) and inferno's near-black.
 */
export const SENTINEL: readonly [number, number, number] = [0x1a, 0x1a, 0x1a];

function writeSentinel(out: Uint8ClampedArray, o: number): void {
  out[o] = SENTINEL[0];
  out[o + 1] = SENTINEL[1];
  out[o + 2] = SENTINEL[2];
  out[o + 3] = 255;
}

// ── Colormap type ─────────────────────────────────────────────────────────────

/** Available single-channel colormaps. */
export type Colormap = "viridis" | "inferno" | "gray";

/** Options for `rasterizeImage`. */
export interface RasterizeOpts {
  colormap: Colormap;
  /** Percentile for the clip ceiling (present cells only). e.g. 0.99 for the 99th. */
  percentile: number;
  /** If true, apply Math.log1p scaling before normalization. */
  logScale: boolean;
  /** Per-pixel TIC for normalization; divide values[k] by tic[k] when present. */
  tic?: Float32Array | null;
  /** When true AND `tic` is provided, apply TIC normalization. Default: false here. */
  ticNorm?: boolean;
}

// ── LUT stop tables (matplotlib viridis / inferno at 9 evenly-spaced stops) ──────

const VIRIDIS_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [68, 1, 84], // 0.000  dark purple (distinct from the near-black sentinel)
  [72, 40, 120], // 0.125
  [62, 74, 137], // 0.250
  [49, 104, 142], // 0.375
  [38, 130, 142], // 0.500
  [31, 158, 137], // 0.625
  [53, 183, 121], // 0.750
  [110, 206, 88], // 0.875
  [253, 231, 37], // 1.000  yellow (top)
];

const INFERNO_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 4], // 0.000  near-black
  [40, 11, 84], // 0.125  dark purple
  [101, 21, 110], // 0.250  purple
  [159, 42, 99], // 0.375  magenta-red
  [212, 72, 66], // 0.500  orange-red
  [245, 125, 21], // 0.625  orange
  [250, 193, 39], // 0.750  gold
  [249, 201, 52], // 0.875  gold/amber
  [252, 255, 164], // 1.000  pale yellow (top)
];

function interp(
  stops: ReadonlyArray<readonly [number, number, number]>,
  norm: number,
): [number, number, number] {
  const t = Number.isFinite(norm) ? Math.min(Math.max(norm, 0), 1) : 0;
  const segments = stops.length - 1;
  const scaled = t * segments;
  const i = Math.min(Math.floor(scaled), segments - 1);
  const frac = scaled - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
}

/** Map norm∈[0,1] → viridis [r,g,b]. Clamps out-of-range/NaN so it's total. */
export function viridis(norm: number): [number, number, number] {
  return interp(VIRIDIS_STOPS, norm);
}

/** Map norm∈[0,1] → inferno [r,g,b]. Clamps out-of-range/NaN so it's total. */
export function inferno(norm: number): [number, number, number] {
  return interp(INFERNO_STOPS, norm);
}

/** CSS `linear-gradient(...)` string of a colormap ramp, for the legend bar. */
export function colormapGradientCss(colormap: Colormap, angle = "0deg"): string {
  if (colormap === "gray") {
    return `linear-gradient(${angle}, rgb(0,0,0) 0%, rgb(255,255,255) 100%)`;
  }
  const stops = colormap === "inferno" ? INFERNO_STOPS : VIRIDIS_STOPS;
  const css = stops.map(
    ([r, g, b], i) => `rgb(${r},${g},${b}) ${((i / (stops.length - 1)) * 100).toFixed(1)}%`,
  );
  return `linear-gradient(${angle}, ${css.join(", ")})`;
}

// ── Percentile clip ───────────────────────────────────────────────────────────

/**
 * p-th percentile clip ceiling over PRESENT cells only. Absent and non-finite
 * values are excluded. Returns 0 when no present finite value exists.
 */
function percentileClip(values: Float32Array, presenceMask: Uint8Array, p: number): number {
  const present: number[] = [];
  const n = Math.min(values.length, presenceMask.length);
  for (let k = 0; k < n; k++) {
    if (presenceMask[k] === 0) continue;
    const v = values[k]!;
    if (Number.isFinite(v)) present.push(v);
  }
  if (present.length === 0) return 0;
  present.sort((a, b) => a - b);
  const idx = Math.min(present.length - 1, Math.max(0, Math.ceil(p * present.length) - 1));
  const ceil = present[idx]!;
  return Number.isFinite(ceil) && ceil > 0 ? ceil : 0;
}

// ── Single-channel raster ───────────────────────────────────────────────────────

/**
 * Generalized raster render: Float32Array → RGBA bytes (length width*height*4, row-major).
 *
 * - Absent cells → SENTINEL (D-09 / C8).
 * - Log scale uses Math.log1p: raw=0 → norm=0 exactly (never NaN / negative).
 * - Percentile clip from PRESENT cells only.
 * - No cell reorder (C2): out[k*4..] derives from values[k].
 */
export function rasterizeImage(
  values: Float32Array,
  grid: RenderGrid,
  opts: RasterizeOpts,
): Uint8ClampedArray {
  const total = grid.width * grid.height;
  const out = new Uint8ClampedArray(total * 4);
  const { presenceMask } = grid;

  // Optional TIC normalization (never mutate the input).
  let working = values;
  if (opts.ticNorm && opts.tic && opts.tic.length >= total) {
    working = values.slice();
    for (let k = 0; k < total; k++) {
      if (presenceMask[k] === 0) continue;
      const t = opts.tic[k]!;
      if (t > 0) working[k] = working[k]! / t;
    }
  }

  const clipMax = percentileClip(working, presenceMask, opts.percentile);
  const denom = opts.logScale ? Math.log1p(clipMax) : clipMax;

  for (let k = 0; k < total; k++) {
    const o = k * 4;
    if (presenceMask[k] === 0) {
      writeSentinel(out, o);
      continue;
    }
    const raw = working[k]!;
    let norm: number;
    if (opts.logScale) {
      norm = denom > 0 && raw > 0 ? Math.min(Math.log1p(raw) / denom, 1) : 0;
    } else {
      norm = denom > 0 && Number.isFinite(raw) ? Math.min(Math.max(raw / denom, 0), 1) : 0;
    }

    let r: number, g: number, b: number;
    switch (opts.colormap) {
      case "inferno":
        [r, g, b] = inferno(norm);
        break;
      case "gray": {
        const gv = Math.round(Math.min(Math.max(norm, 0), 1) * 255);
        [r, g, b] = [gv, gv, gv];
        break;
      }
      default:
        [r, g, b] = viridis(norm);
        break;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return out;
}

/**
 * Render a per-pixel TIC raster (overview mode). Honors the global colormap + scale
 * just like the ion image; percentile fixed at the 99th (IV parity).
 */
export function rasterizeTic(
  tic: Float32Array,
  grid: RenderGrid,
  colormap: Colormap = "viridis",
  logScale = false,
): Uint8ClampedArray {
  return rasterizeImage(tic, grid, { colormap, percentile: 0.99, logScale });
}

/**
 * Render an RGB multi-channel overlay. Each of up to 3 channels (R/G/B order) is an
 * optional per-pixel Float32Array; absent channels contribute 0. Each channel is
 * normalized to its own present-cell max. Absent cells → SENTINEL.
 */
export function rasterizeMultiChannel(
  channels: (Float32Array | null)[],
  grid: RenderGrid,
  tic: Float32Array | null,
  ticNorm: boolean,
): Uint8ClampedArray {
  const total = grid.width * grid.height;
  const out = new Uint8ClampedArray(total * 4);
  const { presenceMask } = grid;

  const normalized: (Float32Array | null)[] = channels.map((ch) => {
    if (!ch || ch.length < total) return null;
    if (ticNorm && tic && tic.length >= total) {
      const norm = ch.slice();
      for (let k = 0; k < total; k++) {
        if (presenceMask[k] === 0) continue;
        const t = tic[k]!;
        if (t > 0) norm[k] = ch[k]! / t;
      }
      return norm;
    }
    return ch;
  });

  const maxVals = normalized.map((ch) => {
    if (!ch) return 0;
    let m = 0;
    for (let k = 0; k < total; k++) {
      if (presenceMask[k] !== 0 && ch[k]! > m) m = ch[k]!;
    }
    return m;
  });

  for (let k = 0; k < total; k++) {
    const o = k * 4;
    if (presenceMask[k] === 0) {
      writeSentinel(out, o);
      continue;
    }
    const toU8 = (ch: Float32Array | null, maxVal: number): number => {
      if (!ch || maxVal === 0) return 0;
      return Math.round(Math.min(Math.max(ch[k]! / maxVal, 0), 1) * 255);
    };
    out[o] = toU8(normalized[0] ?? null, maxVals[0]!);
    out[o + 1] = toU8(normalized[1] ?? null, maxVals[1]!);
    out[o + 2] = toU8(normalized[2] ?? null, maxVals[2]!);
    out[o + 3] = 255;
  }
  return out;
}

/** Compact intensity formatting for readouts (e.g. `1.4e6`, `0`, `230`). */
export function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-3) return v.toExponential(1);
  return Number(v.toPrecision(4)).toLocaleString();
}

/** Human byte size up to GB (single shared impl — Summary + Structure had divergent copies,
 *  one of which stopped at MB and would print "1234.5 MB" for a >1 GB member). */
export function formatBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
