import { useRef } from "react";
import uPlot from "uplot";
// uPlot base CSS ships via @mzpeak/ui-kit/styles.css — no JS side-effect import here
// (codex Phase-2 #8 / re-review).
import { wheelZoomPlugin } from "./uplotZoom";
import { STAGE, stageAxes, xRange } from "./chartTheme";
import { useUplot } from "./useUplot";

/**
 * One point of an extracted-ion / total-ion chromatogram, as the plot consumes
 * it. Self-contained presentational type mirroring only the fields this cluster
 * reads (`time`, `intensity`); the reader's `ChromPoint` (which also carries an
 * `index`) is structurally assignable to it. Kept local so ui-kit stays free of
 * any `@mzpeak/contracts` / reader import.
 */
export type ChromPoint = { time: number; intensity: number };

/**
 * Chromatogram navigator: time (x) vs summed intensity (y). Clicking anywhere
 * picks the nearest time and calls `onPick`, which the Browse tab maps to the
 * nearest spectrum. A vertical marker shows the currently-selected time.
 */
const HEIGHT = 200;

function toData(points: ChromPoint[]): uPlot.AlignedData {
  const xs = new Float64Array(points.length);
  const ys = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    xs[i] = points[i]!.time;
    ys[i] = points[i]!.intensity;
  }
  return [xs, ys];
}

export function ChromPlot({
  points,
  onPick,
  selectedTime,
  height = HEIGHT,
}: {
  points: ChromPoint[];
  onPick: (time: number) => void;
  selectedTime: number | null;
  /** Plot height in px (the managed Chromatograms cards resize this). @default 200 */
  height?: number;
}) {
  const selRef = useRef<number | null>(selectedTime);
  selRef.current = selectedTime;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const hostRef = useUplot(
    (el, width) => {
      const data = toData(points);
      if (data[0].length === 0) return null;
      const opts: uPlot.Options = {
        width,
        height,
        scales: { x: { time: false, range: xRange } },
        // Left-drag stays a click (navigate); zoom via wheel, pan via middle-drag.
        cursor: { y: false, drag: { x: false, y: false } },
        legend: { show: false },
        plugins: [wheelZoomPlugin({ factor: 0.8 })],
        series: [
          { label: "RT (s)" },
          {
            label: "intensity",
            stroke: STAGE.line,
            width: 1.25,
            points: { show: true, size: 4, stroke: STAGE.line, fill: STAGE.pointFill },
          },
        ],
        axes: stageAxes("retention time (s)", "intensity"),
        hooks: {
          draw: [(u) => drawTimeMarker(u, selRef.current)],
          ready: [
            (u) => {
              u.over.style.cursor = "crosshair";
              u.over.addEventListener("click", () => {
                const left = u.cursor.left;
                if (left == null || left < 0) return;
                const t = u.posToVal(left, "x");
                if (Number.isFinite(t)) onPickRef.current(t);
              });
            },
          ],
        },
      };
      return new uPlot(opts, data, el);
    },
    height,
    [points], // height drives setSize (not rebuild) inside useUplot, preserving zoom on resize
    [selectedTime],
  );

  return <div ref={hostRef} className="chart-host" />;
}

/** Vertical marker at the currently-selected retention time. */
function drawTimeMarker(u: uPlot, t: number | null) {
  if (t === null) return;
  const x = u.valToPos(t, "x", true);
  const { ctx } = u;
  ctx.save();
  ctx.strokeStyle = STAGE.marker;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, u.bbox.top);
  ctx.lineTo(x, u.bbox.top + u.bbox.height);
  ctx.stroke();
  ctx.restore();
}
