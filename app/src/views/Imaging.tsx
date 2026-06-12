// Imaging.tsx — the unified MSI imaging panel, harvested from mzPeakIV's ImagingPanel.
//
// One component drives all five imaging modes, selected by the store's active view:
//   overview — per-pixel TIC heatmap (store.ticColumn)
//   ion      — single-channel ion image for an m/z window (engine.renderIonImage)
//   multi    — RGB composite of up to three m/z channels (engine.renderMultiChannel)
//   optical  — embedded optical microscopy image (engine.getOpticalImage, lazy decode)
//   overlay  — ion image composited over the optical image with an opacity slider
//
// Shared across modes: a global colormap + linear/log scale, a contain-fit canvas
// with wheel zoom + pan, a hover readout (absolute 1-based IMS coords), and pixel
// pick → selectSpectrum (routes to the Spectra view). Pure raster math lives in
// ./render; this file owns the canvas, controls, and engine round-trips.

import { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import type { ImagingGridWire, IonImageStats, OpticalImageMeta } from "@mzpeak/contracts";
import { rebuildCoordMap } from "@mzpeak/core";
import { useStore } from "../store";
import { engine } from "../engine";
import {
  rasterizeImage,
  rasterizeTic,
  rasterizeMultiChannel,
  colormapGradientCss,
  formatCompact,
  type Colormap,
} from "./render";

export type ImagingMode = "overview" | "ion" | "multi" | "optical" | "overlay";

/** A decoded optical image (RGBA + native dimensions), cached per archive path. */
type DecodedOptical = { width: number; height: number; rgba: Uint8ClampedArray };

/** Map a pointer event → grid cell (0-based local), scale-safe via getBoundingClientRect. */
function toGridCoord(
  e: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): { x: number; y: number; key: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * width);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * height);
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  return { x, y, key: y * width + x };
}

function blit(ctx: CanvasRenderingContext2D, rgba: Uint8ClampedArray, w: number, h: number): void {
  const img = ctx.createImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
}

const CHANNEL_COLORS = ["#ef4444", "#22c55e", "#3b82f6"] as const; // R / G / B
const CHANNEL_LABELS = ["Red", "Green", "Blue"] as const;

export function Imaging({ mode }: { mode: ImagingMode }) {
  const grid = useStore((s) => s.grid);
  const tic = useStore((s) => s.ticColumn);
  const opticalImages = useStore((s) => s.opticalImages);
  const selectSpectrum = useStore((s) => s.selectSpectrum);

  if (!grid) {
    return (
      <div data-testid="imaging-no-grid" style={{ color: "var(--text-muted, #94a3b8)" }}>
        No imaging grid available for this file.
      </div>
    );
  }
  return (
    <ImagingInner
      mode={mode}
      grid={grid}
      tic={tic}
      opticalImages={opticalImages}
      onPickSpectrum={(idx) => void selectSpectrum(idx)}
    />
  );
}

function ImagingInner({
  mode,
  grid,
  tic,
  opticalImages,
  onPickSpectrum,
}: {
  mode: ImagingMode;
  grid: ImagingGridWire;
  tic: Float32Array | null;
  opticalImages: OpticalImageMeta[];
  onPickSpectrum: (spectrumIndex: number) => void;
}) {
  const { width, height, originX, originY, presenceMask } = grid;
  const coordMap = useMemo(() => rebuildCoordMap(grid), [grid]);

  // ── Shared display controls ───────────────────────────────────────────────
  const [colormap, setColormap] = useState<Colormap>("viridis");
  const [logScale, setLogScale] = useState(false);

  // ── Ion-image state ───────────────────────────────────────────────────────
  const [mz, setMz] = useState("");
  const [tol, setTol] = useState("0.5");
  const [ionImage, setIonImage] = useState<Float32Array | null>(null);
  const [ionStats, setIonStats] = useState<IonImageStats | null>(null);

  // ── Multi-channel (RGB) state ─────────────────────────────────────────────
  const [channels, setChannels] = useState<{ mz: string; tol: string }[]>([
    { mz: "", tol: "0.5" },
    { mz: "", tol: "0.5" },
    { mz: "", tol: "0.5" },
  ]);
  const [multi, setMulti] = useState<(Float32Array | null)[] | null>(null);

  // ── Optical state ─────────────────────────────────────────────────────────
  const hasOptical = opticalImages.length > 0;
  const [selectedOpticalPath, setSelectedOpticalPath] = useState<string | null>(
    opticalImages[0]?.archivePath ?? null,
  );
  const [decoded, setDecoded] = useState<Record<string, DecodedOptical>>({});
  const [opticalErr, setOpticalErr] = useState<Record<string, string>>({});
  const opticalGen = useRef(0);

  // ── Overlay opacity ───────────────────────────────────────────────────────
  const [overlayAlpha, setOverlayAlpha] = useState(0.6);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState<{ x: number; y: number; key: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // ── Subscribe to optical-decode events once ───────────────────────────────
  useEffect(() => {
    const offResult = engine.on("opticalImageResult", (ev) => {
      if (ev.gen !== opticalGen.current) return; // stale (older file / request)
      setDecoded((d) => ({
        ...d,
        [ev.archivePath]: { width: ev.width, height: ev.height, rgba: ev.rgba },
      }));
    });
    const offError = engine.on("opticalImageError", (ev) => {
      if (ev.gen !== opticalGen.current) return;
      setOpticalErr((e) => ({ ...e, [ev.archivePath]: ev.message }));
    });
    return () => {
      offResult();
      offError();
    };
  }, []);

  // Lazily request a decode when optical/overlay is active and not yet decoded.
  useEffect(() => {
    if (mode !== "optical" && mode !== "overlay") return;
    if (!selectedOpticalPath) return;
    if (decoded[selectedOpticalPath] || opticalErr[selectedOpticalPath]) return;
    engine.getOpticalImage(selectedOpticalPath, opticalGen.current);
  }, [mode, selectedOpticalPath, decoded, opticalErr]);

  const mzNum = Number(mz);
  const tolNum = Number(tol);
  const ionInputsValid =
    mz !== "" && Number.isFinite(mzNum) && mzNum > 0 && Number.isFinite(tolNum) && tolNum > 0;

  async function renderIon() {
    if (!ionInputsValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await engine.renderIonImage(mzNum, tolNum);
      setIonImage(res.ionImage);
      setIonStats(res.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIonImage(null);
      setIonStats(null);
    } finally {
      setBusy(false);
    }
  }

  async function renderMulti() {
    if (busy) return;
    const reqs = channels.map((c) => {
      const m = Number(c.mz);
      const t = Number(c.tol);
      if (c.mz === "" || !Number.isFinite(m) || m <= 0 || !Number.isFinite(t) || t <= 0) return null;
      return { mz: m, tolDa: t };
    });
    if (reqs.every((r) => r === null)) {
      setError("Enter an m/z for at least one channel.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const images = await engine.renderMultiChannel(reqs);
      setMulti(images);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMulti(null);
    } finally {
      setBusy(false);
    }
  }

  // ── Canvas paint — switches on the active mode ────────────────────────────
  const decodedOptical = selectedOpticalPath ? (decoded[selectedOpticalPath] ?? null) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (mode === "overview") {
      if (!tic) return;
      canvas.width = width;
      canvas.height = height;
      blit(ctx, rasterizeTic(tic, grid, colormap, logScale), width, height);
    } else if (mode === "ion") {
      if (!ionImage) return;
      canvas.width = width;
      canvas.height = height;
      blit(ctx, rasterizeImage(ionImage, grid, { colormap, percentile: 0.99, logScale }), width, height);
    } else if (mode === "multi") {
      if (!multi) return;
      canvas.width = width;
      canvas.height = height;
      blit(ctx, rasterizeMultiChannel(multi, grid, null, false), width, height);
    } else if (mode === "optical") {
      if (!decodedOptical) return;
      canvas.width = decodedOptical.width;
      canvas.height = decodedOptical.height;
      blit(ctx, decodedOptical.rgba, decodedOptical.width, decodedOptical.height);
    } else if (mode === "overlay") {
      // Base = ion image (or TIC if no ion rendered yet) at grid resolution; then
      // the optical image is drawn on top, stretched to the grid box, at overlayAlpha.
      canvas.width = width;
      canvas.height = height;
      const base = ionImage
        ? rasterizeImage(ionImage, grid, { colormap, percentile: 0.99, logScale })
        : tic
          ? rasterizeTic(tic, grid, colormap, logScale)
          : null;
      if (base) blit(ctx, base, width, height);
      else ctx.clearRect(0, 0, width, height);
      if (decodedOptical) {
        const off = document.createElement("canvas");
        off.width = decodedOptical.width;
        off.height = decodedOptical.height;
        const octx = off.getContext("2d");
        if (octx) {
          blit(octx, decodedOptical.rgba, decodedOptical.width, decodedOptical.height);
          ctx.save();
          ctx.globalAlpha = overlayAlpha;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(off, 0, 0, width, height);
          ctx.restore();
        }
      }
    }
  }, [
    mode,
    tic,
    ionImage,
    multi,
    decodedOptical,
    overlayAlpha,
    grid,
    width,
    height,
    colormap,
    logScale,
  ]);

  // ── Contain-fit display sizing + zoom/pan ─────────────────────────────────
  // The canvas backing store is the intrinsic image size; we set an explicit CSS
  // pixel size (contain-fit × zoom) so the element box equals the visible image
  // and getBoundingClientRect hit-testing stays exact.
  const intrinsic = useMemo(() => {
    if (mode === "optical" && decodedOptical) {
      return { w: decodedOptical.width, h: decodedOptical.height };
    }
    return { w: width, h: height };
  }, [mode, decodedOptical, width, height]);

  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => setZoom(1), [mode]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ar = intrinsic.w / intrinsic.h;
    const fit = () => {
      const cs = getComputedStyle(stage);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const availW = Math.max(0, stage.clientWidth - padX);
      const availH = Math.max(0, stage.clientHeight - padY);
      if (availW <= 0 || availH <= 0) return;
      let w = availW;
      let h = w / ar;
      if (h > availH) {
        h = availH;
        w = h * ar;
      }
      setDisplaySize({ w: Math.round(w), h: Math.round(h) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [intrinsic.w, intrinsic.h]);

  const canvasSizeStyle: React.CSSProperties = displaySize
    ? { width: displaySize.w * zoom, height: displaySize.h * zoom }
    : { aspectRatio: `${intrinsic.w} / ${intrinsic.h}`, maxWidth: "100%", maxHeight: "100%" };

  // ── Pointer handlers (pixel pick + hover readout) — grid modes only ───────
  const pickable = mode !== "optical";
  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!pickable) return;
    setReadout(toGridCoord(e, e.currentTarget, width, height));
  }
  function onLeave() {
    setReadout(null);
  }
  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!pickable) return;
    const hit = toGridCoord(e, e.currentTarget, width, height);
    if (!hit || presenceMask[hit.key] === 0) return;
    const idx = coordMap.get(hit.key);
    if (idx != null) onPickSpectrum(idx);
  }

  const readoutText = useMemo(() => {
    if (!readout) return "";
    const xy = `x: ${readout.x + originX}, y: ${readout.y + originY}`;
    if (presenceMask[readout.key] === 0) return `${xy} — no data`;
    if (mode === "ion" && ionImage) return `${xy} · intensity: ${formatCompact(ionImage[readout.key] ?? 0)}`;
    if (mode === "overview" && tic) return `${xy} · TIC: ${formatCompact(tic[readout.key] ?? 0)}`;
    return xy;
  }, [readout, mode, ionImage, tic, presenceMask, originX, originY]);

  // Whether the canvas has something to show in the current mode.
  const hasContent =
    (mode === "overview" && !!tic) ||
    (mode === "ion" && !!ionImage) ||
    (mode === "multi" && !!multi) ||
    (mode === "optical" && !!decodedOptical) ||
    (mode === "overlay" && (!!ionImage || !!tic || !!decodedOptical));

  const showColormapControls = mode === "overview" || mode === "ion" || mode === "overlay";

  return (
    <section aria-label={`Imaging — ${mode}`} data-testid={`imaging-${mode}`} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", height: "100%", minHeight: 0 }}>
      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        {mode === "ion" && (
          <>
            <Field label="m/z">
              <input type="text" inputMode="decimal" value={mz} aria-label="m/z" placeholder="e.g. 798.54"
                onChange={(e) => setMz(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void renderIon(); }}
                style={inputStyle(100)} />
            </Field>
            <Field label="tolerance (Da)">
              <input type="text" inputMode="decimal" value={tol} aria-label="tolerance in Da"
                onChange={(e) => setTol(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void renderIon(); }}
                style={inputStyle(90)} />
            </Field>
            <button type="button" onClick={() => void renderIon()} disabled={!ionInputsValid || busy} style={btnStyle}>
              {busy ? "Rendering…" : "Render"}
            </button>
          </>
        )}

        {mode === "multi" && (
          <>
            {channels.map((c, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", color: "var(--text-muted, #94a3b8)" }}>
                  <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: CHANNEL_COLORS[i] }} />
                  {CHANNEL_LABELS[i]}
                </span>
                <div style={{ display: "flex", gap: "0.3rem" }}>
                  <input type="text" inputMode="decimal" value={c.mz} aria-label={`${CHANNEL_LABELS[i]} m/z`} placeholder="m/z"
                    onChange={(e) => setChannels((ch) => ch.map((x, j) => (j === i ? { ...x, mz: e.target.value } : x)))}
                    onKeyDown={(e) => { if (e.key === "Enter") void renderMulti(); }} style={inputStyle(80)} />
                  <input type="text" inputMode="decimal" value={c.tol} aria-label={`${CHANNEL_LABELS[i]} tolerance`} placeholder="Da"
                    onChange={(e) => setChannels((ch) => ch.map((x, j) => (j === i ? { ...x, tol: e.target.value } : x)))}
                    onKeyDown={(e) => { if (e.key === "Enter") void renderMulti(); }} style={inputStyle(56)} />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => void renderMulti()} disabled={busy} style={btnStyle}>
              {busy ? "Rendering…" : "Render RGB"}
            </button>
          </>
        )}

        {(mode === "optical" || mode === "overlay") && hasOptical && (
          <Field label="Optical image">
            <select value={selectedOpticalPath ?? ""} aria-label="optical image"
              onChange={(e) => setSelectedOpticalPath(e.target.value || null)} style={inputStyle(220)}>
              {opticalImages.map((im) => (
                <option key={im.archivePath} value={im.archivePath}>
                  {im.name ?? im.archivePath.split("/").pop() ?? im.archivePath}
                </option>
              ))}
            </select>
          </Field>
        )}

        {mode === "overlay" && (
          <Field label={`Optical opacity (${Math.round(overlayAlpha * 100)}%)`}>
            <input type="range" min={0} max={1} step={0.05} value={overlayAlpha} aria-label="optical opacity"
              onChange={(e) => setOverlayAlpha(Number(e.target.value))} style={{ width: 140 }} />
          </Field>
        )}

        {/* Colormap + scale (single-channel modes) */}
        {showColormapControls && (
          <>
            <Field label="Colormap">
              <select value={colormap} aria-label="colormap" onChange={(e) => setColormap(e.target.value as Colormap)} style={inputStyle(110)}>
                <option value="viridis">Viridis</option>
                <option value="inferno">Inferno</option>
                <option value="gray">Gray</option>
              </select>
            </Field>
            <Field label="Scale">
              <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.85rem", height: 30 }}>
                <input type="checkbox" checked={logScale} aria-label="log scale" onChange={(e) => setLogScale(e.target.checked)} />
                log
              </label>
            </Field>
          </>
        )}

        {/* Zoom controls */}
        <div style={{ display: "flex", gap: "0.25rem", marginLeft: "auto" }}>
          <button type="button" aria-label="zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.3))} style={zoomBtn}>−</button>
          <button type="button" aria-label="reset zoom" onClick={() => setZoom(1)} style={zoomBtn}>{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label="zoom in" onClick={() => setZoom((z) => Math.min(8, z * 1.3))} style={zoomBtn}>+</button>
        </div>
      </div>

      {error && (
        <p data-testid="imaging-error" style={{ color: "var(--danger, #c00)", fontSize: "0.85rem", margin: 0 }}>{error}</p>
      )}

      {/* ── Stage + legend ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "1rem", flex: 1, minHeight: 0 }}>
        <div
          ref={stageRef}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 240,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "auto",
            background: "var(--ink, #0e1216)",
            borderRadius: 8,
            padding: "0.75rem",
          }}
        >
          {hasContent ? (
            <canvas
              ref={canvasRef}
              onMouseMove={onMove}
              onMouseLeave={onLeave}
              onClick={onClick}
              data-testid="imaging-canvas"
              aria-label={`${mode} image. ${pickable ? "Click a pixel to inspect its spectrum." : ""}`}
              style={{
                ...canvasSizeStyle,
                imageRendering: "pixelated",
                cursor: pickable ? "crosshair" : "default",
                userSelect: "none",
                display: "block",
              }}
            />
          ) : (
            <EmptyState mode={mode} hasOptical={hasOptical} opticalErr={selectedOpticalPath ? opticalErr[selectedOpticalPath] : undefined} />
          )}
        </div>

        {/* Legend for single-channel modes */}
        {showColormapControls && hasContent && (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted, #94a3b8)", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div aria-hidden style={{ width: 18, height: 200, background: colormapGradientCss(colormap, "0deg"), borderRadius: 2, border: "1px solid var(--border, #334155)" }} />
            {mode === "ion" && ionStats && (
              <div style={{ marginTop: "0.35rem", textAlign: "center" }}>
                <div data-testid="ion-image-max">max {formatCompact(ionStats.max)}</div>
                <div>min {formatCompact(ionStats.min)}</div>
                <div style={{ marginTop: "0.25rem" }}>{ionStats.nonzeroCount} px</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Hover / pick readout ─────────────────────────────────────────── */}
      {pickable && (
        <p data-testid="imaging-readout" style={{ minHeight: "1.2em", fontSize: "0.8rem", color: "var(--text-muted, #94a3b8)", margin: 0 }}>
          {readoutText}
        </p>
      )}
    </section>
  );
}

function EmptyState({ mode, hasOptical, opticalErr }: { mode: ImagingMode; hasOptical: boolean; opticalErr?: string }) {
  let msg: string;
  if (mode === "optical" || mode === "overlay") {
    if (!hasOptical) msg = "This file has no embedded optical image.";
    else if (opticalErr) msg = `Optical decode failed: ${opticalErr}`;
    else msg = "Decoding optical image…";
  } else if (mode === "ion") {
    msg = "Enter an m/z and tolerance, then Render to see the ion image.";
  } else if (mode === "multi") {
    msg = "Enter an m/z for one or more R/G/B channels, then Render RGB.";
  } else {
    msg = "No data to display.";
  }
  return (
    <p data-testid="imaging-empty" style={{ color: "var(--text-muted, #94a3b8)", fontSize: "0.85rem", textAlign: "center", maxWidth: 360 }}>
      {msg}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.75rem", color: "var(--text-muted, #94a3b8)" }}>
      {label}
      {children}
    </label>
  );
}

function inputStyle(width: number): React.CSSProperties {
  return {
    width,
    height: 30,
    padding: "0 0.45rem",
    border: "1px solid var(--border-default, #cbd5e1)",
    borderRadius: 6,
    fontSize: "0.85rem",
    background: "var(--surface-card, #fff)",
  };
}

const btnStyle: React.CSSProperties = {
  height: 30,
  padding: "0 0.9rem",
  border: "1px solid var(--blue-600, #3b54da)",
  borderRadius: 6,
  background: "var(--blue-600, #3b54da)",
  color: "#fff",
  fontSize: "0.85rem",
  fontWeight: 500,
  cursor: "pointer",
};

const zoomBtn: React.CSSProperties = {
  minWidth: 30,
  height: 30,
  padding: "0 0.4rem",
  border: "1px solid var(--border-default, #cbd5e1)",
  borderRadius: 6,
  background: "var(--surface-card, #fff)",
  color: "var(--text-secondary, #475569)",
  fontSize: "0.8rem",
  cursor: "pointer",
};
