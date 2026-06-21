import { useEffect, useRef } from "react";
import type { WavelengthMatrix } from "@mzpeak/contracts";
import { viridis } from "./colormap";
import { niceTicks, fmtTick } from "./axisTicks";

/**
 * 2D PDA/DAD heatmap: retention time (x) × wavelength (y), cell intensity mapped
 * through viridis. Rendered on a raw `<canvas>` (NOT uPlot) so a large T×W cube
 * paints in one `ImageData`/`drawImage` pass instead of per-cell strokes.
 *
 * Pipeline: build a width×height `ImageData` from a 256-entry viridis LUT (one
 * pixel per matrix cell, NaN → transparent), blit it onto a small offscreen
 * canvas, then `drawImage`-scale that (nearest-neighbour, `imageSmoothingEnabled
 * = false`) into the devicePixelRatio-aware visible canvas plot area. Axes, tick
 * labels and a vertical colorbar are drawn with the project's CSS-variable
 * tokens resolved to concrete colors (canvas can't consume `var(...)`).
 *
 * Clicking the plot maps x → the nearest `matrix.time` value and calls
 * `onPickTime(thatTimeSec)`.
 */
export function WavelengthHeatmap({
  matrix,
  onPickTime,
}: {
  matrix: WavelengthMatrix | null;
  onPickTime?: (timeSec: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const matrixRef = useRef<WavelengthMatrix | null>(matrix);
  matrixRef.current = matrix;
  const onPickRef = useRef(onPickTime);
  onPickRef.current = onPickTime;

  // Redraw on data change and on resize (ResizeObserver). The draw reads the
  // latest matrix from the ref so the observer callback never goes stale.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const draw = () => paint(canvas, host, matrixRef.current);
    draw();

    const ro = new ResizeObserver(draw);
    ro.observe(host);
    return () => ro.disconnect();
  }, [matrix]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = matrixRef.current;
    const cb = onPickRef.current;
    const canvas = canvasRef.current;
    if (!m || !cb || !canvas || m.width === 0 || m.height === 0) return;
    const rect = canvas.getBoundingClientRect();
    const xCss = e.clientX - rect.left;
    const plot = plotRect(rect.width, rect.height);
    if (xCss < plot.x || xCss > plot.x + plot.w) return;
    // Fraction across the plot → fractional column → nearest time row.
    const frac = (xCss - plot.x) / plot.w;
    const col = Math.min(m.height - 1, Math.max(0, Math.round(frac * (m.height - 1))));
    const t = m.time[col];
    if (t != null && Number.isFinite(t)) cb(t);
  };

  const empty = !matrix || matrix.width === 0 || matrix.height === 0;

  return (
    <div ref={hostRef} className="heatmap-host" style={HOST_STYLE}>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
      />
      {empty && (
        <div style={EMPTY_STYLE}>No data</div>
      )}
    </div>
  );
}

const HEIGHT = 280;

const HOST_STYLE: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: HEIGHT,
};

const EMPTY_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-muted)",
  font: "12px var(--font-sans, sans-serif)",
  pointerEvents: "none",
};

// Plot-area insets (CSS px): room for the y-axis labels (left), x-axis labels
// (bottom), the colorbar + its labels (right) and a little top padding.
const PAD = { left: 56, right: 64, top: 10, bottom: 34 } as const;
const COLORBAR_W = 12;
const COLORBAR_GAP = 8;

function plotRect(cssW: number, cssH: number) {
  return {
    x: PAD.left,
    y: PAD.top,
    w: Math.max(0, cssW - PAD.left - PAD.right),
    h: Math.max(0, cssH - PAD.top - PAD.bottom),
  };
}

/** Resolve a CSS custom property on the host element to a concrete color. */
function token(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

function paint(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  m: WavelengthMatrix | null,
): void {
  const cssW = host.clientWidth;
  const cssH = host.clientHeight;
  if (cssW <= 0 || cssH <= 0) return;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Work in CSS px; the DPR scale makes everything crisp.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const colText = token(host, "--text-strong", "#353c43");
  const colMuted = token(host, "--text-muted", "#6b757e");
  const colLine = token(host, "--border-strong", "#6b757e");
  const colSoft = token(host, "--border-soft", "#e3e7eb");
  const fontMono = `10px ${token(host, "--font-mono", "IBM Plex Mono, monospace")}`;
  const fontSans = `11px ${token(host, "--font-sans", "IBM Plex Sans, sans-serif")}`;

  const plot = plotRect(cssW, cssH);
  if (!m || m.width === 0 || m.height === 0 || plot.w <= 0 || plot.h <= 0) return;

  // --- Heatmap layer: width×height ImageData, one pixel per cell. ---
  // X = time (m.height rows), Y = wavelength (m.width cols). The image is laid
  // out as [imgW = m.height columns] × [imgH = m.width rows] so that drawImage
  // maps image-x → time and image-y → wavelength directly. Wavelength ascends
  // upward on screen, so row 0 of the image is the HIGHEST wavelength.
  const imgW = m.height; // time columns
  const imgH = m.width; // wavelength rows
  const img = ctx.createImageData(imgW, imgH);
  const data = img.data;
  const { intensity, width: W, min, max } = m;
  const span = max > min ? max - min : 1;

  for (let t = 0; t < m.height; t++) {
    for (let w = 0; w < W; w++) {
      const v = intensity[t * W + w];
      // Image pixel: x = time index t, y = flipped wavelength (high λ on top).
      const px = ((W - 1 - w) * imgW + t) * 4;
      if (v == null || !Number.isFinite(v)) {
        data[px + 3] = 0; // transparent NaN cell
        continue;
      }
      const f = (v - min) / span;
      const rgb = viridis(f);
      data[px] = rgb[0];
      data[px + 1] = rgb[1];
      data[px + 2] = rgb[2];
      data[px + 3] = 255;
    }
  }

  // Blit to an offscreen canvas, then nearest-neighbour scale into the plot area.
  const off = document.createElement("canvas");
  off.width = imgW;
  off.height = imgH;
  const offCtx = off.getContext("2d");
  if (!offCtx) return;
  offCtx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, imgW, imgH, plot.x, plot.y, plot.w, plot.h);

  // Plot border.
  ctx.strokeStyle = colSoft;
  ctx.lineWidth = 1;
  ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1);

  // --- Axes ---
  ctx.fillStyle = colMuted;
  ctx.strokeStyle = colLine;
  ctx.font = fontMono;

  // X axis: retention time (s).
  const tExtent = finite2(m.time);
  if (tExtent) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ticks = niceTicks(tExtent[0], tExtent[1], 6);
    for (const tv of ticks) {
      const fx = (tv - tExtent[0]) / (tExtent[1] - tExtent[0] || 1);
      const x = plot.x + fx * plot.w;
      ctx.beginPath();
      ctx.moveTo(x, plot.y + plot.h);
      ctx.lineTo(x, plot.y + plot.h + 4);
      ctx.stroke();
      ctx.fillText(fmtTick(tv), x, plot.y + plot.h + 6);
    }
  }

  // Y axis: wavelength (nm). High λ on top (matches the flipped image).
  const wExtent = finite2(m.wavelength);
  if (wExtent) {
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const ticks = niceTicks(wExtent[0], wExtent[1], 5);
    for (const wv of ticks) {
      const fy = (wv - wExtent[0]) / (wExtent[1] - wExtent[0] || 1);
      const y = plot.y + (1 - fy) * plot.h; // 1-fy → high λ at top
      ctx.beginPath();
      ctx.moveTo(plot.x - 4, y);
      ctx.lineTo(plot.x, y);
      ctx.stroke();
      ctx.fillText(fmtTick(wv), plot.x - 6, y);
    }
  }

  // Axis labels.
  ctx.fillStyle = colText;
  ctx.font = fontSans;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("retention time (s)", plot.x + plot.w / 2, cssH - 2);
  ctx.save();
  ctx.translate(10, plot.y + plot.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText("wavelength (nm)", 0, 0);
  ctx.restore();

  // --- Colorbar (min → max), vertical, to the right of the plot. ---
  const cbX = plot.x + plot.w + COLORBAR_GAP;
  const cbY = plot.y;
  const cbH = plot.h;
  const barImg = ctx.createImageData(1, 256);
  for (let i = 0; i < 256; i++) {
    // Row 0 = top = max; row 255 = bottom = min.
    const rgb = viridis(1 - i / 255);
    const px = i * 4;
    barImg.data[px] = rgb[0];
    barImg.data[px + 1] = rgb[1];
    barImg.data[px + 2] = rgb[2];
    barImg.data[px + 3] = 255;
  }
  const barOff = document.createElement("canvas");
  barOff.width = 1;
  barOff.height = 256;
  const barCtx = barOff.getContext("2d");
  if (barCtx) {
    barCtx.putImageData(barImg, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(barOff, 0, 0, 1, 256, cbX, cbY, COLORBAR_W, cbH);
  }
  ctx.strokeStyle = colSoft;
  ctx.strokeRect(cbX + 0.5, cbY + 0.5, COLORBAR_W - 1, cbH - 1);

  // Colorbar min/max labels + unit.
  ctx.fillStyle = colMuted;
  ctx.font = fontMono;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(fmtTick(max), cbX + COLORBAR_W + 4, cbY);
  ctx.textBaseline = "bottom";
  ctx.fillText(fmtTick(min), cbX + COLORBAR_W + 4, cbY + cbH);
  if (m.intensityUnit) {
    ctx.fillStyle = colText;
    ctx.font = fontSans;
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.translate(cssW - 2, cbY + cbH / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(m.intensityUnit, 0, 0);
    ctx.restore();
  }
}

/** Finite [min, max] over a typed array, or null when none are finite. */
function finite2(xs: Float32Array): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i]!;
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo <= hi ? [lo, hi] : null;
}
