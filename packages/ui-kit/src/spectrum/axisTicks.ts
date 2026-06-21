// Shared canvas-axis tick helpers for the 2-D heatmaps (WavelengthHeatmap,
// MobilityFrameHeatmap). Both paint raw <canvas> axes and need the same "nice"
// tick selection + compact label formatting.

/** ~`count` "nice" tick values spanning [lo, hi]. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-6; v += step) out.push(v);
  return out;
}

/** Compact axis-tick label: exponential for extreme magnitudes, locale-grouped for
 *  large integers, else fixed decimals. `smallDecimals` is the precision for |v| < 10
 *  (2 by default; the mobility axis passes 3 for finer 1/K0 ticks). */
export function fmtTick(v: number, smallDecimals = 2): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(1);
  if (a >= 1000) return Math.round(v).toLocaleString();
  return Number.isInteger(v) ? String(v) : v.toFixed(a < 10 ? smallDecimals : 2);
}
