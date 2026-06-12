import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { SpectrumArrays } from "../reader/types";
import { wheelZoomPlugin } from "./uplotZoom";
import { STAGE, stageAxes, xRange, finiteExtent } from "./chartTheme";
import { nearestPeakIndex, topPeakIndices } from "./peaks";
import { useUplot } from "./useUplot";

const ZOOM_EPS = 1e-4;
function sameRange(a: [number, number] | null, b: [number, number] | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a[0] - b[0]) < ZOOM_EPS && Math.abs(a[1] - b[1]) < ZOOM_EPS;
}

/**
 * Single-spectrum plot: m/z (x) vs intensity (y). Profile spectra draw as a
 * line; centroid spectra as a stick spectrum. Interactions: wheel-zoom / box-
 * zoom (left drag) / pan (middle drag) / double-click reset, the most intense
 * visible peaks are auto-labelled with their m/z, and a hover tooltip reads the
 * nearest peak. An optional translucent band marks the active XIC m/z window.
 */
const HEIGHT = 320;
const MAX_LABELS = 10;
const LABEL_GAP_PX = 34;

function toSeries(s: SpectrumArrays | null): uPlot.AlignedData {
  if (!s) return [new Float64Array(0), new Float64Array(0)];
  if (s.representation !== "centroid") {
    return [s.mz, Float64Array.from(s.intensity)];
  }
  const n = s.mz.length;
  const xs = new Float64Array(n * 3);
  const ys = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    xs[j] = s.mz[i];
    xs[j + 1] = s.mz[i];
    xs[j + 2] = s.mz[i];
    ys[j + 1] = s.intensity[i];
  }
  return [xs, ys];
}

export type ReporterMarker = { mz: number; label: string; matched: boolean };

export function SpectrumPlot({
  spectrum,
  xicWindow,
  reporters,
  zoom,
  onZoomChange,
}: {
  spectrum: SpectrumArrays | null;
  xicWindow: { mz: number; tolDa: number } | null;
  reporters?: ReporterMarker[];
  /** Desired m/z view [lo, hi] (null = full); applied imperatively for Share view. */
  zoom?: [number, number] | null;
  /** Reports the live m/z view to the store (null at full range). */
  onZoomChange?: (range: [number, number] | null) => void;
}) {
  const specRef = useRef<SpectrumArrays | null>(spectrum);
  specRef.current = spectrum;
  const windowRef = useRef(xicWindow);
  windowRef.current = xicWindow;
  const reportersRef = useRef<ReporterMarker[] | undefined>(reporters);
  reportersRef.current = reporters;
  const zoomRef = useRef<[number, number] | null | undefined>(zoom);
  zoomRef.current = zoom;
  const onZoomRef = useRef(onZoomChange);
  onZoomRef.current = onZoomChange;
  const plotRef = useRef<uPlot | null>(null);
  const rafRef = useRef<number | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  const hostRef = useUplot(
    (el, width) => {
      const data = toSeries(spectrum);
      if (data[0].length === 0) return null;
      const opts: uPlot.Options = {
        width,
        height: HEIGHT,
        scales: { x: { time: false, range: xRange } },
        legend: { show: false },
        plugins: [wheelZoomPlugin({ factor: 0.8 })],
        series: [
          { label: "m/z" },
          {
            label: "intensity",
            stroke: STAGE.line,
            fill: STAGE.fill,
            width: 1,
            points: { show: false },
          },
        ],
        axes: stageAxes("m/z", "intensity"),
        hooks: {
          draw: [
            (u) => drawXicBand(u, windowRef.current),
            (u) => drawReporterMarkers(u, reportersRef.current),
            (u) => drawPeakLabels(u, specRef.current),
          ],
          setCursor: [(u) => updateTooltip(u, tipRef.current, specRef.current)],
          setScale: [(u, key) => key === "x" && reportZoom(u, rafRef, zoomRef, onZoomRef)],
        },
      };
      const plot = new uPlot(opts, data, el);
      plotRef.current = plot;
      // Tooltip lives inside the cursor overlay so its coords match cursor.left/top.
      const tip = document.createElement("div");
      tip.className = "spec-tooltip";
      plot.over.appendChild(tip);
      tipRef.current = tip;
      return plot;
    },
    HEIGHT,
    [spectrum],
    [xicWindow],
  );

  // Restore a requested m/z view (Share view deep link) imperatively — no rebuild,
  // so it also works when the zoom arrives after the spectrum has loaded.
  useEffect(() => {
    const u = plotRef.current;
    if (!u || !zoom) return;
    const cur: [number, number] | null =
      u.scales.x.min != null && u.scales.x.max != null ? [u.scales.x.min, u.scales.x.max] : null;
    if (sameRange(cur, zoom)) return;
    u.setScale("x", { min: zoom[0], max: zoom[1] });
  }, [zoom, spectrum]);

  return <div ref={hostRef} className="chart-host" />;
}

/** Report the live x-axis (m/z) view to the store, debounced to one frame.
 *  Maps the full data extent to null and skips echoing the requested zoom. */
function reportZoom(
  u: uPlot,
  rafRef: { current: number | null },
  zoomRef: { current: [number, number] | null | undefined },
  onZoomRef: { current: ((r: [number, number] | null) => void) | undefined },
) {
  if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  rafRef.current = requestAnimationFrame(() => {
    rafRef.current = null;
    const cb = onZoomRef.current;
    if (!cb) return;
    const min = u.scales.x.min;
    const max = u.scales.x.max;
    if (min == null || max == null) return;
    const ext = finiteExtent(u.data[0]);
    const isFull = !ext || (Math.abs(min - ext[0]) < ZOOM_EPS && Math.abs(max - ext[1]) < ZOOM_EPS);
    const next: [number, number] | null = isFull ? null : [min, max];
    if (sameRange(next, zoomRef.current ?? null)) return; // don't echo our own set
    cb(next);
  });
}

function drawXicBand(u: uPlot, win: { mz: number; tolDa: number } | null) {
  if (!win) return;
  const xLo = u.valToPos(win.mz - win.tolDa, "x", true);
  const xHi = u.valToPos(win.mz + win.tolDa, "x", true);
  const { ctx } = u;
  ctx.save();
  ctx.fillStyle = STAGE.band;
  ctx.fillRect(xLo, u.bbox.top, xHi - xLo, u.bbox.height);
  ctx.restore();
}

/** Vertical markers at each channel's reporter m/z; labels appear once zoomed
 *  into the reporter region (span ≤ 25 Da) to avoid clutter at full range. */
function drawReporterMarkers(u: uPlot, reporters: ReporterMarker[] | undefined) {
  if (!reporters || reporters.length === 0) return;
  const xmin = u.scales.x.min;
  const xmax = u.scales.x.max;
  if (xmin == null || xmax == null) return;
  const span = xmax - xmin;
  const { ctx } = u;
  const top = u.bbox.top;
  const bottom = top + u.bbox.height;
  ctx.save();
  for (const r of reporters) {
    if (r.mz < xmin || r.mz > xmax) continue;
    const x = u.valToPos(r.mz, "x", true);
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.globalAlpha = r.matched ? 0.55 : 0.3;
    ctx.strokeStyle = r.matched ? STAGE.marker : STAGE.axis;
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    if (span <= 25) {
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.font = "10px IBM Plex Mono, monospace";
      ctx.fillStyle = r.matched ? STAGE.marker : STAGE.axis;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(r.label, x, top + 2);
    }
  }
  ctx.restore();
}

function drawPeakLabels(u: uPlot, s: SpectrumArrays | null) {
  if (!s || s.mz.length === 0) return;
  const xmin = u.scales.x.min;
  const xmax = u.scales.x.max;
  if (xmin == null || xmax == null) return;
  const idxs = topPeakIndices(s, xmin, xmax, MAX_LABELS);
  const { ctx } = u;
  ctx.save();
  ctx.font = "11px IBM Plex Mono, monospace";
  ctx.fillStyle = STAGE.label;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const placed: number[] = [];
  for (const i of idxs) {
    const x = u.valToPos(s.mz[i], "x", true);
    const y = u.valToPos(s.intensity[i], "y", true);
    if (placed.some((px) => Math.abs(px - x) < LABEL_GAP_PX)) continue;
    placed.push(x);
    ctx.fillText(s.mz[i].toFixed(3), x, y - 4);
  }
  ctx.restore();
}

function updateTooltip(
  u: uPlot,
  tip: HTMLDivElement | null,
  s: SpectrumArrays | null,
) {
  if (!tip) return;
  const { left, top } = u.cursor;
  if (!s || left == null || left < 0 || top == null || top < 0) {
    tip.style.display = "none";
    return;
  }
  const i = nearestPeakIndex(s, u.posToVal(left, "x"));
  if (i == null) {
    tip.style.display = "none";
    return;
  }
  tip.style.display = "block";
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
  tip.textContent = `m/z ${s.mz[i].toFixed(4)} · ${s.intensity[i].toExponential(2)}`;
}
