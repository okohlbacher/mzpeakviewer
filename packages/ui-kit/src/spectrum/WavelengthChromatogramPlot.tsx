import uPlot from "uplot";
// uPlot base CSS ships via @mzpeak/ui-kit/styles.css — no JS side-effect import here
// (matches SpectrumPlot/ChromPlot/WavelengthSpectrumPlot).
import type { WavelengthMatrix } from "@mzpeak/contracts";
import { wheelZoomPlugin } from "./uplotZoom";
import { STAGE, stageAxes, xRange } from "./chartTheme";
import { useUplot } from "./useUplot";

/**
 * PDA (UV/VIS/DAD) chromatogram view derived from a dense time × wavelength
 * matrix. Supports two reduction modes:
 *  - "max": per-row maximum across all finite wavelengths (PDA max trace).
 *  - "xwc": per-row mean across the wavelength window [λ-tol, λ+tol]
 *           (extracted-wavelength chromatogram).
 *
 * The y-axis is signed and always includes 0 so the zero baseline is visible;
 * an empty or all-NaN trace renders a centered "No signal" overlay.
 */
const HEIGHT = 200;

type Trace = {
  time: Float64Array;
  intensity: Float64Array;
  yMin: number;
  yMax: number;
  empty: boolean;
  seriesLabel: string;
  yAxisLabel: string;
};

function emptyTrace(seriesLabel = "PDA max trace", yAxisLabel = "Intensity"): Trace {
  return {
    time: new Float64Array([0, 1]),
    intensity: new Float64Array([0, 0]),
    yMin: 0,
    yMax: 0,
    empty: true,
    seriesLabel,
    yAxisLabel,
  };
}

function deriveTrace(
  matrix: WavelengthMatrix | null,
  mode: "max" | "xwc",
  lambdaNm: number | undefined,
  tolNm: number | undefined,
): Trace {
  if (!matrix || matrix.height === 0 || matrix.width === 0) {
    return emptyTrace();
  }

  const height = matrix.height;
  const width = matrix.width;
  const time = Float64Array.from(matrix.time);
  const intensity = new Float64Array(height);
  let yMin = Infinity;
  let yMax = -Infinity;
  let finiteCount = 0;

  if (mode === "max") {
    for (let t = 0; t < height; t++) {
      let max = -Infinity;
      const base = t * width;
      for (let w = 0; w < width; w++) {
        const v = matrix.intensity[base + w]!;
        if (Number.isFinite(v) && v > max) {
          max = v;
        }
      }
      const y = Number.isFinite(max) ? max : NaN;
      intensity[t] = y;
      if (Number.isFinite(y)) {
        finiteCount++;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  } else {
    if (lambdaNm === undefined) {
      return emptyTrace();
    }
    const tol = tolNm ?? 0;
    const lo = lambdaNm - tol;
    const hi = lambdaNm + tol;
    for (let t = 0; t < height; t++) {
      let sum = 0;
      let count = 0;
      const base = t * width;
      for (let w = 0; w < width; w++) {
        const wl = matrix.wavelength[w]!;
        if (wl < lo || wl > hi) continue;
        const v = matrix.intensity[base + w]!;
        if (Number.isFinite(v)) {
          sum += v;
          count++;
        }
      }
      const y = count > 0 ? sum / count : NaN;
      intensity[t] = y;
      if (Number.isFinite(y)) {
        finiteCount++;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }

  const unit = matrix.intensityUnit;
  const yAxisLabel = unit && unit !== "Intensity" ? `Intensity (${unit})` : "Intensity";
  const seriesLabel =
    mode === "max"
      ? "PDA max trace"
      : tolNm !== undefined && tolNm > 0
        ? `${lambdaNm} nm ± ${tolNm}`
        : `${lambdaNm} nm`;

  if (finiteCount === 0) {
    return {
      time,
      intensity,
      yMin: 0,
      yMax: 0,
      empty: true,
      seriesLabel,
      yAxisLabel,
    };
  }

  return {
    time,
    intensity,
    yMin,
    yMax,
    empty: false,
    seriesLabel,
    yAxisLabel,
  };
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

/** Horizontal zero baseline for signed PDA traces. */
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

/** Centered overlay for an empty or all-NaN trace. */
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

export function WavelengthChromatogramPlot({
  matrix,
  mode,
  lambdaNm,
  tolNm,
}: {
  matrix: WavelengthMatrix | null;
  mode: "max" | "xwc";
  lambdaNm?: number;
  tolNm?: number;
}) {
  const hostRef = useUplot(
    (el, width) => {
      const trace = deriveTrace(matrix, mode, lambdaNm, tolNm);
      const data: uPlot.AlignedData = trace.empty
        ? [new Float64Array([0, 1]), new Float64Array([0, 0])]
        : [trace.time, trace.intensity];

      const opts: uPlot.Options = {
        width,
        height: HEIGHT,
        scales: {
          x: { time: false, range: xRange },
          y: { range: yRange(trace.yMin, trace.yMax) },
        },
        // Left-drag stays a click; zoom via wheel, pan via middle-drag.
        cursor: { y: false, drag: { x: false, y: false } },
        legend: { show: false },
        plugins: [wheelZoomPlugin({ factor: 0.8 })],
        series: [
          { label: "RT (s)" },
          {
            label: trace.seriesLabel,
            stroke: STAGE.line,
            width: 1.25,
            points: { show: true, size: 4, stroke: STAGE.line, fill: STAGE.pointFill },
          },
        ],
        axes: stageAxes("retention time (s)", trace.yAxisLabel),
        hooks: {
          draw: [(u) => drawZeroBaseline(u), (u) => (trace.empty ? drawNoSignal(u) : undefined)],
        },
      };
      return new uPlot(opts, data, el);
    },
    HEIGHT,
    [matrix, mode, lambdaNm, tolNm],
    [],
  );

  return <div ref={hostRef} className="chart-host" />;
}
