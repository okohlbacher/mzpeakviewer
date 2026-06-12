// colormap.ts — pure, DOM-free ion-image rasterization helpers.
//
// A faithful-but-simple port of mzPeakIV's rasterize.ts: a viridis LUT plus a
// single paint helper that writes an RGBA byte raster from a Float32 ion image.
// No `react`, no canvas/DOM API — so it stays unit-testable in isolation.
//
// Two correctness invariants (carried from IV):
//   - Absent pixels (presenceMask[k] === 0) render to a fixed near-black SENTINEL,
//     NEVER colormap-bottom — "no data" must be visually distinct from zero signal.
//   - Orientation is identity: output byte offset k*4 maps to input value at k.
//     The grid's coordKey encoding is `y*width + x`, so NO transpose/flip here.

/**
 * Absent-pixel sentinel (RGBA 26,26,26,255 — #1a1a1a). Near-black, visually
 * distinct from viridis's dark-purple bottom (~#440154).
 */
export const SENTINEL: readonly [number, number, number] = [0x1a, 0x1a, 0x1a];

/**
 * Standard matplotlib viridis at 9 evenly-spaced anchor stops (0, 0.125, …, 1).
 * Same anchors as IV's tokens/colormaps.css and rasterize.ts.
 */
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

/**
 * Map a normalized intensity `norm ∈ [0,1]` to an `[r,g,b]` viridis triple by
 * linear interpolation between anchor stops. Out-of-range / NaN inputs clamp, so
 * the function is total.
 */
export function viridis(norm: number): [number, number, number] {
  const t = Number.isFinite(norm) ? Math.min(Math.max(norm, 0), 1) : 0;
  const segments = VIRIDIS_STOPS.length - 1;
  const scaled = t * segments;
  const i = Math.min(Math.floor(scaled), segments - 1);
  const frac = scaled - i;
  const a = VIRIDIS_STOPS[i]!;
  const b = VIRIDIS_STOPS[i + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
}

/**
 * Build a 256-entry viridis LUT (flat RGB triples, length 768) for fast per-pixel
 * lookup without re-interpolating on every cell.
 */
export function buildViridisLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = viridis(i / 255);
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
}

const VIRIDIS_LUT = buildViridisLut();

/**
 * Paint a Float32 ion image into an RGBA raster, normalized to [0, max] (linear).
 *
 * - Present cells (presenceMask[k] !== 0) are colormapped via the viridis LUT.
 * - Absent cells (presenceMask[k] === 0) get the near-black SENTINEL.
 * - `max <= 0` (or non-finite) paints every present cell as colormap-bottom (a
 *   flat/empty image) rather than dividing by zero.
 *
 * Pure: allocates and returns the raster; does NOT touch a canvas. The caller
 * does `ctx.putImageData(new ImageData(raster, width, height), 0, 0)`.
 */
export function paintIonImage(
  img: Float32Array,
  width: number,
  height: number,
  presenceMask: Uint8Array,
  max: number,
): Uint8ClampedArray {
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  for (let k = 0; k < n; k++) {
    const o = k * 4;
    out[o + 3] = 255;
    if (presenceMask[k] === 0) {
      out[o] = SENTINEL[0];
      out[o + 1] = SENTINEL[1];
      out[o + 2] = SENTINEL[2];
      continue;
    }
    const v = img[k] ?? 0;
    const norm = safeMax > 0 && Number.isFinite(v) ? v / safeMax : 0;
    const idx = Math.min(255, Math.max(0, Math.round(norm * 255))) * 3;
    out[o] = VIRIDIS_LUT[idx]!;
    out[o + 1] = VIRIDIS_LUT[idx + 1]!;
    out[o + 2] = VIRIDIS_LUT[idx + 2]!;
  }
  return out;
}

/**
 * CSS `linear-gradient(...)` string of the viridis ramp, for the legend bar.
 * `angle` defaults to `90deg` (left→right, low→high); pass `0deg` for a vertical
 * bar with high at the top.
 */
export function viridisGradientCss(angle = "90deg"): string {
  const stops = VIRIDIS_STOPS.map(
    ([r, g, b], i) =>
      `rgb(${r},${g},${b}) ${((i / (VIRIDIS_STOPS.length - 1)) * 100).toFixed(1)}%`,
  );
  return `linear-gradient(${angle}, ${stops.join(", ")})`;
}
