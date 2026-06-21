// Shared perceptual colormap for the canvas heatmaps (WavelengthHeatmap, the IMS frame
// heatmap). Self-contained, no deps — a 256-entry viridis RGB LUT built once at module load
// from matplotlib viridis control points (perceptually-uniform, ends yellow-green not red).

const VIRIDIS_ANCHORS: ReadonlyArray<readonly [number, number, number]> = [
  [0.267, 0.005, 0.329], [0.283, 0.141, 0.458], [0.254, 0.265, 0.53],
  [0.207, 0.372, 0.553], [0.164, 0.471, 0.558], [0.128, 0.567, 0.551],
  [0.135, 0.659, 0.518], [0.267, 0.749, 0.441], [0.478, 0.821, 0.318],
  [0.741, 0.873, 0.15], [0.993, 0.906, 0.144],
];

function clamp255(x: number): number {
  const v = Math.round(x * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Linear interpolation over the anchor control points. */
function viridisPoly(t: number): [number, number, number] {
  const x = (t < 0 ? 0 : t > 1 ? 1 : t) * (VIRIDIS_ANCHORS.length - 1);
  const i = Math.min(VIRIDIS_ANCHORS.length - 2, Math.floor(x));
  const f = x - i;
  const a = VIRIDIS_ANCHORS[i]!;
  const b = VIRIDIS_ANCHORS[i + 1]!;
  return [clamp255(a[0] + (b[0] - a[0]) * f), clamp255(a[1] + (b[1] - a[1]) * f), clamp255(a[2] + (b[2] - a[2]) * f)];
}

const VIRIDIS_LUT = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = viridisPoly(i / 255);
    lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
  }
  return lut;
})();

/** Viridis for a fraction in [0,1] (clamped). Returns [r,g,b] in 0..255. */
export function viridis(f: number): [number, number, number] {
  let t = Number.isFinite(f) ? f : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const i = Math.round(t * 255) * 3;
  return [VIRIDIS_LUT[i]!, VIRIDIS_LUT[i + 1]!, VIRIDIS_LUT[i + 2]!];
}
