import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Grid, Image, Layers, Download, Blend, Microscope, Zap } from "lucide-react";

import { useStore } from "../state/store";
import {
  Button,
  SegmentedControl,
  NumberField,
  ColormapScale,
  Select,
} from "./ds";
import type { View } from "./viewTypes";
import {
  rasterizeTic,
  rasterizeImage,
  rasterizeMultiChannel,
  type Colormap,
} from "./rasterize";
import { placeOpticalOnGrid } from "../imaging/optical";
import { encodeRgba8Tiff, downloadTiff } from "../export/tiff";
import type { ImagingGrid } from "../imaging/types";
import type { ChannelRequest } from "../worker/protocol";

// Warning amber (caution, NOT error) — reused from GridDiagnosticsPanel's WARNING
// constant for the mixed-representation surface (D-08).
const WARNING = "#8a6d00";

/** Hit-test result: a grid cell under the pointer, or null when off-canvas. */
type Hit = { x0: number; y0: number; key: number };

/**
 * Resolution/aspect-safe pointer → grid-cell mapping (Pitfall 5). Uses the canvas
 * bounding rect (the offset-* event props break under CSS scaling). Returns null
 * when the pointer is outside [0,width)×[0,height). The key reuses grid.ts's
 * `key = y0*width + x0` — NO flip/transpose (C2 MANDATORY).
 */
function toGridCoord(
  e: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
  grid: ImagingGrid,
): Hit | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x0 = Math.floor(((e.clientX - rect.left) / rect.width) * grid.width);
  const y0 = Math.floor(((e.clientY - rect.top) / rect.height) * grid.height);
  if (x0 < 0 || x0 >= grid.width || y0 < 0 || y0 >= grid.height) return null;
  return { x0, y0, key: y0 * grid.width + x0 };
}

/** Compact intensity formatting for the hover readout (e.g. `1.4e6`, `0`, `230`). */
function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-3) return v.toExponential(1);
  // Trim to a short fixed/precision form without trailing noise.
  return Number(v.toPrecision(4)).toLocaleString();
}

/**
 * Invert `coordToSpectrumIndex` to find the grid key whose value === spectrumIndex.
 * Returns null when the selected spectrum is not on this grid (e.g. index-input
 * selection of an off-grid spectrum). Linear scan is fine at orientation scale.
 */
function keyForSpectrumIndex(
  grid: ImagingGrid,
  spectrumIndex: number,
): number | null {
  for (const [key, sIdx] of grid.coordToSpectrumIndex) {
    if (sIdx === spectrumIndex) return key;
  }
  return null;
}

/** Blit an RGBA byte raster into a 2D context at intrinsic (one-px-per-cell) resolution. */
function blit(
  ctx: CanvasRenderingContext2D,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): void {
  const img = new ImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
}

/**
 * Stroke a 1px contrast selection ring on grid cell `key`. The colour is
 * luminance-picked from the cell's RGBA so it stays visible against both colormap
 * extremes and the absent-pixel sentinel (D-06).
 */
function strokeSelectionRing(
  ctx: CanvasRenderingContext2D,
  rgba: Uint8ClampedArray,
  key: number,
  width: number,
): void {
  const x0 = key % width;
  const y0 = Math.floor(key / width);
  const o = key * 4;
  const lum = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
  ctx.strokeStyle = lum > 140 ? "#000000" : "#ffffff";
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, 1, 1);
}

/**
 * Derive a filename stem from fileMeta.run or a fallback string.
 * Returns e.g. "dataset" when nothing is available.
 */
function filenameStem(run: unknown): string {
  if (run && typeof run === "object" && "name" in run && typeof (run as Record<string, unknown>).name === "string") {
    const n = (run as { name: string }).name;
    // Strip known extensions
    return n.replace(/\.(mzpeak|mzML|imzML|d|raw)$/i, "");
  }
  return "ion-image";
}

/**
 * Imaging panel: a Canvas-2D TIC heatmap (IMAGE-01) with a 1-based hover readout
 * (IMAGE-04), pixel-click → `selectSpectrum` round-trip (SPEC-01), and a contrast
 * selection ring. Mounted imperatively via `useRef` mirroring SpectrumPanel; reads
 * the tic/grid/selection slice from the store. Orientation is fixed (no flip, C2);
 * pixel aspect honored from `grid.pixelSizeUm` (C5); absent ≠ zero (C8, D-09).
 *
 * Phase 4 additions: controls row (m/z, tolerance, Da/ppm, Show Ion Image button,
 * colormap, scale, percentile selectors) above the TIC canvas; ion-image canvas
 * section below (conditionally rendered after first click, IMAGE-02/IMAGE-03).
 *
 * BL additions: TIC norm toggle, Gaussian smooth, histogram contrast, multi-channel
 * tab, TIFF export, ROI rectangle selection.
 */
export function ImagingPanel({
  view,
  setView,
}: {
  view: View;
  setView: (v: View) => void;
}) {
  const grid = useStore((s) => s.grid);
  const tic = useStore((s) => s.tic);
  const selectedIndex = useStore((s) => s.selectedIndex);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const mixedRepresentationWarning = useStore(
    (s) => s.mixedRepresentationWarning,
  );
  // Phase 4 store subscriptions (IMAGE-02/IMAGE-03).
  const ionImage = useStore((s) => s.ionImage);
  const ionImageStats = useStore((s) => s.ionImageStats);
  const colormap = useStore((s) => s.colormap);
  const scale = useStore((s) => s.scale);
  const percentile = useStore((s) => s.percentile);
  const renderIonImage = useStore((s) => s.renderIonImage);
  const setColormapSettings = useStore((s) => s.setColormapSettings);
  const isRendering = useStore((s) => s.isRendering);
  const renderProgress = useStore((s) => s.renderProgress);
  const ionIndexReady = useStore((s) => s.ionIndexReady);
  const ionIndexPoints = useStore((s) => s.ionIndexPoints);

  const stats = useStore((s) => s.stats);
  const fileMeta = useStore((s) => s.fileMeta);

  // BL-01: TIC normalization (getter only — setter lives in SettingsPopover)
  const ticNorm = useStore((s) => s.ticNorm);

  // BL-04: Gaussian smooth (getter only — setter lives in SettingsPopover)
  const smoothSigma = useStore((s) => s.smoothSigma);

  // BL-07: Histogram contrast (getter only — setter lives in SettingsPopover)
  const histogramMode = useStore((s) => s.histogramMode);

  // BL-02: Multi-channel
  const multiChannel = useStore((s) => s.multiChannel);
  const renderMultiChannel = useStore((s) => s.renderMultiChannel);
  const mzWindow = useStore((s) => s.mzWindow);

  // BL-06: ROI
  const requestRoiSpectrum = useStore((s) => s.requestRoiSpectrum);
  const clearRoi = useStore((s) => s.clearRoi);
  const roiIndices = useStore((s) => s.roiIndices);

  // ADD-01: optical images
  const opticalImages = useStore((s) => s.opticalImages);
  const opticalDecoded = useStore((s) => s.opticalDecoded);
  const opticalErrors = useStore((s) => s.opticalErrors);
  const selectedOpticalPath = useStore((s) => s.selectedOpticalPath);
  const setSelectedOpticalPath = useStore((s) => s.setSelectedOpticalPath);
  const requestOpticalImage = useStore((s) => s.requestOpticalImage);
  const hasOptical = opticalImages.length > 0;
  const selectedOptical = opticalImages.find((im) => im.archivePath === selectedOpticalPath) ?? null;
  const decodedOptical = selectedOpticalPath ? (opticalDecoded[selectedOpticalPath] ?? null) : null;
  const opticalError = selectedOpticalPath ? (opticalErrors[selectedOpticalPath] ?? null) : null;
  // World-frame placement: resample the optical image into the MS grid via its
  // affine so it aligns + composites with ion images. null when unregistered.
  const opticalPlaced = useMemo(
    () =>
      decodedOptical && grid && selectedOptical?.affine
        ? placeOpticalOnGrid(decodedOptical, selectedOptical.affine, grid.width, grid.height)
        : null,
    [decodedOptical, grid, selectedOptical],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mcCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const blendCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const opticalCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Download Image: chosen export format (applies to every image tab).
  const [dlFormat, setDlFormat] = useState<"png" | "tiff" | "jpeg">("png");

  // Blend view: per-layer opacity (0–1) for the TIC / ion / RGB / optical overlay.
  const [blendOpacity, setBlendOpacity] = useState<{
    tic: number;
    ion: number;
    rgb: number;
    optical: number;
  }>({ tic: 1, ion: 0.6, rgb: 0, optical: 0 });

  // Shared rasterizeImage options for the ion image (used by its paint effect and
  // the blend compositor) — one source of truth for colormap/scale/BL modifiers.
  const ionOpts = useMemo(
    () => ({
      colormap,
      percentile,
      logScale: scale === "log",
      tic: ticNorm ? tic : null,
      ticNorm,
      smoothSigma,
      histogramMode,
    }),
    [colormap, percentile, scale, ticNorm, tic, smoothSigma, histogramMode],
  );

  const [readout, setReadout] = useState<{ text: string; muted: boolean }>({
    text: "",
    muted: false,
  });

  // m/z range inputs. Auto-populated from stats.mzRange when available.
  const [mzStart, setMzStart] = useState<string>("");
  const [mzEnd, setMzEnd] = useState<string>("");
  const [autoFilled, setAutoFilled] = useState(false);

  // Auto-fill m/z range from dataset stats the first time they become available.
  useEffect(() => {
    if (autoFilled) return;
    if (!stats?.mzRange) return;
    const [lo, hi] = stats.mzRange;
    if (!mzStart) setMzStart(lo.toFixed(2));
    if (!mzEnd) setMzEnd(hi.toFixed(2));
    setAutoFilled(true);
  }, [stats?.mzRange, autoFilled, mzStart, mzEnd]);

  // Keep the m/z range inputs in sync with the rendered window, so a peak click
  // in the spectrum (which calls renderIonImage with mz ± global Δ and switches
  // to this view) is reflected in the toolbar. Keyed on mzWindow only.
  useEffect(() => {
    if (!mzWindow) return;
    setMzStart((mzWindow.mz - mzWindow.tolDa).toFixed(4));
    setMzEnd((mzWindow.mz + mzWindow.tolDa).toFixed(4));
  }, [mzWindow]);

  // BL-02: Multi-channel per-row inputs
  const [mcMz, setMcMz] = useState<[string, string, string]>(["", "", ""]);
  // Per-channel tolerance is fixed at 0.5 Da (the editing control moved out of the
  // toolbar in Phase 4); still read by handleRenderMultiChannel.
  const mcTol = ["0.5", "0.5", "0.5"] as const;

  // BL-06: ROI drag state
  type DragState = {
    startX: number; // clientX at mousedown
    startY: number; // clientY at mousedown
    currentX: number;
    currentY: number;
    active: boolean; // true once mouse moved >= 2px
  };
  const dragRef = useRef<DragState | null>(null);
  // Committed ROI (grid coords) and the live drag rectangle (grid coords). Both
  // are drawn as a DOM overlay so ROI selection works on EVERY image view.
  const [roiRect, setRoiRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [liveDrag, setLiveDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // Overview TIC paint + selection ring. The ion/TIC canvases mount only when
  // their view is active, so `view` is a load-bearing dep: switching back to a
  // tab remounts a blank canvas that must be repainted. colormap/scale: the
  // overview TIC honors the global colormap + scale (UAT-r3).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid || !tic) return;
    canvas.width = grid.width;
    canvas.height = grid.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rgba = rasterizeTic(tic, grid, colormap, scale === "log");
    blit(ctx, rgba, grid.width, grid.height);
    if (selectedIndex == null) return;
    const key = keyForSpectrumIndex(grid, selectedIndex);
    if (key != null) strokeSelectionRing(ctx, rgba, key, grid.width);
  }, [selectedIndex, tic, grid, view, colormap, scale]);

  // Ion image paint + selection ring. ROI is a DOM overlay (roiOverlay), not
  // drawn here. roiRect is kept as a dep so the ring repaints alongside it.
  useEffect(() => {
    const canvas = ionCanvasRef.current;
    if (!canvas || !grid || !ionImage) return;
    canvas.width = grid.width;
    canvas.height = grid.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rgba = rasterizeImage(ionImage, grid, ionOpts);
    blit(ctx, rgba, grid.width, grid.height);
    if (selectedIndex == null) return;
    const key = keyForSpectrumIndex(grid, selectedIndex);
    if (key != null) strokeSelectionRing(ctx, rgba, key, grid.width);
  }, [selectedIndex, ionImage, grid, ionOpts, roiRect, view]);

  // BL-02: Multi-channel canvas paint.
  useEffect(() => {
    const canvas = mcCanvasRef.current;
    if (!canvas || !grid || !multiChannel?.images) return;
    canvas.width = grid.width;
    canvas.height = grid.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    blit(ctx, rasterizeMultiChannel(multiChannel.images, grid, tic ?? null, ticNorm), grid.width, grid.height);
    // view dependency: same mount-after-data issue as the ion canvas above.
  }, [multiChannel, grid, tic, ticNorm, view]);

  // ADD-01: lazily decode the selected optical image when its tab (or the blend
  // view, which may composite it) becomes active and it isn't decoded yet.
  useEffect(() => {
    if (view !== "optical" && view !== "blend") return;
    if (!selectedOpticalPath) return;
    if (opticalDecoded[selectedOpticalPath] || opticalErrors[selectedOpticalPath]) return;
    requestOpticalImage(selectedOpticalPath);
  }, [view, selectedOpticalPath, opticalDecoded, opticalErrors, requestOpticalImage]);

  // ADD-01: optical canvas paint. Registered images (affine + grid) are resampled
  // into the MS grid frame so they align with ion images; unregistered images are
  // painted at native resolution (standalone, no spatial hit-testing).
  useEffect(() => {
    if (view !== "optical") return;
    const canvas = opticalCanvasRef.current;
    if (!canvas || !decodedOptical) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (opticalPlaced && grid) {
      canvas.width = grid.width;
      canvas.height = grid.height;
      blit(ctx, opticalPlaced, grid.width, grid.height);
    } else {
      canvas.width = decodedOptical.width;
      canvas.height = decodedOptical.height;
      blit(ctx, decodedOptical.rgba, decodedOptical.width, decodedOptical.height);
    }
  }, [view, decodedOptical, opticalPlaced, grid]);

  // Blend canvas paint — alpha-over the TIC / ion / RGB layers (bottom → top)
  // by their slider opacities onto the dark stage colour.
  useEffect(() => {
    if (view !== "blend") return;
    const canvas = blendCanvasRef.current;
    if (!canvas || !grid) return;
    canvas.width = grid.width;
    canvas.height = grid.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const n = grid.width * grid.height;
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      out[i * 4] = 14;
      out[i * 4 + 1] = 18;
      out[i * 4 + 2] = 22; // --ink, the dark stage
      out[i * 4 + 3] = 255;
    }
    const layers: Array<[Uint8ClampedArray, number]> = [];
    if (opticalPlaced && blendOpacity.optical > 0)
      layers.push([opticalPlaced, blendOpacity.optical]);
    if (tic && blendOpacity.tic > 0)
      layers.push([rasterizeTic(tic, grid, colormap, scale === "log"), blendOpacity.tic]);
    if (multiChannel?.images && blendOpacity.rgb > 0)
      layers.push([
        rasterizeMultiChannel(multiChannel.images, grid, tic ?? null, ticNorm),
        blendOpacity.rgb,
      ]);
    if (ionImage && blendOpacity.ion > 0)
      layers.push([rasterizeImage(ionImage, grid, ionOpts), blendOpacity.ion]);

    // Effective alpha = slider opacity × per-pixel alpha/255, so a layer's
    // transparent pixels (e.g. outside the optical footprint) don't paint.
    for (const [rgba, a] of layers) {
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const la = a * (rgba[o + 3] / 255);
        const inv = 1 - la;
        out[o] = rgba[o] * la + out[o] * inv;
        out[o + 1] = rgba[o + 1] * la + out[o + 1] * inv;
        out[o + 2] = rgba[o + 2] * la + out[o + 2] * inv;
      }
    }
    blit(ctx, out, grid.width, grid.height);
  }, [
    view,
    blendOpacity,
    tic,
    ionImage,
    multiChannel,
    opticalPlaced,
    grid,
    colormap,
    scale,
    ticNorm,
    ionOpts,
  ]);

  // Grid is null until the first "Show Ion Image" click triggers lazy init.
  // We still render the controls row so the user can enter m/z and load.
  const aspect = grid
    ? grid.pixelSizeUm
      ? grid.pixelSizeUm.x / grid.pixelSizeUm.y
      : 1
    : 1;
  const cssAspectRatio = grid
    ? `${grid.width * aspect} / ${grid.height}`
    : "1 / 1";
  const base = grid?.coordinateBase ?? 1;

  // Scale the displayed image up to fill the dark stage while preserving aspect
  // ratio (contain-fit). We measure the stage and set an explicit pixel size on
  // the canvas ELEMENT — NOT object-fit — so the element box equals the visible
  // image box and getBoundingClientRect-based hit-testing (toGridCoord) stays
  // exact. A ResizeObserver tracks rail toggle / dock / window reflows.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !grid) return;
    const ar = (grid.width * aspect) / grid.height; // width / height
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
  }, [grid, aspect]);

  // Explicit pixel size for the active canvas (contain-fit); falls back to the
  // ── Zoom (all image tabs) ──────────────────────────────────────────────
  // The canvas is the contain-fit size × zoom; when zoomed in the stage becomes
  // scrollable (overflow:auto) so the user can pan. Wheel zooms toward the
  // cursor via a native non-passive listener (so preventDefault works).
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const displaySizeRef = useRef(displaySize);
  displaySizeRef.current = displaySize;

  // Reset zoom + scroll when switching tabs.
  useEffect(() => {
    setZoom(1);
    if (stageRef.current) {
      stageRef.current.scrollLeft = 0;
      stageRef.current.scrollTop = 0;
    }
  }, [view]);

  // Publish the live zoom to the shell status bar (mode · dimensions · counts · zoom).
  useEffect(() => {
    useStore.setState({ viewZoom: zoom });
  }, [zoom]);

  // Guard: the Optical tab only exists when the file has optical images. If the
  // active view is "optical" but they're absent (e.g. a new file loaded while on
  // that tab), fall back to Overview so the centre pane isn't stuck (Codex r3-#1).
  useEffect(() => {
    if (view === "optical" && !hasOptical) setView("overview");
  }, [view, hasOptical, setView]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const el = stage; // non-null binding captured by the closures below
    function onWheel(e: WheelEvent) {
      if (!displaySizeRef.current) return;
      e.preventDefault();
      const prev = zoomRef.current;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const next = Math.min(8, Math.max(1, prev * factor));
      if (next === prev) return;
      const ratio = next / prev;
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const sl = el.scrollLeft;
      const st = el.scrollTop;
      setZoom(next);
      // Keep the point under the cursor stable after the canvas resizes.
      requestAnimationFrame(() => {
        el.scrollLeft = (sl + ox) * ratio - ox;
        el.scrollTop = (st + oy) * ratio - oy;
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function zoomBy(factor: number) {
    setZoom((z) => Math.min(8, Math.max(1, z * factor)));
  }
  function zoomReset() {
    setZoom(1);
    if (stageRef.current) {
      stageRef.current.scrollLeft = 0;
      stageRef.current.scrollTop = 0;
    }
  }

  // CSS aspect-ratio box until the first measurement lands. Scaled by zoom.
  const canvasSizeStyle: React.CSSProperties = displaySize
    ? { width: displaySize.w * zoom, height: displaySize.h * zoom }
    : { aspectRatio: cssAspectRatio, maxWidth: "100%", maxHeight: "100%" };

  // Hover-readout text for a grid cell, tailored to the active view.
  function readoutForHit(hit: { x0: number; y0: number; key: number }): {
    text: string;
    muted: boolean;
  } {
    const xy = `x: ${hit.x0 + base}, y: ${hit.y0 + base}`;
    if (grid && grid.presenceMask[hit.key] === 0)
      return { text: `${xy} — no data`, muted: true };
    if (view === "ion" && ionImage)
      return { text: `${xy} · intensity: ${formatCompact(ionImage[hit.key])}`, muted: false };
    if (view === "overview" && tic)
      return { text: `${xy} · TIC: ${formatCompact(tic[hit.key])}`, muted: false };
    return { text: xy, muted: false };
  }

  // ── Unified pointer handlers for ALL image canvases (tic / ion /
  // multi). `e.currentTarget` is the active canvas. A plain click selects a
  // pixel; a drag (≥2px) selects a rectangular ROI and renders its mean
  // spectrum. The ROI rectangle is a DOM overlay (gridRectToPx), so it draws and
  // selects identically on every view. ──────────────────────────────────────
  function onImgMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!grid) return;
    const canvas = e.currentTarget;
    const hit = toGridCoord(e, canvas, grid);
    setReadout(hit ? readoutForHit(hit) : { text: "", muted: false });

    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.active && (Math.abs(dx) >= 2 || Math.abs(dy) >= 2)) drag.active = true;
    if (!drag.active) return;
    drag.currentX = e.clientX;
    drag.currentY = e.clientY;
    const a = toGridCoord({ clientX: drag.startX, clientY: drag.startY }, canvas, grid);
    const b2 = toGridCoord({ clientX: drag.currentX, clientY: drag.currentY }, canvas, grid);
    if (a && b2) setLiveDrag({ x0: a.x0, y0: a.y0, x1: b2.x0, y1: b2.y0 });
  }

  function onImgLeave() {
    setReadout({ text: "", muted: false });
    if (dragRef.current?.active) {
      dragRef.current = null;
      setLiveDrag(null);
    }
  }

  function onImgDown(e: React.MouseEvent<HTMLCanvasElement>) {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      active: false,
    };
  }

  function onImgUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    setLiveDrag(null);
    if (!grid) return;
    const canvas = e.currentTarget;

    if (!drag || !drag.active) {
      // Plain click → select pixel; clear any committed ROI.
      clearRoi();
      setRoiRect(null);
      const hit = toGridCoord(e, canvas, grid);
      if (!hit || grid.presenceMask[hit.key] === 0) return;
      const idx = grid.coordToSpectrumIndex.get(hit.key);
      if (idx != null) void selectSpectrum(idx);
      return;
    }

    const a = toGridCoord({ clientX: drag.startX, clientY: drag.startY }, canvas, grid);
    const b2 = toGridCoord({ clientX: drag.currentX, clientY: drag.currentY }, canvas, grid);
    if (!a || !b2) return;
    const x0 = Math.min(a.x0, b2.x0);
    const x1 = Math.max(a.x0, b2.x0);
    const y0 = Math.min(a.y0, b2.y0);
    const y1 = Math.max(a.y0, b2.y0);
    const indices: number[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = y * grid.width + x;
        if (grid.presenceMask[key] === 0) continue;
        const idx = grid.coordToSpectrumIndex.get(key);
        if (idx != null) indices.push(idx);
      }
    }
    if (indices.length > 0) {
      setRoiRect({ x0, y0, x1, y1 });
      requestRoiSpectrum(indices);
    } else {
      clearRoi();
      setRoiRect(null);
    }
  }

  // Map a grid-coordinate rectangle to display pixels for the DOM ROI overlay.
  // The canvas element box == the displayed image (contain-fit sizing), so the
  // overlay (a child of .imgframe) maps grid → canvas px directly.
  function gridRectToPx(rect: { x0: number; y0: number; x1: number; y1: number }) {
    if (!grid || !displaySize) return null;
    const sx = (displaySize.w * zoom) / grid.width;
    const sy = (displaySize.h * zoom) / grid.height;
    const rx = Math.min(rect.x0, rect.x1);
    const ry = Math.min(rect.y0, rect.y1);
    const rw = Math.abs(rect.x1 - rect.x0) + 1;
    const rh = Math.abs(rect.y1 - rect.y0) + 1;
    return { left: rx * sx, top: ry * sy, width: rw * sx, height: rh * sy };
  }

  // The active ROI overlay (live drag takes precedence over the committed ROI).
  const roiBox = (liveDrag ?? roiRect) ? gridRectToPx((liveDrag ?? roiRect)!) : null;
  const roiOverlay = roiBox ? (
    <div
      className="roi-rect"
      style={{ left: roiBox.left, top: roiBox.top, width: roiBox.width, height: roiBox.height }}
    />
  ) : null;

  // m/z range → center + half-window for renderIonImage
  function handleRenderIonImage() {
    const start = Number(mzStart);
    const end = Number(mzEnd);
    if (!Number.isFinite(start) || start < 0) return;
    if (!Number.isFinite(end) || end <= 0 || end <= start) return;
    const mz = (start + end) / 2;
    const tolDa = (end - start) / 2;
    if (tolDa <= 0) return;
    void renderIonImage(mz, tolDa);
  }

  // Allow start=0 (show all m/z above 0); require end > start > -1
  const startNum = Number(mzStart);
  const endNum = Number(mzEnd);
  const rangeValid =
    mzStart !== "" && mzEnd !== "" &&
    Number.isFinite(startNum) && startNum >= 0 &&
    Number.isFinite(endNum) && endNum > startNum;

  // Phase 4 — colormap/scale/percentile change handler (D-02: no re-query, only recolor).
  function handleColormapSettings(
    newColormap: Colormap = colormap,
    newScale: "linear" | "log" = scale,
    newPercentile: number = percentile,
  ) {
    setColormapSettings(newColormap, newScale, newPercentile);
  }

  // BL-02: render multi-channel
  function handleRenderMultiChannel() {
    const channels: (ChannelRequest | null)[] = mcMz.map((mzStr, i) => {
      const mz = Number(mzStr);
      const tol = Number(mcTol[i]);
      if (!mzStr || !Number.isFinite(mz) || mz <= 0) return null;
      if (!Number.isFinite(tol) || tol <= 0) return null;
      return { mz, tolDa: tol };
    });
    renderMultiChannel(channels);
  }

  // The canvas backing the currently-active image tab (used by Download Image).
  function activeCanvas(): HTMLCanvasElement | null {
    switch (view) {
      case "overview":
        return canvasRef.current;
      case "optical":
        return opticalCanvasRef.current;
      case "ion":
        return ionCanvasRef.current;
      case "multi":
        return mcCanvasRef.current;
      case "blend":
        return blendCanvasRef.current;
      default:
        return null;
    }
  }

  // Download Image (every image tab) — exports the displayed raster as TIFF /
  // PNG / JPEG. PNG/JPEG go through canvas.toBlob; TIFF encodes the canvas RGBA
  // as an 8-bit RGB TIFF (browsers can't toBlob TIFF).
  function handleDownloadImage() {
    const canvas = activeCanvas();
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const stem = filenameStem(fileMeta?.run);
    let suffix = view as string;
    if (view === "ion" && mzWindow)
      suffix = `mz${mzWindow.mz.toFixed(4)}±${mzWindow.tolDa.toFixed(4)}Da`;
    const base = `${stem}_${suffix}`;

    if (dlFormat === "tiff") {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height } = canvas;
      const rgba = ctx.getImageData(0, 0, width, height).data;
      downloadTiff(encodeRgba8Tiff(rgba, width, height), `${base}.tif`);
      return;
    }
    const mime = dlFormat === "png" ? "image/png" : "image/jpeg";
    const ext = dlFormat === "png" ? "png" : "jpg";
    canvas.toBlob(
      (blob) => {
        if (!blob || typeof document === "undefined") return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${base}.${ext}`;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      mime,
      0.92,
    );
  }

  // Download is available on any image tab that currently shows a raster.
  const canDownloadImage =
    (view === "overview" && tic !== null && grid !== null) ||
    (view === "optical" && decodedOptical !== null) ||
    (view === "ion" && ionImage !== null && grid !== null) ||
    (view === "multi" && !!multiChannel?.images && grid !== null) ||
    (view === "blend" &&
      grid !== null &&
      (tic !== null || ionImage !== null || !!multiChannel?.images || opticalPlaced !== null));

  // Colormap selector applies to the ion image AND the overview TIC (both go
  // through rasterizeImage/rasterizeTic, which honor the store colormap + scale).
  // Hidden on multi (fixed R/G/B) and blend (composites its own layers).
  const showColormapCtl = view === "ion" || view === "overview";
  const ticHasImage = view === "overview" && tic !== null && grid !== null;
  const ionHasImage = view === "ion" && ionImage !== null && grid !== null;
  const showLegend = ticHasImage || ionHasImage;

  return (
    <>
      {/* ── Toolbar: view tabs + per-view controls ─────────────────────────── */}
      <div className="toolbar" data-testid="imaging-panel" aria-label="imaging-panel">
        <SegmentedControl
          ariaLabel="View"
          value={view}
          onChange={(v) => setView(v as View)}
          options={[
            { value: "overview", label: "Overview", icon: <Grid size={13} /> },
            // Optical tab sits right after Overview, shown only when the file
            // carries embedded optical images (imaging-spec v0.5).
            ...(hasOptical
              ? [{ value: "optical", label: "Optical", icon: <Microscope size={13} /> }]
              : []),
            { value: "ion", label: "Ion Image", icon: <Image size={13} /> },
            { value: "multi", label: "Multi-channel", icon: <Layers size={13} /> },
            { value: "blend", label: "Blend", icon: <Blend size={13} /> },
          ]}
        />
        <div className="toolbar__sep" />

        {view === "optical" && (
          <div className="toolbar__group">
            {opticalImages.length > 1 && (
              <>
                <span className="toolbar__lbl">Image</span>
                <Select
                  size="sm"
                  ariaLabel="optical image"
                  value={selectedOpticalPath ?? ""}
                  onChange={(v) => setSelectedOpticalPath(v)}
                  options={opticalImages.map((im) => ({
                    value: im.archivePath,
                    label: im.sourceName,
                  }))}
                />
              </>
            )}
            {selectedOptical && (
              <span className="toolbar__lbl" style={{ color: "var(--text-faint)" }}>
                {selectedOptical.role}
                {selectedOptical.affine ? "" : " · unregistered"}
              </span>
            )}
          </div>
        )}

        {view === "ion" && (
          <div className="toolbar__group">
            <span className="toolbar__lbl">m/z</span>
            <NumberField
              size="sm"
              width="84px"
              type="text"
              value={mzStart}
              onChange={setMzStart}
              ariaLabel="m/z start"
            />
            <span style={{ color: "var(--text-faint)" }}>–</span>
            <NumberField
              size="sm"
              width="84px"
              type="text"
              value={mzEnd}
              onChange={setMzEnd}
              unit="Da"
              ariaLabel="m/z end"
            />
            <Button
              size="sm"
              iconLeft={<Image size={14} />}
              disabled={!rangeValid || isRendering}
              onClick={handleRenderIonImage}
            >
              {isRendering ? "Rendering…" : "Render"}
            </Button>
          </div>
        )}

        {view === "multi" && (
          <div className="toolbar__group">
            {(["r", "g", "b"] as const).map((c, i) => (
              <span key={c} className="mc-row">
                <span
                  className="mc-sw"
                  style={{ background: `var(--channel-${c})` }}
                  aria-label={`channel ${c.toUpperCase()}`}
                />
                <NumberField
                  size="sm"
                  width="78px"
                  type="text"
                  value={mcMz[i]}
                  onChange={(v) => {
                    const next = [...mcMz] as [string, string, string];
                    next[i] = v;
                    setMcMz(next);
                  }}
                  ariaLabel={`channel ${c.toUpperCase()} m/z`}
                />
              </span>
            ))}
            <Button
              size="sm"
              iconLeft={<Layers size={14} />}
              disabled={isRendering}
              onClick={handleRenderMultiChannel}
            >
              {isRendering ? "Rendering…" : "Render"}
            </Button>
          </div>
        )}

        {/* In-memory index indicator: after the one-time full read, every ion
            image renders instantly + exactly with no re-read. */}
        {ionIndexReady && (view === "ion" || view === "multi") && (
          <span
            className="toolbar__hint"
            data-testid="ion-index-badge"
            title={`${
              ionIndexPoints ? `${(ionIndexPoints / 1e6).toFixed(1)}M points ` : ""
            }indexed in memory — every ion image now renders instantly and exactly, with no re-read.`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
            }}
          >
            <Zap size={12} aria-hidden="true" /> indexed
          </span>
        )}

        {view === "blend" && (
          <div className="toolbar__group" style={{ gap: "var(--space-5)" }}>
            {([
              ["tic", "TIC", tic !== null],
              ["ion", "Ion", ionImage !== null],
              ["rgb", "RGB", multiChannel?.images != null],
              ["optical", "Optical", opticalPlaced !== null],
            ] as const).map(([key, label, available]) => (
              <span key={key} className="blend-row" title={available ? "" : "no data for this layer"}>
                <span className="toolbar__lbl">{label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(blendOpacity[key] * 100)}
                  disabled={!available}
                  aria-label={`${label} opacity`}
                  onChange={(e) =>
                    setBlendOpacity((o) => ({ ...o, [key]: Number(e.target.value) / 100 }))
                  }
                />
                <span className="blend-pct">{Math.round(blendOpacity[key] * 100)}%</span>
              </span>
            ))}
          </div>
        )}

        <div className="toolbar__spacer" />

        {showColormapCtl && (
          <SegmentedControl
            size="sm"
            ariaLabel="Colormap"
            value={colormap}
            onChange={(v) => handleColormapSettings(v as Colormap)}
            options={[
              { value: "viridis", label: "viridis" },
              { value: "inferno", label: "inferno" },
              { value: "gray", label: "gray" },
            ]}
          />
        )}

        {/* Download Image — present on every image tab (TIFF / PNG / JPEG). */}
        <div className="toolbar__sep" />
        <div className="toolbar__group">
          <Select
            size="sm"
            ariaLabel="download format"
            value={dlFormat}
            onChange={(v) => setDlFormat(v as "png" | "tiff" | "jpeg")}
            options={[
              { value: "png", label: "PNG" },
              { value: "tiff", label: "TIFF" },
              { value: "jpeg", label: "JPEG" },
            ]}
          />
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Download size={14} />}
            disabled={!canDownloadImage}
            onClick={handleDownloadImage}
            data-testid="download-image"
          >
            Download Image
          </Button>
        </div>
      </div>

      {/* ── Stage: the dark data canvas area ───────────────────────────────── */}
      <div
        className="stage"
        ref={stageRef}
        style={{ overflow: zoom > 1 ? "auto" : "hidden" }}
      >
        {mixedRepresentationWarning && (
          <div
            data-testid="tic-mixed-warning"
            style={{
              position: "absolute",
              left: "var(--space-6)",
              top: "var(--space-6)",
              color: WARNING,
              fontSize: "var(--text-xs)",
              background: "rgba(14,18,22,0.72)",
              padding: "var(--space-3) var(--space-4)",
              borderRadius: "var(--radius-sm)",
              zIndex: 2,
            }}
          >
            {mixedRepresentationWarning}
          </div>
        )}

        {/* Overview · TIC */}
        {view === "overview" &&
          (tic === null ? (
            <div data-testid="tic-unavailable" className="stage__empty">
              TIC not yet available
            </div>
          ) : (
            <div className="imgframe">
              <canvas
                ref={canvasRef}
                className="cross"
                data-testid="tic-canvas"
                onMouseDown={onImgDown}
                onMouseMove={onImgMove}
                onMouseUp={onImgUp}
                onMouseLeave={onImgLeave}
                style={{ ...canvasSizeStyle, userSelect: "none" }}
              />
              {roiOverlay}
            </div>
          ))}

        {/* Optical image (ADD-01) */}
        {view === "optical" &&
          (opticalError ? (
            <div className="stage__empty" data-testid="optical-error">
              Could not decode optical image: {opticalError}
            </div>
          ) : !decodedOptical ? (
            <div className="stage__empty" data-testid="optical-loading">
              {selectedOptical ? "Decoding optical image…" : "No optical image selected"}
            </div>
          ) : opticalPlaced && grid ? (
            // Registered: resampled into the MS grid frame — aligns + hit-tests
            // like the other images.
            <div className="imgframe">
              <canvas
                ref={opticalCanvasRef}
                className="cross"
                data-testid="optical-canvas"
                onMouseDown={onImgDown}
                onMouseMove={onImgMove}
                onMouseUp={onImgUp}
                onMouseLeave={onImgLeave}
                style={{ ...canvasSizeStyle, userSelect: "none" }}
              />
              {roiOverlay}
            </div>
          ) : (
            // Unregistered: shown standalone at native aspect (no spatial mapping).
            <div className="imgframe imgframe--native">
              <canvas
                ref={opticalCanvasRef}
                data-testid="optical-canvas"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            </div>
          ))}

        {/* Ion Image */}
        {view === "ion" &&
          (ionImage === null ? (
            <div className="stage__empty">
              Enter an m/z range above and click Show Ion Image.
            </div>
          ) : (
            <div className="imgframe">
              <canvas
                ref={ionCanvasRef}
                className="cross"
                data-testid="ion-canvas"
                onMouseDown={onImgDown}
                onMouseMove={onImgMove}
                onMouseUp={onImgUp}
                onMouseLeave={onImgLeave}
                style={{ ...canvasSizeStyle, userSelect: "none" }}
              />
              {roiOverlay}
            </div>
          ))}

        {/* Multi-channel */}
        {view === "multi" &&
          (multiChannel?.images ? (
            <div className="imgframe">
              <canvas
                ref={mcCanvasRef}
                className="cross"
                data-testid="mc-canvas"
                onMouseDown={onImgDown}
                onMouseMove={onImgMove}
                onMouseUp={onImgUp}
                onMouseLeave={onImgLeave}
                style={{ ...canvasSizeStyle, userSelect: "none" }}
              />
              {roiOverlay}
            </div>
          ) : (
            <div className="stage__empty">
              Enter R/G/B m/z values and Render
            </div>
          ))}

        {/* Blend — opacity overlay of the TIC / ion / RGB layers */}
        {view === "blend" &&
          (tic || ionImage || multiChannel?.images || opticalPlaced ? (
            <div className="imgframe">
              <canvas
                ref={blendCanvasRef}
                className="cross"
                data-testid="blend-canvas"
                onMouseDown={onImgDown}
                onMouseMove={onImgMove}
                onMouseUp={onImgUp}
                onMouseLeave={onImgLeave}
                style={{ ...canvasSizeStyle, userSelect: "none" }}
              />
              {roiOverlay}
            </div>
          ) : (
            <div className="stage__empty">
              No layers to blend yet — load an overview and render an ion image.
            </div>
          ))}

        {/* Render progress — determinate bar while an ion/multi render streams row
            groups (reassures during slow remote reads instead of a frozen button). */}
        {isRendering && (
          <div className="stage__render" role="status" aria-live="polite" data-testid="render-progress">
            <span className="stage__render-label">
              {/* The first render reads the whole file once to build the in-memory
                  index; later renders are instant, so this is "Building index…". */}
              {ionIndexReady ? "Rendering…" : "Building index…"}
              {renderProgress
                ? ` ${Math.round((100 * renderProgress.done) / Math.max(1, renderProgress.total))}%`
                : ""}
            </span>
            <div className="stage__render-track">
              <div
                className={`stage__render-bar${renderProgress ? "" : " stage__render-bar--indeterminate"}`}
                style={
                  renderProgress
                    ? { width: `${(100 * renderProgress.done) / Math.max(1, renderProgress.total)}%` }
                    : undefined
                }
              />
            </div>
          </div>
        )}

        {/* Floating legend (tic / ion — not multi) */}
        {showLegend && (
          <div className="stage__legend">
            <ColormapScale colormap={colormap} onStage low="0" high="max" />
          </div>
        )}

        {/* Zoom control (any image view). Wheel over the stage also zooms. */}
        {(ticHasImage ||
          ionHasImage ||
          (view === "optical" && !!opticalPlaced) ||
          (view === "multi" && !!multiChannel?.images) ||
          (view === "blend" &&
            (!!tic || !!ionImage || !!multiChannel?.images || !!opticalPlaced))) && (
          <div className="stage__zoom" role="group" aria-label="Zoom">
            <button className="iconbtn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
              −
            </button>
            <button className="stage__zoom-pct" aria-label="Reset zoom" onClick={zoomReset}>
              {Math.round(zoom * 100)}%
            </button>
            <button className="iconbtn" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
              +
            </button>
          </div>
        )}

        {/* Floating hover readout */}
        {readout.text && (
          <div className="stage__readout">
            {view === "overview" ? (
              <span data-testid="tic-hover-readout">{readout.text}</span>
            ) : (
              readout.text
            )}
          </div>
        )}
        {/* Keep tic-hover-readout in the DOM for the overview view even when
            the readout text is empty (contract references the testid). */}
        {view === "overview" && !readout.text && (
          <span
            data-testid="tic-hover-readout"
            style={{ display: "none" }}
          />
        )}

        {/* Ion stats (ion view) + ROI count (ANY view), below the readout. */}
        {((view === "ion" && ionImageStats) ||
          (roiIndices && roiIndices.length > 0)) && (
          <div
            className="stage__readout"
            style={{ top: "auto", bottom: "var(--space-6)", right: "var(--space-6)" }}
          >
            {roiIndices && roiIndices.length > 0 && (
              <div>
                ROI: {roiIndices.length} pixel
                {roiIndices.length !== 1 ? "s" : ""} selected
              </div>
            )}
            {view === "ion" && ionImageStats && grid && (
              <div data-testid="ion-stats">
                {ionImageStats.nonzeroCount} / {grid.filledCount} px · range{" "}
                {formatCompact(ionImageStats.min)}–
                {formatCompact(ionImageStats.max)} · {scale} (
                {Math.round(percentile * 100)}th pct)
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
