import { useEffect, useRef } from "react";
import uPlot from "uplot";
// uPlot's base CSS ships via @mzpeak/ui-kit/styles.css (not a JS side-effect import,
// so importing a primitive from the package root doesn't pull plot CSS — codex Phase-2 #8).
import type { SpectrumArrays } from "./peaks";
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
    xs[j] = s.mz[i]!;
    xs[j + 1] = s.mz[i]!;
    xs[j + 2] = s.mz[i]!;
    ys[j + 1] = s.intensity[i]!;
  }
  return [xs, ys];
}

export type ReporterMarker = {
  /** Expected reporter m/z (vertical guide). */
  mz: number;
  label: string;
  matched: boolean;
  /** Per-channel color (shared with the channel pills). */
  color?: string;
  /** Matched peak position (m/z, intensity) for the dot, when matched. */
  peakMz?: number | null;
  peakInt?: number | null;
  /** Emphasized channel (clicked pill): bigger dot + ring + always-on label. */
  active?: boolean;
};

export function SpectrumPlot({
  spectrum,
  xicWindow,
  reporters,
  zoom,
  onZoomChange,
  onPeakClick,
  onPeakContextMenu,
}: {
  spectrum: SpectrumArrays | null;
  xicWindow: { mz: number; tolDa: number } | null;
  reporters?: ReporterMarker[];
  /** Desired m/z view [lo, hi] (null = full); applied imperatively for Share view. */
  zoom?: [number, number] | null;
  /** Reports the live m/z view to the store (null at full range). */
  onZoomChange?: (range: [number, number] | null) => void;
  /** Optional: a click in the plot resolves the nearest peak m/z and reports it
   *  (used to prefill the ion image). Non-breaking — omitted by other callers. */
  onPeakClick?: (mz: number) => void;
  /** Optional: a RIGHT-click resolves the nearest peak m/z + reports it with the cursor
   *  position (the Spectra view opens a "create chromatogram" popover there). */
  onPeakContextMenu?: (mz: number, clientX: number, clientY: number) => void;
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
  const onPeakCtxRef = useRef(onPeakContextMenu);
  onPeakCtxRef.current = onPeakContextMenu;
  const onPeakClickRef = useRef(onPeakClick);
  onPeakClickRef.current = onPeakClick;
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
      // Peak click → report the nearest peak's m/z (ref keeps the callback fresh,
      // matching the onZoomRef pattern). Snaps to the nearest x-point via
      // nearestPeakIndex — for centroid that's the stick, for profile the nearest
      // sample. A box-zoom drag also ends in a click, so we ignore clicks that
      // moved more than a few px from where the press started.
      let downX = 0;
      let downY = 0;
      plot.over.addEventListener("mousedown", (e) => {
        downX = e.clientX;
        downY = e.clientY;
      });
      plot.over.addEventListener("click", (e) => {
        const cb = onPeakClickRef.current;
        const s = specRef.current;
        if (!cb || !s) return;
        if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
        const left = plot.cursor.left;
        if (left == null || left < 0) return;
        const i = nearestPeakIndex(s, plot.posToVal(left, "x"));
        if (i == null) return;
        cb(s.mz[i]!);
      });
      // Right-click → resolve the nearest peak m/z + report with the cursor position.
      plot.over.addEventListener("contextmenu", (e) => {
        const cb = onPeakCtxRef.current;
        const s = specRef.current;
        if (!cb || !s) return;
        e.preventDefault();
        // Resolve from the actual click position, not plot.cursor.left — the latter is the
        // last hover and can be stale/absent on a right-click without a prior mousemove (review).
        const x = plot.posToVal((e as MouseEvent).offsetX, "x");
        if (!Number.isFinite(x)) return;
        const i = nearestPeakIndex(s, x);
        if (i == null) return;
        cb(s.mz[i]!, e.clientX, e.clientY);
      });
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
      u.scales.x!.min != null && u.scales.x!.max != null ? [u.scales.x!.min, u.scales.x!.max] : null;
    if (sameRange(cur, zoom)) return;
    u.setScale("x", { min: zoom[0], max: zoom[1] });
  }, [zoom, spectrum]);

  // Redraw the reporter overlay when the highlighted channel changes (so selecting a
  // different pill at the same zoom re-emphasizes the right peak).
  const activeSig = (reporters ?? []).map((r) => (r.active ? `${r.mz}` : "")).join("|");
  useEffect(() => {
    // Redraw the overlay only (no path/axis recalc) so the highlight refreshes without
    // re-ranging the x-scale and clobbering a channel-zoom set in the same commit.
    plotRef.current?.redraw(false, false);
  }, [activeSig]);

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
    const min = u.scales.x!.min;
    const max = u.scales.x!.max;
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
  const xmin = u.scales.x!.min;
  const xmax = u.scales.x!.max;
  if (xmin == null || xmax == null) return;
  const span = xmax - xmin;
  const { ctx } = u;
  const top = u.bbox.top;
  const bottom = top + u.bbox.height;
  ctx.save();
  for (const r of reporters) {
    if (r.mz < xmin || r.mz > xmax) continue;
    const color = r.color ?? (r.matched ? STAGE.marker : STAGE.axis);
    const x = u.valToPos(r.mz, "x", true);
    // Guide at the expected reporter m/z — solid + bold for the highlighted channel.
    ctx.beginPath();
    ctx.setLineDash(r.active ? [] : [3, 3]);
    ctx.globalAlpha = r.active ? 0.85 : r.matched ? 0.5 : 0.25;
    ctx.strokeStyle = color;
    ctx.lineWidth = r.active ? 1.5 : 1;
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    // Dot on the matched reporter peak (at its m/z + intensity); enlarged + ringed when active.
    if (r.matched && r.peakMz != null && r.peakInt != null) {
      const px = u.valToPos(r.peakMz, "x", true);
      const py = u.valToPos(r.peakInt, "y", true);
      ctx.globalAlpha = 1;
      if (r.active) {
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, r.active ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = STAGE.pointFill ?? "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Channel label: when zoomed into the reporter region (≤25 Da), or always for the
    // highlighted channel.
    if (span <= 25 || r.active) {
      ctx.globalAlpha = 1;
      ctx.font = `${r.active ? "bold " : ""}10px IBM Plex Mono, monospace`;
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(r.label, x, top + 2);
    }
  }
  ctx.restore();
}

function drawPeakLabels(u: uPlot, s: SpectrumArrays | null) {
  if (!s || s.mz.length === 0) return;
  const xmin = u.scales.x!.min;
  const xmax = u.scales.x!.max;
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
    const x = u.valToPos(s.mz[i]!, "x", true);
    const y = u.valToPos(s.intensity[i]!, "y", true);
    if (placed.some((px) => Math.abs(px - x) < LABEL_GAP_PX)) continue;
    placed.push(x);
    ctx.fillText(s.mz[i]!.toFixed(3), x, y - 4);
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
  tip.textContent = `m/z ${s.mz[i]!.toFixed(4)} · ${s.intensity[i]!.toExponential(2)}`;
}
