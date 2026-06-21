import { useEffect, useMemo, useRef } from "react";
import { viridis } from "./colormap";
import { niceTicks, fmtTick } from "./axisTicks";

/**
 * 2-D ion-mobility frame heatmap: m/z (x) × inverse reduced ion mobility 1/K0 (y), cell
 * intensity through viridis (log-scaled). A timsTOF frame is a point cloud of (m/z, 1/K0,
 * intensity) — often >10⁵ peaks — so we BIN into a fixed grid and paint it in one
 * `ImageData`/`drawImage` pass (never per-point strokes). Contract-free: takes plain typed
 * arrays so ui-kit stays decoupled from the wire `MobilityCodec`.
 *
 * Inputs are aligned per-peak: `mz[i]`, `intensity[i]`, and `mobilityIndex[i]` (a bin index
 * into the ascending `mobilityValues` lookup — the compact mobility encoding).
 */
export function MobilityFrameHeatmap({
  mz,
  intensity,
  mobilityValues,
  mobilityIndex,
  height = HEIGHT,
}: {
  mz: Float64Array;
  intensity: Float32Array;
  mobilityValues: Float64Array;
  mobilityIndex: Uint16Array | Uint32Array;
  /** Host height in CSS px. @default 320 */
  height?: number;
}) {
  // Bin once per frame (memoized by the array identities) — resize redraws reuse the grid.
  const frame = useMemo(
    () => buildGrid(mz, intensity, mobilityValues, mobilityIndex),
    [mz, intensity, mobilityValues, mobilityIndex],
  );
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    if (!host || !canvas) return;
    const draw = () => paint(canvas, host, frameRef.current);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(host);
    return () => ro.disconnect();
  }, [frame]);

  return (
    <div ref={hostRef} className="heatmap-host" data-testid="mobility-frame-heatmap" style={{ position: "relative", width: "100%", height }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }} />
      {!frame && <div style={EMPTY_STYLE}>No mobility data</div>}
    </div>
  );
}

const HEIGHT = 320;
// Grid resolution (binning target). The drawn plot is nearest-neighbour scaled to fit.
const GW = 512; // m/z columns
const GH_MAX = 512; // mobility rows (capped; ~hundreds of TIMS scans get downsampled to fit)

type Grid = {
  gw: number; gh: number;
  grid: Float32Array; // gh rows × gw cols, row 0 = LOWEST 1/K0
  mzMin: number; mzMax: number;
  mobMin: number; mobMax: number;
  vmax: number; // peak cell intensity (for the log colour scale)
};

/** Accumulate per-peak intensity into an (m/z × mobility-bin) grid. O(N) over the peaks. */
function buildGrid(
  mz: Float64Array,
  intensity: Float32Array,
  mobValues: Float64Array,
  mobIndex: Uint16Array | Uint32Array,
): Grid | null {
  const n = Math.min(mz.length, intensity.length, mobIndex.length);
  const nBins = mobValues.length;
  if (n === 0 || nBins === 0) return null;

  let mzMin = Infinity, mzMax = -Infinity;
  for (let i = 0; i < n; i++) { const v = mz[i]!; if (v < mzMin) mzMin = v; if (v > mzMax) mzMax = v; }
  if (!(mzMax > mzMin)) mzMax = mzMin + 1; // single-m/z guard

  const gh = Math.min(nBins, GH_MAX);
  const gw = GW;
  const grid = new Float32Array(gw * gh);
  const mzSpan = mzMax - mzMin;
  let vmax = 0;
  for (let i = 0; i < n; i++) {
    const col = Math.min(gw - 1, Math.max(0, ((mz[i]! - mzMin) / mzSpan * (gw - 1)) | 0));
    const row = nBins === gh ? mobIndex[i]! : Math.min(gh - 1, (mobIndex[i]! * gh / nBins) | 0);
    const cell = row * gw + col;
    const acc = grid[cell]! + intensity[i]!;
    grid[cell] = acc;
    if (acc > vmax) vmax = acc;
  }
  return { gw, gh, grid, mzMin, mzMax, mobMin: mobValues[0]!, mobMax: mobValues[nBins - 1]!, vmax };
}

const EMPTY_STYLE: React.CSSProperties = {
  position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
  color: "var(--text-muted)", font: "12px var(--font-sans, sans-serif)", pointerEvents: "none",
};
const PAD = { left: 60, right: 64, top: 10, bottom: 34 } as const;
const COLORBAR_W = 12, COLORBAR_GAP = 8;

function plotRect(cssW: number, cssH: number) {
  return { x: PAD.left, y: PAD.top, w: Math.max(0, cssW - PAD.left - PAD.right), h: Math.max(0, cssH - PAD.top - PAD.bottom) };
}
function token(el: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

function paint(canvas: HTMLCanvasElement, host: HTMLElement, f: Grid | null): void {
  const cssW = host.clientWidth, cssH = host.clientHeight;
  if (cssW <= 0 || cssH <= 0) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const colText = token(host, "--text-strong", "#353c43");
  const colMuted = token(host, "--text-muted", "#6b757e");
  const colLine = token(host, "--border-strong", "#6b757e");
  const colSoft = token(host, "--border-soft", "#e3e7eb");
  const fontMono = `10px ${token(host, "--font-mono", "IBM Plex Mono, monospace")}`;
  const fontSans = `11px ${token(host, "--font-sans", "IBM Plex Sans, sans-serif")}`;

  const plot = plotRect(cssW, cssH);
  if (!f || plot.w <= 0 || plot.h <= 0) return;

  // Heatmap layer: gw×gh ImageData, log-scaled intensity → viridis. Row 0 = lowest 1/K0,
  // so flip vertically (image row 0 is the TOP) to put low mobility at the bottom.
  const { gw, gh, grid, vmax } = f;
  const denom = vmax > 0 ? Math.log1p(vmax) : 1;
  const img = ctx.createImageData(gw, gh);
  const data = img.data;
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const v = grid[r * gw + c]!;
      const norm = v > 0 ? Math.min(Math.log1p(v) / denom, 1) : 0;
      const rgb = viridis(norm);
      const px = ((gh - 1 - r) * gw + c) * 4; // flip: low 1/K0 → bottom
      data[px] = rgb[0]; data[px + 1] = rgb[1]; data[px + 2] = rgb[2]; data[px + 3] = 255;
    }
  }
  const off = document.createElement("canvas");
  off.width = gw; off.height = gh;
  const offCtx = off.getContext("2d");
  if (!offCtx) return;
  offCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, gw, gh, plot.x, plot.y, plot.w, plot.h);

  ctx.strokeStyle = colSoft; ctx.lineWidth = 1;
  ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1);

  // Axes
  ctx.fillStyle = colMuted; ctx.strokeStyle = colLine; ctx.font = fontMono;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (const tv of niceTicks(f.mzMin, f.mzMax, 6)) {
    const x = plot.x + (tv - f.mzMin) / (f.mzMax - f.mzMin || 1) * plot.w;
    ctx.beginPath(); ctx.moveTo(x, plot.y + plot.h); ctx.lineTo(x, plot.y + plot.h + 4); ctx.stroke();
    ctx.fillText(fmtTick(tv, 3), x, plot.y + plot.h + 6);
  }
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const mv of niceTicks(f.mobMin, f.mobMax, 5)) {
    const fy = (mv - f.mobMin) / (f.mobMax - f.mobMin || 1);
    const y = plot.y + (1 - fy) * plot.h; // low 1/K0 at bottom
    ctx.beginPath(); ctx.moveTo(plot.x - 4, y); ctx.lineTo(plot.x, y); ctx.stroke();
    ctx.fillText(fmtTick(mv, 3), plot.x - 6, y);
  }

  ctx.fillStyle = colText; ctx.font = fontSans;
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("m/z", plot.x + plot.w / 2, cssH - 2);
  ctx.save();
  ctx.translate(11, plot.y + plot.h / 2); ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top"; ctx.fillText("1/K0 (Vs/cm²)", 0, 0);
  ctx.restore();

  // Colorbar (0 → max intensity, log)
  const cbX = plot.x + plot.w + COLORBAR_GAP, cbY = plot.y, cbH = plot.h;
  const barImg = ctx.createImageData(1, 256);
  for (let i = 0; i < 256; i++) {
    const rgb = viridis(1 - i / 255);
    const px = i * 4; barImg.data[px] = rgb[0]; barImg.data[px + 1] = rgb[1]; barImg.data[px + 2] = rgb[2]; barImg.data[px + 3] = 255;
  }
  const barOff = document.createElement("canvas");
  barOff.width = 1; barOff.height = 256;
  const barCtx = barOff.getContext("2d");
  if (barCtx) {
    barCtx.putImageData(barImg, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(barOff, 0, 0, 1, 256, cbX, cbY, COLORBAR_W, cbH);
  }
  ctx.strokeStyle = colSoft; ctx.strokeRect(cbX + 0.5, cbY + 0.5, COLORBAR_W - 1, cbH - 1);
  ctx.fillStyle = colMuted; ctx.font = fontMono;
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText(fmtTick(vmax, 3), cbX + COLORBAR_W + 4, cbY);
  ctx.textBaseline = "bottom"; ctx.fillText("0", cbX + COLORBAR_W + 4, cbY + cbH);
  ctx.fillStyle = colText; ctx.font = fontSans;
  ctx.save();
  ctx.translate(cssW - 2, cbY + cbH / 2); ctx.rotate(Math.PI / 2);
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("intensity (log)", 0, 0);
  ctx.restore();
}
