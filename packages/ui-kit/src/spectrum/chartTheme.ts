import type uPlot from "uplot";

/**
 * uPlot palette for the spectrum / chromatogram viewer. The viewer sits on a
 * WHITE panel (per request), so axes/labels are dark and gridlines light; the
 * series stroke is OpenMS blue and the selected-time marker signal red.
 */
export const STAGE = {
  line: "#3b54da", // spectrum / chromatogram stroke (OpenMS blue)
  fill: "rgba(59,84,218,0.10)", // profile-spectrum area fill
  marker: "#c00000", // selected-time marker (signal red)
  band: "rgba(255,200,0,0.25)", // active XIC m/z window (warning band)
  label: "#353c43", // peak m/z labels (dark on white)
  axis: "#6b757e", // axis tick text
  grid: "#e3e7eb", // gridlines
  pointFill: "#ffffff", // marker interior (= panel bg → hollow dots)
} as const;

/**
 * x-scale range function. uPlot's auto-range can return null for a small,
 * near-uniform x range (e.g. an MS1-only TIC), which blanks the plot. This
 * respects an explicit pinned range (so wheel/box zoom keep working) and only
 * falls back to the data extent when the auto-range is missing.
 */
export function xRange(
  u: uPlot,
  initMin: number,
  initMax: number,
): [number, number] {
  if (Number.isFinite(initMin) && Number.isFinite(initMax)) return [initMin, initMax];
  // Scan for the finite min/max rather than trusting xs[0]/xs[last], which are
  // wrong for unsorted or NaN-terminated data (CODEX-REVIEW chartTheme).
  const ext = finiteExtent(u.data[0]);
  if (!ext) return [0, 1];
  const [a, b] = ext;
  return [a, b > a ? b : a + 1];
}

/** Finite [min, max] over an x-array, or null when there are no finite values. */
export function finiteExtent(
  xs: ArrayLike<number | null | undefined> | undefined,
): [number, number] | null {
  if (!xs || xs.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Compact number formatting for intensity ticks. Intensities reach 1e8+, and the
 * full grouped form ("100.000.000") is so wide it clips at the panel edge and the
 * rotated axis label overprints it. SI suffixes (k/M/G/T) keep ticks ~4 chars.
 */
export function compactIntensity(v: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a < 1000) return String(Math.round(v));
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [factor, suffix] of units) {
    if (a >= factor) {
      const scaled = v / factor;
      // One decimal only when it adds information (e.g. 1.5M, not 100.0M).
      const str = Math.abs(scaled) >= 100 ? scaled.toFixed(0) : scaled.toFixed(1);
      return str.replace(/\.0$/, "") + suffix;
    }
  }
  return String(v);
}

const yValues: uPlot.Axis.Values = (_u, splits) =>
  splits.map((s) => (s == null ? "" : compactIntensity(s)));

/** Light-panel axes: dark tick text, faint grid. */
export function stageAxes(xLabel: string, yLabel: string): uPlot.Axis[] {
  const common = {
    stroke: STAGE.axis,
    grid: { stroke: STAGE.grid, width: 1 },
    ticks: { stroke: STAGE.grid, width: 1 },
    font: "11px IBM Plex Mono, monospace",
    labelFont: "11px IBM Plex Sans, sans-serif",
  };
  return [
    { ...common, label: xLabel, labelGap: 4, labelSize: 22 },
    {
      ...common,
      label: yLabel,
      labelGap: 6,
      labelSize: 18,
      values: yValues,
      // Reserve room for the compact ticks (~5 chars) plus the rotated label, so
      // neither clips at the panel edge nor overprints the other.
      size: 58,
    },
  ];
}
