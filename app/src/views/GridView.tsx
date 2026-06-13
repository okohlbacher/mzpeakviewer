// Grid view — imaging pixel-grid diagnostics. Renders the reconstructed grid as a
// gray per-pixel-TIC raster (absent cells → SENTINEL) with a cell-boundary overlay,
// plus a diagnostics readout (dimensions, fill %, origin, fixed orientation). The
// imaging spec pins orientation: top-left origin, col=x, row=y, y-down (C2).
import { useEffect, useMemo, useRef } from "react";
import { useStore } from "../store";
import { StatRow, Panel, Badge } from "@mzpeak/ui-kit";
import { rasterizeTic } from "./render";

export function GridView() {
  const grid = useStore((s) => s.grid);
  const tic = useStore((s) => s.ticColumn);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Paint the gray TIC raster (or a flat presence map when no TIC is available yet).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = grid.width;
    canvas.height = grid.height;
    if (tic) {
      const rgba = rasterizeTic(tic, grid, "gray", false);
      const img = ctx.createImageData(grid.width, grid.height);
      img.data.set(rgba);
      ctx.putImageData(img, 0, 0);
    } else {
      // No TIC yet: present cells mid-gray, absent cells the sentinel.
      const img = ctx.createImageData(grid.width, grid.height);
      for (let k = 0; k < grid.width * grid.height; k++) {
        const o = k * 4;
        const present = grid.presenceMask[k] !== 0;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = present ? 150 : 0x1a;
        img.data[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
  }, [grid, tic]);

  const stats = useMemo(() => {
    if (!grid) return null;
    const total = grid.width * grid.height;
    let filled = 0;
    for (let i = 0; i < grid.presenceMask.length; i++) if (grid.presenceMask[i] !== 0) filled++;
    const pct = total ? Math.round((filled / total) * 100) : 0;
    return { total, filled, missing: total - filled, mapped: grid.spectrumIndex.length, pct };
  }, [grid]);

  if (!grid || !stats) {
    return (
      <div data-testid="grid-no-grid" style={{ color: "var(--text-muted, #94a3b8)" }}>
        No imaging grid available for this file.
      </div>
    );
  }

  // Contain-fit display size (pixelated) + a CSS cell-boundary overlay.
  const MAX = 460;
  const scale = Math.max(1, Math.floor(MAX / Math.max(grid.width, grid.height)));
  const dispW = grid.width * scale;
  const dispH = grid.height * scale;
  // Only draw cell lines when cells are big enough to be legible.
  const showLines = scale >= 4;

  return (
    <section data-testid="grid-view" style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "flex-start" }}>
      <div
        style={{
          position: "relative",
          background: "var(--ink, #0e1216)",
          borderRadius: 8,
          padding: "0.75rem",
          lineHeight: 0,
        }}
      >
        <canvas
          ref={canvasRef}
          data-testid="grid-canvas"
          aria-label={`Imaging grid, ${grid.width} by ${grid.height} pixels`}
          style={{ width: dispW, height: dispH, imageRendering: "pixelated", display: "block", borderRadius: 2 }}
        />
        {showLines && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: "0.75rem",
              left: "0.75rem",
              width: dispW,
              height: dispH,
              pointerEvents: "none",
              backgroundImage:
                "linear-gradient(to right, rgba(255,255,255,0.14) 1px, transparent 1px)," +
                "linear-gradient(to bottom, rgba(255,255,255,0.14) 1px, transparent 1px)",
              backgroundSize: `${scale}px ${scale}px`,
            }}
          />
        )}
      </div>

      <div style={{ minWidth: 260, flex: "0 1 320px" }}>
        <Panel title="Grid diagnostics" defaultOpen testid="grid-diagnostics">
          <StatRow label="Dimensions" value={`${grid.width} × ${grid.height} px`} testid="grid-dims" />
          <StatRow label="Total cells" value={stats.total.toLocaleString()} />
          <StatRow
            label="Filled"
            value={
              <Badge tone={stats.pct >= 95 ? "success" : "warning"}>
                {stats.filled.toLocaleString()} ({stats.pct}%)
              </Badge>
            }
            testid="grid-filled"
          />
          <StatRow label="Missing" value={`${stats.missing.toLocaleString()} px`} />
          <StatRow label="Mapped spectra" value={stats.mapped.toLocaleString()} />
          <StatRow label="Origin (x, y)" value={`${grid.originX}, ${grid.originY}`} />
          <StatRow label="Orientation" value="top-left · col=x · row=y · y-down" />
        </Panel>
        <p style={{ marginTop: "0.75rem", fontSize: "var(--text-xs, 0.7rem)", color: "var(--text-muted, #94a3b8)", maxWidth: 320 }}>
          Gray intensity is the per-pixel TIC (MS1); near-black cells are absent pixels
          (no spectrum). The coordinate convention is fixed by the imaging spec.
        </p>
      </div>
    </section>
  );
}
