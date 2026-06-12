// IonImage.tsx — a self-contained ion-image Canvas view.
//
// Given an imaging grid and a `renderIonImage(mz, tolDa)` callback, this component
// lets the user pick an m/z window, renders the spatial ion image to a <canvas>
// sized grid.width × grid.height (scaled up with crisp nearest-neighbor), and maps
// a click back to the spectrum behind that pixel via the grid's coord→spectrum map.
//
// Deliberately PROP-driven (no store, no engine import) so it composes cleanly into
// the MSI accordion and is trivially testable. The only @mzpeak imports are the wire
// type, the stats type, and the pure `rebuildCoordMap` adapter.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ImagingGridWire, IonImageStats } from "@mzpeak/contracts";
import { rebuildCoordMap } from "@mzpeak/core";
import { paintIonImage, viridisGradientCss } from "./colormap";

export type IonImageViewProps = {
  /** The reconstructed imaging grid (width/height/origin + coord→spectrum lookup). */
  grid: ImagingGridWire;
  /** Render a single-channel ion image for an m/z window (engine round-trip). */
  renderIonImage: (
    mz: number,
    tolDa: number,
  ) => Promise<{ ionImage: Float32Array | null; stats: IonImageStats | null }>;
  /** Called with the spectrum index behind a clicked, present pixel. */
  onPickSpectrum: (spectrumIndex: number) => void;
};

/** Pointer hit-test result: a grid cell (0-based local) + its coord key. */
type Hit = { x: number; y: number; key: number };

/**
 * Map a pointer event → grid cell, scale-safe. Uses `getBoundingClientRect` (the
 * canvas element box equals the displayed image, so this works under CSS upscaling).
 * coordKey = y*width + x — the SAME encoding the wire's coordKey documents (no flip).
 */
function toGridCoord(
  e: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): Hit | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * width);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * height);
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  return { x, y, key: y * width + x };
}

/** Compact intensity formatting for the readout (e.g. `1.4e6`, `0`, `230`). */
function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-3) return v.toExponential(1);
  return Number(v.toPrecision(4)).toLocaleString();
}

export function IonImageView({
  grid,
  renderIonImage,
  onPickSpectrum,
}: IonImageViewProps) {
  const { width, height, originX, originY, presenceMask } = grid;

  // Coord→spectrum lookup, rebuilt from the wire's parallel arrays. Memoized on the
  // grid identity so a re-render doesn't re-walk the (possibly large) arrays.
  const coordMap = useMemo(() => rebuildCoordMap(grid), [grid]);

  const [mz, setMz] = useState("");
  const [tol, setTol] = useState("0.5");
  const [ionImage, setIonImage] = useState<Float32Array | null>(null);
  const [stats, setStats] = useState<IonImageStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The hovered/clicked cell readout.
  const [readout, setReadout] = useState<{ x: number; y: number; key: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const mzNum = Number(mz);
  const tolNum = Number(tol);
  const inputsValid =
    mz !== "" &&
    Number.isFinite(mzNum) &&
    mzNum > 0 &&
    Number.isFinite(tolNum) &&
    tolNum > 0;

  async function handleRender() {
    if (!inputsValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await renderIonImage(mzNum, tolNum);
      setIonImage(result.ionImage);
      setStats(result.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIonImage(null);
      setStats(null);
    } finally {
      setBusy(false);
    }
  }

  // Paint the ion image to the canvas whenever it (or its max) changes. The canvas
  // backing store is the intrinsic grid size; CSS upscales it (pixelated).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ionImage) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const max = stats?.max ?? 0;
    const rgba = paintIonImage(ionImage, width, height, presenceMask, max);
    // Build the ImageData then copy bytes in: the `new ImageData(data, w, h)`
    // overload demands a Uint8ClampedArray<ArrayBuffer> exactly, which our pure
    // helper's ArrayBufferLike-typed result doesn't structurally satisfy.
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);
  }, [ionImage, stats, width, height, presenceMask]);

  function onCanvasMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const hit = toGridCoord(e, e.currentTarget, width, height);
    setReadout(hit);
  }

  function onCanvasLeave() {
    setReadout(null);
  }

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const hit = toGridCoord(e, e.currentTarget, width, height);
    if (!hit) return;
    if (presenceMask[hit.key] === 0) return; // no-data cell, nothing to select
    const spectrumIndex = coordMap.get(hit.key);
    if (spectrumIndex != null) onPickSpectrum(spectrumIndex);
  }

  // Display size: upscale to a comfortable max while preserving the grid aspect.
  const DISPLAY_MAX = 480;
  const scale = Math.max(1, Math.floor(DISPLAY_MAX / Math.max(width, height)));
  const dispW = width * scale;
  const dispH = height * scale;

  // Readout value: absent vs intensity. Coords are reported in absolute IMS
  // positions (local cell + origin), matching the grid's 1-based convention.
  const readoutText = useMemo(() => {
    if (!readout) return "";
    const ax = readout.x + originX;
    const ay = readout.y + originY;
    const xy = `x: ${ax}, y: ${ay}`;
    if (presenceMask[readout.key] === 0) return `${xy} — no data`;
    if (ionImage) return `${xy} · intensity: ${formatCompact(ionImage[readout.key] ?? 0)}`;
    return xy;
  }, [readout, ionImage, presenceMask, originX, originY]);

  return (
    <section aria-label="Ion image">
      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "flex-end",
          flexWrap: "wrap",
          marginBottom: "0.75rem",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem" }}>
          m/z
          <input
            type="text"
            inputMode="decimal"
            value={mz}
            onChange={(e) => setMz(e.target.value)}
            aria-label="m/z"
            placeholder="e.g. 798.54"
            style={{ width: 100 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRender();
            }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem" }}>
          tolerance (Da)
          <input
            type="text"
            inputMode="decimal"
            value={tol}
            onChange={(e) => setTol(e.target.value)}
            aria-label="tolerance in Da"
            style={{ width: 90 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRender();
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => void handleRender()}
          disabled={!inputsValid || busy}
        >
          {busy ? "Rendering…" : "Render"}
        </button>
      </div>

      {error && (
        <p data-testid="ion-image-error" style={{ color: "var(--danger, #c00)", fontSize: "0.85rem" }}>
          {error}
        </p>
      )}

      {/* ── Canvas + legend ───────────────────────────────────────────────── */}
      {ionImage === null ? (
        <p style={{ color: "var(--text-muted, #666)", fontSize: "0.85rem" }}>
          Enter an m/z and tolerance, then Render to see the ion image.
        </p>
      ) : (
        <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            onMouseMove={onCanvasMove}
            onMouseLeave={onCanvasLeave}
            onClick={onCanvasClick}
            aria-label={`Ion image, ${width} by ${height} pixels. Click a pixel to inspect its spectrum.`}
            data-testid="ion-image-canvas"
            style={{
              width: dispW,
              height: dispH,
              imageRendering: "pixelated",
              cursor: "crosshair",
              border: "1px solid var(--border, #ccc)",
              userSelect: "none",
            }}
          />

          {/* Colormap legend (min .. max) */}
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted, #666)" }}>
            <div
              aria-hidden="true"
              style={{
                width: 18,
                height: Math.min(dispH, 240),
                // 0deg → vertical, high (yellow) at the top.
                background: viridisGradientCss("0deg"),
                borderRadius: 2,
                border: "1px solid var(--border, #ccc)",
              }}
            />
            {stats && (
              <div style={{ marginTop: "0.25rem" }}>
                <div data-testid="ion-image-max">max {formatCompact(stats.max)}</div>
                <div>min {formatCompact(stats.min)}</div>
                <div style={{ marginTop: "0.25rem" }}>{stats.nonzeroCount} px nonzero</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Hover / click readout ─────────────────────────────────────────── */}
      {ionImage !== null && (
        <p
          data-testid="ion-image-readout"
          style={{ minHeight: "1.2em", fontSize: "0.8rem", color: "var(--text-muted, #666)", marginTop: "0.5rem" }}
        >
          {readoutText}
        </p>
      )}
    </section>
  );
}
