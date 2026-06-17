import uPlot from "uplot";
import { wheelZoomPlugin } from "./uplotZoom";
import { stageAxes, xRange } from "./chartTheme";
import { useUplot } from "./useUplot";
import type { ChromPoint } from "./ChromPlot";

/**
 * One overlaid trace: a labelled, coloured chromatogram. Used by the DIA fragment
 * extractor to show several transition XICs co-eluting on one RT axis (Skyline-style
 * peak group). Each trace carries its own (time, intensity) points; the plot aligns
 * them onto the union of all times so traces with slightly different sampling still
 * overlay correctly.
 */
export type ChromTrace = { label: string; color: string; points: ChromPoint[] };

const HEIGHT = 240;

/** Build uPlot AlignedData: shared x = ascending union of all trace times; one y per
 *  trace, null where that trace has no point at a given time. */
function toAligned(traces: ChromTrace[]): uPlot.AlignedData {
  const times = new Set<number>();
  for (const t of traces) for (const p of t.points) times.add(p.time);
  const xs = [...times].sort((a, b) => a - b);
  const xIndex = new Map<number, number>();
  xs.forEach((x, i) => xIndex.set(x, i));
  const ys = traces.map((t) => {
    const col = new Array<number | null>(xs.length).fill(null);
    for (const p of t.points) {
      const i = xIndex.get(p.time);
      if (i !== undefined) col[i] = p.intensity;
    }
    return col;
  });
  return [new Float64Array(xs), ...ys] as unknown as uPlot.AlignedData;
}

/**
 * Multi-trace chromatogram overlay (read-only: no click-to-pick). Renders each trace in
 * its own colour over a shared retention-time axis, with a legend. Empty traces (no
 * points) render nothing.
 */
export function MultiChromPlot({ traces }: { traces: ChromTrace[] }) {
  const hostRef = useUplot(
    (el, width) => {
      const data = toAligned(traces);
      if (data[0].length === 0 || traces.length === 0) return null;
      const opts: uPlot.Options = {
        width,
        height: HEIGHT,
        scales: { x: { time: false, range: xRange } },
        cursor: { y: false, drag: { x: false, y: false } },
        legend: { show: true },
        plugins: [wheelZoomPlugin({ factor: 0.8 })],
        series: [
          { label: "RT (s)" },
          ...traces.map((t) => ({
            label: t.label,
            stroke: t.color,
            width: 1.25,
            points: { show: false },
          })),
        ],
        axes: stageAxes("retention time (s)", "intensity"),
      };
      return new uPlot(opts, data, el);
    },
    HEIGHT,
    [traces],
    [],
  );

  return <div ref={hostRef} className="chart-host" />;
}
