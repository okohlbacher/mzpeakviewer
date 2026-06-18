import { useRef } from "react";
import uPlot from "uplot";
// uPlot base CSS ships via @mzpeak/ui-kit/styles.css — no JS side-effect import here
// (matches SpectrumPlot/ChromPlot; codex Phase-2 #8).
import type { WavelengthSpectrumArrays } from "@mzpeak/contracts";
import { wheelZoomPlugin } from "./uplotZoom";
import { STAGE, stageAxes, xRange, compactIntensity } from "./chartTheme";
import { useUplot } from "./useUplot";

/**
 * UV/VIS (PDA/DAD optical) wavelength spectrum: wavelength in nm (x) vs signal
 * (y). SEPARATE from {@link SpectrumPlot} — wavelength is **not** m/z and the
 * signal may be **signed** (baseline-subtracted) and is never log-scaled.
 *
 * The renderer adapts to the data SHAPE:
 *  - a single point → one labelled stem/marker at (λ, value);
 *  - sparse / irregular spacing (few points, or gaps larger than ~`GAP_K`× the
 *    median spacing) → markers, with the connecting line BROKEN across each big
 *    gap (no interpolation across a hole), and never a continuous line for
 *    < `MIN_LINE_POINTS` points;
 *  - dense, regularly-sampled → a continuous line.
 *
 * The y-domain always includes 0 (so a signed spectrum reads correctly against a
 * drawn zero baseline) and an all-zero / empty scan shows a "No signal" overlay
 * instead of a flat, invisible line.
 */
const HEIGHT = 280;

/** A gap wider than this × the median wavelength spacing breaks the line path. */
const GAP_K = 4;
/** Below this many points we never draw a continuous line (markers/stems only). */
const MIN_LINE_POINTS = 10;

export type WavelengthPlotMode = "auto" | "line" | "stem";

type Shape = "empty" | "single" | "stem" | "line";

/** Finite [min, max] over the signal, plus whether every finite value is zero. */
function signalExtent(ys: Float32Array): { min: number; max: number; allZero: boolean; n: number } {
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (let i = 0; i < ys.length; i++) {
    const v = ys[i]!;
    if (Number.isFinite(v)) {
      n++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (n === 0) return { min: 0, max: 0, allZero: true, n: 0 };
  return { min, max, allZero: min === 0 && max === 0, n };
}

/** Median of the consecutive wavelength spacings (robust to a few large gaps). */
function medianSpacing(xs: Float32Array): number {
  if (xs.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!;
    if (Number.isFinite(d) && d > 0) gaps.push(d);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}

/** Decide the render shape from the data + requested mode. */
function resolveShape(s: WavelengthSpectrumArrays, mode: WavelengthPlotMode, n: number): Shape {
  if (n === 0) return "empty";
  if (n === 1) return "single";
  if (mode === "stem") return "stem";
  if (mode === "line") return "line";
  // auto: too few points to ever interpolate → markers/stems. Otherwise a line,
  // whose path toData() breaks across any gap > GAP_K× median spacing (so an
  // irregular/gappy dense spectrum still shows markers between segments).
  if (n < MIN_LINE_POINTS) return "stem";
  const med = medianSpacing(s.wavelength);
  if (med <= 0) return "stem";
  return "line";
}

/**
 * Build uPlot data. For "line" shape we insert a NaN break before any sample that
 * sits across a gap > GAP_K× median spacing — uPlot does not connect across NaN,
 * so the path is broken at each hole without re-sorting or interpolating. For
 * "stem"/"single" the raw arrays are used and markers are drawn by the series.
 */
function toData(s: WavelengthSpectrumArrays, shape: Shape): uPlot.AlignedData {
  const x = s.wavelength;
  const y = s.intensity;
  if (shape !== "line") {
    return [Float64Array.from(x), Float64Array.from(y)];
  }
  const med = medianSpacing(x);
  const threshold = med > 0 ? GAP_K * med : Infinity;
  const xs: number[] = [];
  // y must be a plain array (not Float32Array) so it can hold `null`: uPlot treats a
  // NULL y as a gap (line + spline paths both skip it), whereas NaN is fed straight
  // into the path coordinates and corrupts the curve — especially the spline.
  const ys: (number | null)[] = [];
  for (let i = 0; i < x.length; i++) {
    if (i > 0 && x[i]! - x[i - 1]! > threshold) {
      // Break the stroke before the hole with a null y at the previous x.
      xs.push(x[i - 1]!);
      ys.push(null);
    }
    xs.push(x[i]!);
    ys.push(y[i]!);
  }
  return [Float64Array.from(xs), ys as unknown as (number | null)[]] as uPlot.AlignedData;
}

/** y-scale range: always spans 0, padded; flat data gets a unit window. */
function yRange(min: number, max: number): (u: uPlot) => [number, number] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  return () => {
    if (lo === hi) return [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  };
}

export function WavelengthSpectrumPlot({
  spectrum,
  mode = "auto",
}: {
  spectrum: WavelengthSpectrumArrays | null;
  /** Force the render shape. @default "auto" */
  mode?: WavelengthPlotMode;
}) {
  const specRef = useRef<WavelengthSpectrumArrays | null>(spectrum);
  specRef.current = spectrum;

  const hostRef = useUplot(
    (el, width) => {
      const s = spectrum;
      const ext = s ? signalExtent(s.intensity) : { min: 0, max: 0, allZero: true, n: 0 };
      const shape: Shape = s ? resolveShape(s, mode, ext.n) : "empty";
      const noSignal = !s || shape === "empty" || ext.allZero;

      // "Intensity (counts)" / "Intensity (AU)" — but never the redundant
      // "Intensity (Intensity)" when the unit is the generic fallback label.
      const unit = s?.intensityUnit;
      const yLabel = unit && unit !== "Intensity" ? `Intensity (${unit})` : "Intensity";

      // Always build a uPlot (even with no data) so the axes + "No signal" overlay
      // render — unlike the MS plot, an empty/all-zero scan must still draw.
      const data: uPlot.AlignedData = s && !noSignal
        ? toData(s, shape)
        : s && s.wavelength.length
          ? [Float64Array.from(s.wavelength), Float64Array.from(s.intensity)]
          : [new Float64Array([0, 1]), new Float64Array([0, 0])];

      const drawLine = shape === "line";
      const drawPoints = shape === "stem" || shape === "single" || shape === "line";
      // UV/VIS spectra are smooth, densely-sampled curves — draw the connecting line as a
      // monotone-ish cubic SPLINE (not straight segments) with a marker at every
      // wavelength. uPlot draws the spline per contiguous run, so the null gap-breaks
      // from toData() still split the curve. (Optional chaining: older uPlot builds may
      // lack paths.spline.)
      const splinePath = uPlot.paths?.spline?.();

      const opts: uPlot.Options = {
        width,
        height: HEIGHT,
        scales: {
          x: { time: false, range: xRange },
          y: { range: yRange(ext.min, ext.max) },
        },
        legend: { show: false },
        plugins: [wheelZoomPlugin({ factor: 0.8 })],
        series: [
          { label: "λ (nm)" },
          {
            label: "intensity",
            stroke: STAGE.line,
            // Line only for the dense shape; width 0 hides the stroke for sparse/stem/
            // single so only markers (and our drawn stems) show.
            width: drawLine ? 1.5 : 0,
            // Spline interpolation for the connecting line (smooth UV/VIS curve).
            ...(drawLine && splinePath ? { paths: splinePath } : {}),
            points: drawPoints
              ? { show: true, size: shape === "single" ? 7 : 4, stroke: STAGE.line, fill: STAGE.pointFill }
              : { show: false },
            // Don't bridge NaN holes — keep the path broken across large gaps.
            spanGaps: false,
          },
        ],
        axes: stageAxes("Wavelength (nm)", yLabel),
        hooks: {
          draw: [
            (u) => drawZeroBaseline(u),
            (u) => drawStems(u, specRef.current, shape),
            (u) => drawSingleLabel(u, specRef.current, shape),
            (u) => (noSignal ? drawNoSignal(u) : undefined),
          ],
        },
      };
      return new uPlot(opts, data, el);
    },
    HEIGHT,
    [spectrum, mode],
    [],
  );

  return <div ref={hostRef} className="chart-host" />;
}

/** Horizontal zero line — the reference for signed (baseline-subtracted) signal. */
function drawZeroBaseline(u: uPlot) {
  const ymin = u.scales.y!.min;
  const ymax = u.scales.y!.max;
  if (ymin == null || ymax == null || 0 < ymin || 0 > ymax) return;
  const y = u.valToPos(0, "y", true);
  const { ctx } = u;
  ctx.save();
  ctx.strokeStyle = STAGE.axis;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(u.bbox.left, y);
  ctx.lineTo(u.bbox.left + u.bbox.width, y);
  ctx.stroke();
  ctx.restore();
}

/** Vertical stems from the zero baseline to each sample (sparse / stem shapes). */
function drawStems(u: uPlot, s: WavelengthSpectrumArrays | null, shape: Shape) {
  if (!s || (shape !== "stem" && shape !== "single")) return;
  const xmin = u.scales.x!.min;
  const xmax = u.scales.x!.max;
  if (xmin == null || xmax == null) return;
  const y0 = u.valToPos(0, "y", true);
  const { ctx } = u;
  ctx.save();
  ctx.strokeStyle = STAGE.line;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  for (let i = 0; i < s.wavelength.length; i++) {
    const wl = s.wavelength[i]!;
    const v = s.intensity[i]!;
    if (!Number.isFinite(wl) || !Number.isFinite(v) || wl < xmin || wl > xmax) continue;
    const x = u.valToPos(wl, "x", true);
    const y = u.valToPos(v, "y", true);
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** For a 1-point spectrum, label the single peak with its (λ, value). */
function drawSingleLabel(u: uPlot, s: WavelengthSpectrumArrays | null, shape: Shape) {
  if (!s || shape !== "single" || s.wavelength.length === 0) return;
  const wl = s.wavelength[0]!;
  const v = s.intensity[0]!;
  if (!Number.isFinite(wl) || !Number.isFinite(v)) return;
  const x = u.valToPos(wl, "x", true);
  const y = u.valToPos(v, "y", true);
  const { ctx } = u;
  ctx.save();
  ctx.font = "11px IBM Plex Mono, monospace";
  ctx.fillStyle = STAGE.label;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${wl.toFixed(1)} nm · ${compactIntensity(v)}`, x, y - 8);
  ctx.restore();
}

/** Centered overlay for an empty or all-zero scan (no visible trace otherwise). */
function drawNoSignal(u: uPlot) {
  const { ctx } = u;
  ctx.save();
  ctx.font = "13px IBM Plex Sans, sans-serif";
  ctx.fillStyle = STAGE.axis;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("No signal", u.bbox.left + u.bbox.width / 2, u.bbox.top + u.bbox.height / 2);
  ctx.restore();
}
