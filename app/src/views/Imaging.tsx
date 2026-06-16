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
import type { ImagingGridWire, OpticalImageMeta, SpectrumArrays } from "@mzpeak/contracts";
import { rebuildCoordMap } from "@mzpeak/core";
import { SpectrumPlot } from "@mzpeak/ui-kit";
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
import { gaussianSmooth } from "../compute/smooth";
import { histogramEqualize, type HistogramMode } from "../compute/histogram";
import {
  encodeSingleChannelTiff,
  encodeRgba8Tiff,
  downloadTiff,
} from "../export/tiff";

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

/** Stretch a decoded optical image (native size) onto the grid box (w×h) and read
 *  back its RGBA so it can be alpha-composited alongside the data layers. */
function opticalToGrid(decoded: DecodedOptical, w: number, h: number): Uint8ClampedArray | null {
  const src = document.createElement("canvas");
  src.width = decoded.width;
  src.height = decoded.height;
  const sctx = src.getContext("2d");
  if (!sctx) return null;
  blit(sctx, decoded.rgba, decoded.width, decoded.height);
  const dst = document.createElement("canvas");
  dst.width = w;
  dst.height = h;
  const dctx = dst.getContext("2d");
  if (!dctx) return null;
  dctx.imageSmoothingEnabled = false;
  dctx.drawImage(src, 0, 0, w, h);
  return new Uint8ClampedArray(dctx.getImageData(0, 0, w, h).data);
}

// mzPeakIV's false-colour channel tokens (--channel-r/g/b).
const CHANNEL_COLORS = ["#e53935", "#43a047", "#1e88e5"] as const; // R / G / B
const CHANNEL_LABELS = ["Red", "Green", "Blue"] as const;

/** Overlay layer identities, ordered top→bottom in the layers panel. */
type LayerKey = "ion" | "rgb" | "tic" | "optical";
const LAYER_LABEL: Record<LayerKey, string> = {
  ion: "Ion image",
  rgb: "RGB channels",
  tic: "TIC",
  optical: "Optical",
};
/** Where each empty layer's data comes from — shown as a hint when unavailable. */
const LAYER_HINT: Record<LayerKey, string> = {
  ion: "render in the Ion image view",
  rgb: "render in the RGB channels view",
  tic: "no per-pixel TIC in this file",
  optical: "no embedded optical image",
};

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
      // route=false: fill the in-place spectrum dock without leaving the imaging view.
      // Pass the pixel coords so the pick round-trips as `px=x,y` in the share URL (MG-01).
      onPickSpectrum={(idx, pixel) => void selectSpectrum(idx, false, pixel)}
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
  onPickSpectrum: (spectrumIndex: number, pixel: { x: number; y: number }) => void;
}) {
  const { width, height, originX, originY, presenceMask } = grid;
  const coordMap = useMemo(() => rebuildCoordMap(grid), [grid]);

  // Selected spectrum (filled in-place by pixel-pick; shared with the Spectra view).
  const spectrum = useStore((s) => s.spectrum);
  const spectrumLoading = useStore((s) => s.spectrumLoading);
  const selector = useStore((s) => s.selector);
  // The pixel whose spectrum is in the dock (absolute 1-based IMS coords + index).
  const [picked, setPicked] = useState<{ x: number; y: number; index: number } | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  // Keyboard cursor cell (0-based local) for accessible pixel picking without a mouse.
  const [kbCell, setKbCell] = useState<{ x: number; y: number } | null>(null);

  // ── Shared display controls ───────────────────────────────────────────────
  const [colormap, setColormap] = useState<Colormap>("viridis");
  const [logScale, setLogScale] = useState(false);
  // BL-01 — TIC normalization of the ion layer (divide each pixel by its TIC).
  // Only meaningful when a per-pixel TIC column exists (`tic`).
  const [ticNorm, setTicNorm] = useState(false);
  // BL-04 — Gaussian smoothing σ (pixels) applied to the ion image before raster.
  // 0 = off. Main-thread, presence-mask-aware (see ../compute/smooth).
  const [smoothSigma, setSmoothSigma] = useState(0);
  // BL-07 — histogram equalization of the ion image before raster (../compute/histogram).
  const [contrast, setContrast] = useState<HistogramMode>("none");
  // Used to name the exported TIFF (BL-05).
  const fileName = useStore((s) => s.fileName);

  // ── Aux spectrum (BL-03 mean / BL-06 ROI) ─────────────────────────────────
  // A derived spectrum (whole-image mean or ROI mean) shown in a panel below the
  // canvas. Local state — never routed to the store. `count` = pixels averaged.
  const [auxSpectrum, setAuxSpectrum] = useState<
    { kind: "mean" | "roi"; spectrum: SpectrumArrays; count: number } | null
  >(null);
  const [auxBusy, setAuxBusy] = useState(false);

  // ── Ion-image state ───────────────────────────────────────────────────────
  // The rendered ion image + RGB composite live in the store (not local state) so
  // they persist across tab switches and the Overlay view can composite them.
  // The m/z+tol inputs are mirrored into store.ionRequest (MG-01) so a ?ion= deep
  // link round-trips; on mount we prefill from store.ionRequest when present.
  const ionRequest = useStore((s) => s.ionRequest);
  const setIonRequestStore = useStore((s) => s.setIonRequest);
  const setRgbChannelsStore = useStore((s) => s.setRgbChannels);
  const storeRgbChannels = useStore((s) => s.rgbChannels);
  // MG-01: ROI rectangle round-trip (absolute IMS corners) for the ?roi= deep link.
  const storeRoiRect = useStore((s) => s.roiRect);
  const setRoiRectStore = useStore((s) => s.setRoiRect);
  // The last ROI rect (absolute, "x0,y0,x1,y1") we ran — guards the deep-link effect
  // from re-running the user's own draw and from looping when runRoiSpectrum sets the store.
  const lastRoiRunRef = useRef<string | null>(null);
  const [mz, setMz] = useState(() => (ionRequest ? String(ionRequest.mz) : ""));
  const [tol, setTol] = useState(() => (ionRequest ? String(ionRequest.tolDa) : "0.5"));
  const ionImage = useStore((s) => s.ionImage);
  const ionStats = useStore((s) => s.ionStats);
  const setIonImageStore = useStore((s) => s.setIonImage);
  // True once the background prefetch has warmed the ion-image cache (any m/z is instant).
  const ionCacheReady = useStore((s) => s.ionCacheReady);

  // ── Multi-channel (RGB) state ─────────────────────────────────────────────
  // Mirrored into store.rgbChannels (MG-01) so a ?ch= deep link round-trips; on
  // mount we prefill the three R/G/B rows from store.rgbChannels when present.
  const [channels, setChannels] = useState<{ mz: string; tol: string }[]>(() => {
    const base = [
      { mz: "", tol: "0.5" },
      { mz: "", tol: "0.5" },
      { mz: "", tol: "0.5" },
    ];
    // Restore each channel to its OWN R/G/B row by matching its color — not
    // positionally — so a ?ch= link that filled only Green+Blue round-trips back
    // into the Green+Blue rows (positional restore would shift them to Red+Green).
    storeRgbChannels.forEach((c) => {
      const row = (CHANNEL_COLORS as readonly string[]).indexOf(c.color);
      if (row >= 0) base[row] = { mz: String(c.mz), tol: String(c.tolDa) };
    });
    return base;
  });
  const multi = useStore((s) => s.multiChannel);
  const setMultiChannelStore = useStore((s) => s.setMultiChannel);

  // ── Overlay layer ordering (top→bottom) + per-layer visibility/opacity ─────
  // mzPeakIV blends a *fixed* optical→TIC→RGB→ion stack; here the order is
  // user-controllable. Default mirrors mzPeakIV (ion on top, optical at the back).
  const [layerOrder, setLayerOrder] = useState<LayerKey[]>(["ion", "rgb", "tic", "optical"]);
  const [layerCfg, setLayerCfg] = useState<Record<LayerKey, { visible: boolean; opacity: number }>>({
    ion: { visible: true, opacity: 0.8 },
    rgb: { visible: true, opacity: 1 },
    tic: { visible: true, opacity: 0.7 },
    optical: { visible: true, opacity: 1 },
  });

  // ── Optical state ─────────────────────────────────────────────────────────
  const hasOptical = opticalImages.length > 0;
  const [selectedOpticalPath, setSelectedOpticalPath] = useState<string | null>(
    opticalImages[0]?.archivePath ?? null,
  );
  const [decoded, setDecoded] = useState<Record<string, DecodedOptical>>({});
  const [opticalErr, setOpticalErr] = useState<Record<string, string>>({});
  const opticalGen = useRef(0);

  const [busy, setBusy] = useState(false);
  // Ion-render progress (filled cells) — drives the progress bar while a render is in flight.
  const [renderProgress, setRenderProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState<{ x: number; y: number; key: number } | null>(null);
  // BL-06 — rectangle-drag ROI selection (local 0-based cells). `start` is the
  // mousedown cell; `current` tracks the pointer. A move of >0 cells in x or y
  // promotes the gesture from a single-pixel click to an ROI mean.
  const [roiDrag, setRoiDrag] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // Set on mouseup when the gesture was an ROI drag, so the trailing native
  // `click` is suppressed and does NOT also fire a single-pixel pick.
  const roiHandledRef = useRef(false);

  // ── Reset optical state when the FILE changes (new opticalImages set) ──────
  // Bump the gen so any in-flight decode from the previous file is dropped, clear the per-path
  // decode/error caches, and re-seed the selected path. Without this the gen guard was dead
  // (never incremented) and the caches leaked across an imaging→imaging file switch.
  useEffect(() => {
    opticalGen.current++;
    setDecoded({});
    setOpticalErr({});
    setSelectedOpticalPath(opticalImages[0]?.archivePath ?? null);
  }, [opticalImages]);

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
    // Mirror the request into the store so a ?ion= deep link round-trips (MG-01).
    setIonRequestStore({ mz: mzNum, tolDa: tolNum });
    setBusy(true);
    setError(null);
    setRenderProgress({ done: 0, total: 0 });
    try {
      const res = await engine.renderIonImage(
        mzNum,
        tolNum,
        (done, total) => setRenderProgress({ done, total }),
        // Progressive preview: draw each partial image so a cold render fills in live.
        (ionImage, stats) => setIonImageStore(ionImage, stats),
      );
      setIonImageStore(res.ionImage, res.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIonImageStore(null, null);
    } finally {
      setBusy(false);
      setRenderProgress(null);
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
    // Mirror the valid channels (with their R/G/B color) into the store so a ?ch=
    // deep link round-trips (MG-01).
    setRgbChannelsStore(
      reqs.flatMap((r, i) => (r ? [{ mz: r.mz, tolDa: r.tolDa, color: CHANNEL_COLORS[i]! }] : [])),
    );
    setBusy(true);
    setError(null);
    try {
      const images = await engine.renderMultiChannel(reqs, (partial) =>
        // Progressive preview: draw each partial RGB composite as the cold build fills in.
        setMultiChannelStore(partial),
      );
      setMultiChannelStore(images);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMultiChannelStore(null);
    } finally {
      setBusy(false);
    }
  }

  // BL-03 — whole-image mean / reference spectrum. The engine aggregates across
  // all (or sampled) pixels; we stash the result in `auxSpectrum` for the panel.
  async function runMeanSpectrum() {
    if (auxBusy) return;
    setAuxBusy(true);
    setError(null);
    try {
      const s = await engine.meanSpectrum();
      setAuxSpectrum({ kind: "mean", spectrum: s, count: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuxBusy(false);
    }
  }

  // BL-06 — collect the spectrum indices enclosed by an ROI rectangle (local
  // 0-based cells, inclusive), skipping absent cells, then mean them via the engine.
  async function runRoiSpectrum(a: { x: number; y: number }, b: { x: number; y: number }) {
    if (auxBusy) return;
    const x0 = Math.max(0, Math.min(a.x, b.x));
    const x1 = Math.min(width - 1, Math.max(a.x, b.x));
    const y0 = Math.max(0, Math.min(a.y, b.y));
    const y1 = Math.min(height - 1, Math.max(a.y, b.y));
    const indices: number[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = y * width + x;
        if (presenceMask[key] === 0) continue;
        const idx = coordMap.get(key);
        if (idx != null) indices.push(idx);
      }
    }
    if (indices.length === 0) {
      setError("ROI contains no data pixels.");
      return;
    }
    // Record the rect as ABSOLUTE IMS corners so the selection round-trips as ?roi=.
    // Track it in lastRoiRunRef first so the deep-link effect doesn't re-run this draw.
    const absRect: [number, number, number, number] = [x0 + originX, y0 + originY, x1 + originX, y1 + originY];
    lastRoiRunRef.current = absRect.join(",");
    setRoiRectStore(absRect);
    setAuxBusy(true);
    setError(null);
    try {
      const s = await engine.roiSpectrum(indices);
      setAuxSpectrum({ kind: "roi", spectrum: s, count: indices.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuxBusy(false);
    }
  }

  // MG-01: render the region-mean for a ?roi= deep link. When store.roiRect is set by
  // urlSync (not by our own draw — guarded via lastRoiRunRef) convert the absolute
  // corners → local cells and run the ROI mean, reflecting the shared link.
  useEffect(() => {
    if (!storeRoiRect) return;
    if (auxBusy) return; // a mean/ROI is already computing — retry when it settles (auxBusy dep)
    const key = storeRoiRect.join(",");
    if (key === lastRoiRunRef.current) return; // our own draw, or already run
    lastRoiRunRef.current = key; // advance only now (not while busy) so the run can't be dropped
    const [ax, ay, bx, by] = storeRoiRect;
    void runRoiSpectrum(
      { x: ax - originX, y: ay - originY },
      { x: bx - originX, y: by - originY },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeRoiRect, auxBusy]);

  // ── BL-04 smooth + BL-07 contrast — applied on the MAIN THREAD to the ion
  // image BEFORE rasterizing. Both are pure, presence-mask-aware transforms over
  // a Float32Array (see ../compute/smooth, ../compute/histogram). The displayed
  // array feeds both the ion-mode paint and the overlay ion layer, plus the
  // single-channel TIFF export. Recomputed only when an input actually changes. ─
  const displayIonImage = useMemo<Float32Array | null>(() => {
    if (!ionImage) return null;
    let a = ionImage;
    if (smoothSigma > 0) a = gaussianSmooth(a, width, height, presenceMask, smoothSigma);
    if (contrast === "equalize") a = histogramEqualize(a, presenceMask, contrast);
    return a;
  }, [ionImage, smoothSigma, contrast, width, height, presenceMask]);

  // ── BL-05 — Export the rendered image as a TIFF ───────────────────────────
  // ion → single-channel 32-bit float of the DISPLAYED ion array (post smooth +
  // contrast) at grid resolution. multi → the composited RGB read back from the
  // canvas (encodeRgba8Tiff drops alpha → encodeRgbTiff). Filename derives from
  // the open file + the active m/z.
  function exportTiff() {
    const base = (fileName ?? "image").replace(/\.[^.]+$/, "");
    if (mode === "ion" && displayIonImage) {
      const bytes = encodeSingleChannelTiff(displayIonImage, width, height);
      const mzTag = mz !== "" ? `_mz${mz}` : "";
      downloadTiff(bytes, `${base}${mzTag}.tiff`);
      return;
    }
    if (mode === "multi" && multi) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const rgba = new Uint8ClampedArray(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      );
      const bytes = encodeRgba8Tiff(rgba, canvas.width, canvas.height);
      downloadTiff(bytes, `${base}_rgb.tiff`);
    }
  }

  // BL-05 — the Export TIFF button only applies to single-channel ion and RGB
  // multi modes, and only once an image has actually rendered.
  const canExportTiff =
    (mode === "ion" && !!displayIonImage) || (mode === "multi" && !!multi);

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
      if (!displayIonImage) return;
      canvas.width = width;
      canvas.height = height;
      blit(ctx, rasterizeImage(displayIonImage, grid, { colormap, percentile: 0.99, logScale, tic: ticNorm ? tic : null, ticNorm }), width, height);
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
      // Composite all available layers in the user-defined stacking order. Each
      // layer is alpha-over'd (premultiplied) bottom→top onto the dark stage —
      // the same blend mzPeakIV uses, but with a reorderable stack.
      canvas.width = width;
      canvas.height = height;
      const n = width * height;
      const out = new Uint8ClampedArray(n * 4);
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        out[o] = 14; out[o + 1] = 18; out[o + 2] = 22; out[o + 3] = 255; // --ink
      }
      const rasterizeLayer = (key: LayerKey): Uint8ClampedArray | null => {
        if (key === "tic") return tic ? rasterizeTic(tic, grid, colormap, logScale) : null;
        if (key === "ion") return displayIonImage ? rasterizeImage(displayIonImage, grid, { colormap, percentile: 0.99, logScale, tic: ticNorm ? tic : null, ticNorm }) : null;
        if (key === "rgb") return multi ? rasterizeMultiChannel(multi, grid, null, false) : null;
        if (key === "optical") return decodedOptical ? opticalToGrid(decodedOptical, width, height) : null;
        return null;
      };
      // layerOrder is top→bottom; paint bottom→top.
      for (let li = layerOrder.length - 1; li >= 0; li--) {
        const key = layerOrder[li]!;
        const cfg = layerCfg[key];
        if (!cfg.visible || cfg.opacity <= 0) continue;
        const rgba = rasterizeLayer(key);
        if (!rgba) continue;
        const a = cfg.opacity;
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          const la = a * (rgba[o + 3]! / 255);
          const inv = 1 - la;
          out[o] = rgba[o]! * la + out[o]! * inv;
          out[o + 1] = rgba[o + 1]! * la + out[o + 1]! * inv;
          out[o + 2] = rgba[o + 2]! * la + out[o + 2]! * inv;
        }
      }
      blit(ctx, out, width, height);
    }
  }, [
    mode,
    tic,
    ionImage,
    displayIonImage,
    multi,
    decodedOptical,
    layerOrder,
    layerCfg,
    grid,
    width,
    height,
    colormap,
    logScale,
    ticNorm,
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
      // floor (not round) so the fitted image never exceeds the box by a sub-pixel and
      // spuriously triggers a scrollbar (which would feed back into this fit → jitter).
      setDisplaySize({ w: Math.floor(w), h: Math.floor(h) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [intrinsic.w, intrinsic.h]);

  const canvasSizeStyle: React.CSSProperties = displaySize
    ? { width: displaySize.w * zoom, height: displaySize.h * zoom }
    : { aspectRatio: `${intrinsic.w} / ${intrinsic.h}`, maxWidth: "100%", maxHeight: "100%" };

  // ── Pointer handlers (pixel pick + hover readout + ROI drag) — grid modes ──
  const pickable = mode !== "optical";
  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!pickable) return;
    const hit = toGridCoord(e, e.currentTarget, width, height);
    setReadout(hit);
    // BL-06 — while dragging, extend the ROI rectangle to the current cell.
    if (roiDrag && hit) {
      setRoiDrag((d) => (d ? { ...d, current: { x: hit.x, y: hit.y } } : d));
    }
  }
  function onLeave() {
    setReadout(null);
    // Abandon an in-flight ROI drag if the pointer leaves the canvas (the mouseup
    // would land outside and never fire here) — avoids a stuck rectangle.
    if (roiDrag) setRoiDrag(null);
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!pickable || e.button !== 0) return;
    const hit = toGridCoord(e, e.currentTarget, width, height);
    if (!hit) return;
    setRoiDrag({ start: { x: hit.x, y: hit.y }, current: { x: hit.x, y: hit.y } });
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!pickable) return;
    const drag = roiDrag;
    setRoiDrag(null);
    if (!drag) return;
    const hit = toGridCoord(e, e.currentTarget, width, height);
    const end = hit ?? drag.current;
    const moved = end.x !== drag.start.x || end.y !== drag.start.y;
    // A drag that moved ≥1 cell in x or y is an ROI; otherwise let onClick fire
    // the existing single-pixel pick (we do NOT pick here to avoid double-firing).
    roiHandledRef.current = moved;
    if (moved) void runRoiSpectrum(drag.start, end);
  }
  // Pick the cell at local (x0,y0) — shared by mouse click and keyboard Enter.
  function pickCell(x0: number, y0: number) {
    const key = y0 * width + x0;
    if (presenceMask[key] === 0) return; // no-data cell
    const idx = coordMap.get(key);
    if (idx != null) {
      setPicked({ x: x0 + originX, y: y0 + originY, index: idx });
      setDockOpen(true);
      onPickSpectrum(idx, { x: x0 + originX, y: y0 + originY }); // store.spectrum in-place (route=false) + px provenance
    }
  }

  // Reflect a `?px=x,y` deep link (store selector by:"pixel", set by urlSync → selectPixel)
  // into the dock, so a shared pixel link opens the spectrum the same as a manual pick.
  useEffect(() => {
    if (selector?.by !== "pixel") return;
    if (picked && picked.index === selector.index && picked.x === selector.x && picked.y === selector.y) return;
    setPicked({ x: selector.x, y: selector.y, index: selector.index });
    setDockOpen(true);
  }, [selector, picked]);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!pickable) return;
    // Suppress the click that trails an ROI drag (it would re-fire a pixel pick).
    if (roiHandledRef.current) {
      roiHandledRef.current = false;
      return;
    }
    const hit = toGridCoord(e, e.currentTarget, width, height);
    if (!hit) return;
    pickCell(hit.x, hit.y);
  }

  // Keyboard pixel picking (a11y): arrows move a cursor cell, Enter/Space picks it.
  function onCanvasKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!pickable) return;
    const cur = kbCell ?? { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    let { x, y } = cur;
    switch (e.key) {
      case "ArrowLeft": x = Math.max(0, x - 1); break;
      case "ArrowRight": x = Math.min(width - 1, x + 1); break;
      case "ArrowUp": y = Math.max(0, y - 1); break;
      case "ArrowDown": y = Math.min(height - 1, y + 1); break;
      case "Enter":
      case " ":
        e.preventDefault();
        pickCell(cur.x, cur.y);
        return;
      default:
        return;
    }
    e.preventDefault();
    setKbCell({ x, y });
    setReadout({ x, y, key: y * width + x });
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
    (mode === "overlay" && (!!ionImage || !!multi || !!tic || !!decodedOptical));

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
            {ionCacheReady && !busy && (
              <span
                data-testid="ion-cache-ready"
                title="The background prefetch has decoded this file's spectra into memory — any m/z window now renders instantly, with no further network reads."
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  height: 30,
                  padding: "0 0.55rem",
                  fontSize: "0.75rem",
                  color: "var(--success, #2e9e5b)",
                  background: "var(--success-subtle, #eafaf0)",
                  border: "1px solid var(--success-soft, #43a047)",
                  borderRadius: 6,
                  whiteSpace: "nowrap",
                }}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Ion images ready · instant
              </span>
            )}
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

        {/* TIC norm (BL-01) — ion + overlay only; needs a per-pixel TIC column. */}
        {(mode === "ion" || mode === "overlay") && (
          <Field label="Normalize">
            <label
              title={tic ? "Divide each pixel's intensity by its total ion current" : "No per-pixel TIC in this file"}
              style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.85rem", height: 30 }}
            >
              <input
                type="checkbox"
                checked={ticNorm}
                disabled={!tic}
                aria-label="TIC normalize"
                data-testid="imaging-ticnorm"
                onChange={(e) => setTicNorm(e.target.checked)}
              />
              TIC norm
            </label>
          </Field>
        )}

        {/* Smooth σ (BL-04) + Contrast (BL-07) — ion + overlay; applied to the
            ion image on the main thread before rasterizing. */}
        {(mode === "ion" || mode === "overlay") && (
          <>
            <Field label="Smooth σ">
              <input
                type="number"
                min={0}
                max={5}
                step={0.5}
                value={smoothSigma}
                aria-label="smoothing sigma"
                title="Gaussian smoothing radius in pixels (0 = off)"
                data-testid="imaging-smooth"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSmoothSigma(Number.isFinite(v) ? Math.max(0, Math.min(5, v)) : 0);
                }}
                style={inputStyle(70)}
              />
            </Field>
            <Field label="Contrast">
              <select
                value={contrast}
                aria-label="contrast"
                title="Intensity remapping applied to the ion image"
                data-testid="imaging-contrast"
                onChange={(e) => setContrast(e.target.value as HistogramMode)}
                style={inputStyle(110)}
              >
                <option value="none">None</option>
                <option value="equalize">Equalize</option>
              </select>
            </Field>
          </>
        )}

        {/* Export TIFF (BL-05) — ion (single-channel float) + multi (RGB). */}
        {(mode === "ion" || mode === "multi") && (
          <button
            type="button"
            onClick={exportTiff}
            disabled={!canExportTiff}
            data-testid="export-tiff-btn"
            style={{ ...btnStyle, background: "var(--surface-card, #fff)", color: "var(--blue-600, #3b54da)" }}
          >
            Export TIFF
          </button>
        )}

        {/* Mean / reference spectrum (BL-03) — grid (pickable) modes only. */}
        {pickable && (
          <button
            type="button"
            onClick={() => void runMeanSpectrum()}
            disabled={auxBusy}
            data-testid="imaging-mean-spectrum-button"
            style={{ ...btnStyle, background: "var(--surface-card, #fff)", color: "var(--blue-600, #3b54da)" }}
          >
            {auxBusy ? "Computing…" : "Mean spectrum"}
          </button>
        )}

        {/* Zoom controls */}
        <div style={{ display: "flex", gap: "0.25rem", marginLeft: "auto" }}>
          <button type="button" aria-label="zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.3))} style={zoomBtn}>−</button>
          <button type="button" aria-label="reset zoom" onClick={() => setZoom(1)} style={zoomBtn}>{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label="zoom in" onClick={() => setZoom((z) => Math.min(8, z * 1.3))} style={zoomBtn}>+</button>
        </div>
      </div>

      {mode === "ion" && busy && renderProgress && (
        <IonRenderProgress done={renderProgress.done} total={renderProgress.total} />
      )}

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
            // Reserve the scrollbar gutter permanently (both edges → image stays centered) so
            // a scrollbar appearing on hover/zoom can't change clientWidth and re-trigger the
            // contain-fit ResizeObserver — which is what made the image "jump".
            scrollbarGutter: "stable both-edges",
            background: "var(--ink, #0e1216)",
            borderRadius: 8,
            padding: "0.75rem",
          }}
        >
          {hasContent ? (
            <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
              <canvas
                ref={canvasRef}
                onMouseMove={onMove}
                onMouseLeave={onLeave}
                onMouseDown={onMouseDown}
                onMouseUp={onMouseUp}
                onClick={onClick}
                onKeyDown={onCanvasKeyDown}
                onFocus={() => pickable && kbCell == null && setKbCell({ x: Math.floor(width / 2), y: Math.floor(height / 2) })}
                onBlur={() => setKbCell(null)}
                tabIndex={pickable ? 0 : -1}
                data-testid="imaging-canvas"
                aria-label={`${mode} image, ${width} by ${height} pixels.${pickable ? " Use arrow keys to move the cursor and Enter to inspect a pixel's spectrum, or click a pixel, or drag a rectangle to average a region." : ""}`}
                style={{
                  ...canvasSizeStyle,
                  imageRendering: "pixelated",
                  cursor: pickable ? "crosshair" : "default",
                  userSelect: "none",
                  display: "block",
                }}
              />
              {/* BL-06 — translucent ROI rectangle while dragging. Positioned by
                  percentage of the grid (cells are local 0-based, inclusive). */}
              {pickable && roiDrag && (() => {
                const x0 = Math.min(roiDrag.start.x, roiDrag.current.x);
                const x1 = Math.max(roiDrag.start.x, roiDrag.current.x);
                const y0 = Math.min(roiDrag.start.y, roiDrag.current.y);
                const y1 = Math.max(roiDrag.start.y, roiDrag.current.y);
                return (
                  <div
                    data-testid="imaging-roi-rect"
                    aria-hidden
                    style={{
                      position: "absolute",
                      pointerEvents: "none",
                      left: `${(x0 / width) * 100}%`,
                      top: `${(y0 / height) * 100}%`,
                      width: `${((x1 - x0 + 1) / width) * 100}%`,
                      height: `${((y1 - y0 + 1) / height) * 100}%`,
                      border: "1px solid var(--accent, #3b54da)",
                      background: "var(--accent, #3b54da)",
                      opacity: 0.25,
                      boxSizing: "border-box",
                    }}
                  />
                );
              })()}
            </div>
          ) : (
            <EmptyState mode={mode} hasOptical={hasOptical} opticalErr={selectedOpticalPath ? opticalErr[selectedOpticalPath] : undefined} />
          )}
        </div>

        {/* Overlay → layers panel; single-channel modes → colormap legend. */}
        {mode === "overlay" ? (
          <LayersPanel
            order={layerOrder}
            setOrder={setLayerOrder}
            cfg={layerCfg}
            setCfg={setLayerCfg}
            avail={{ ion: !!ionImage, rgb: !!multi, tic: !!tic, optical: !!decodedOptical }}
            colormap={colormap}
            // optical is embedded but still decoding → show a "decoding" hint, not "none".
            opticalPending={
              hasOptical && !decodedOptical && !(selectedOpticalPath && opticalErr[selectedOpticalPath])
            }
          />
        ) : showColormapControls && hasContent ? (
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
        ) : null}
      </div>

      {/* ── Hover / pick readout ─────────────────────────────────────────── */}
      {pickable && (
        <p data-testid="imaging-readout" style={{ minHeight: "1.2em", fontSize: "0.8rem", color: "var(--text-muted, #94a3b8)", margin: 0 }}>
          {readoutText}
        </p>
      )}

      {/* ── Persistent spectrum dock ─────────────────────────────────────────
          Pixel-pick fills store.spectrum in-place (route=false) and shows it here
          without leaving the imaging view. The full Spectra view stays in sync. */}
      {pickable && picked && (
        <div
          data-testid="imaging-spectrum-dock"
          style={{
            flexShrink: 0,
            border: "1px solid var(--border-default, #e2e8f0)",
            borderRadius: 8,
            background: "var(--surface-card, #fff)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.4rem 0.6rem",
              borderBottom: dockOpen ? "1px solid var(--border-default, #e2e8f0)" : "none",
              fontSize: "0.78rem",
              color: "var(--text-secondary, #475569)",
            }}
          >
            <strong style={{ color: "var(--text-heading, #1e293b)" }}>Spectrum</strong>
            <span data-testid="imaging-dock-meta" style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-muted, #94a3b8)" }}>
              pixel (x: {picked.x}, y: {picked.y}) · #{picked.index}
              {spectrumLoading
                ? " · loading…"
                : spectrum
                  ? ` · ${spectrum.mz.length} pts · ${spectrum.representation === "centroid" ? "centroid" : "profile"}`
                  : ""}
            </span>
            <button
              type="button"
              onClick={() => setDockOpen((o) => !o)}
              aria-expanded={dockOpen}
              data-testid="imaging-dock-toggle"
              style={{
                marginLeft: "auto",
                border: "1px solid var(--border-default, #e2e8f0)",
                borderRadius: 6,
                background: "var(--surface-card, #fff)",
                color: "var(--text-secondary, #475569)",
                fontSize: "0.75rem",
                padding: "0.1rem 0.5rem",
                cursor: "pointer",
              }}
            >
              {dockOpen ? "Collapse" : "Expand"}
            </button>
          </div>
          {dockOpen && (
            <div className="chart-host" style={{ height: 200, position: "relative" }} aria-live="polite">
              {/* Only plot the spectrum that matches the picked pixel — while a newer
                  pick is loading, store.spectrum still holds the PREVIOUS pixel's
                  spectrum, so plotting it under the new coords would be misleading. */}
              {spectrum && spectrum.index === picked.index ? (
                <SpectrumPlot spectrum={spectrum} xicWindow={null} />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-muted, #94a3b8)",
                    fontSize: "0.8rem",
                  }}
                >
                  Loading spectrum for pixel ({picked.x}, {picked.y})…
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Aux spectrum panel (BL-03 mean / BL-06 ROI) ───────────────────────
          A derived spectrum (whole-image mean or ROI mean) shown below the canvas.
          Local state only; cleared with the close (×) button. */}
      {auxSpectrum && (
        <div
          data-testid="imaging-mean-spectrum"
          style={{
            flexShrink: 0,
            border: "1px solid var(--border-default, #e2e8f0)",
            borderRadius: 8,
            background: "var(--surface-card, #fff)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.4rem 0.6rem",
              borderBottom: "1px solid var(--border-default, #e2e8f0)",
              fontSize: "0.78rem",
              color: "var(--text-secondary, #475569)",
            }}
          >
            <strong style={{ color: "var(--text-heading, #1e293b)" }}>
              {auxSpectrum.kind === "mean" ? "Mean spectrum" : `ROI mean — ${auxSpectrum.count} pixels`}
            </strong>
            <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-muted, #94a3b8)" }}>
              {auxSpectrum.spectrum.mz.length} pts
              {auxSpectrum.spectrum.representation === "centroid" ? " · centroid" : " · profile"}
            </span>
            <button
              type="button"
              onClick={() => setAuxSpectrum(null)}
              aria-label="close mean spectrum"
              data-testid="imaging-mean-spectrum-close"
              style={{
                marginLeft: "auto",
                border: "1px solid var(--border-default, #e2e8f0)",
                borderRadius: 6,
                background: "var(--surface-card, #fff)",
                color: "var(--text-secondary, #475569)",
                fontSize: "0.9rem",
                lineHeight: 1,
                padding: "0.1rem 0.5rem",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
          <div className="chart-host" style={{ height: 200, position: "relative" }} aria-live="polite">
            <SpectrumPlot spectrum={auxSpectrum.spectrum} xicWindow={null} />
          </div>
        </div>
      )}
    </section>
  );
}

/** Determinate progress bar shown while an ion image renders. `total === 0` (the brief
 *  window before the worker reports the cell count) shows an indeterminate sliver. */
function IonRenderProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div data-testid="ion-render-progress" role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: "0.6rem", margin: 0 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--surface-panel, #f1f5f9)", overflow: "hidden", maxWidth: 320 }}>
        <div
          data-testid="ion-render-progress-fill"
          style={{
            height: "100%",
            width: pct != null ? `${pct}%` : "35%",
            background: "var(--blue-600, #3b54da)",
            borderRadius: 3,
            transition: "width 0.15s",
            opacity: pct != null ? 1 : 0.6,
          }}
        />
      </div>
      <span style={{ fontSize: "var(--text-xs, 0.72rem)", color: "var(--text-muted, #94a3b8)", fontFamily: "var(--font-mono, monospace)", whiteSpace: "nowrap" }}>
        {pct != null ? `Rendering ion image… ${pct}%` : "Rendering ion image…"}
      </span>
    </div>
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
    // On the dark --ink stage: --text-muted (#6b757e) is only ~4.0:1; use the on-stage
    // token (~13:1) so the empty-state message meets WCAG AA. [adversarial review F-08]
    <p data-testid="imaging-empty" style={{ color: "var(--text-on-stage, #e7edf2)", fontSize: "0.85rem", textAlign: "center", maxWidth: 360 }}>
      {msg}
    </p>
  );
}

/** A small colour swatch identifying a layer's visual encoding. */
function layerSwatch(key: LayerKey, colormap: Colormap): string {
  if (key === "rgb") return `linear-gradient(90deg, ${CHANNEL_COLORS[0]}, ${CHANNEL_COLORS[1]}, ${CHANNEL_COLORS[2]})`;
  if (key === "optical") return "linear-gradient(135deg, #6b757e, #dde2e7)";
  return colormapGradientCss(colormap, "90deg"); // tic / ion → active colormap
}

/** Reorderable layer-stack widget for the Overlay view. Mirrors mzPeakIV's blend
 *  controls but adds drag-free up/down reordering, per-layer visibility, and a
 *  data-availability state. Layers are listed top→bottom (front of the stack
 *  first), matching the painting order on the canvas. */
function LayersPanel({
  order,
  setOrder,
  cfg,
  setCfg,
  avail,
  colormap,
  opticalPending,
}: {
  order: LayerKey[];
  setOrder: React.Dispatch<React.SetStateAction<LayerKey[]>>;
  cfg: Record<LayerKey, { visible: boolean; opacity: number }>;
  setCfg: React.Dispatch<React.SetStateAction<Record<LayerKey, { visible: boolean; opacity: number }>>>;
  avail: Record<LayerKey, boolean>;
  colormap: Colormap;
  opticalPending: boolean;
}) {
  // Adjacent swap (keyboard arrows on the drag handle — the accessible fallback).
  function move(i: number, dir: -1 | 1) {
    setOrder((o) => {
      const j = i + dir;
      if (j < 0 || j >= o.length) return o;
      const next = o.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }
  // Move item `from` → position `to` (drag-and-drop drop).
  function moveTo(from: number, to: number) {
    if (from === to) return;
    setOrder((o) => {
      const next = o.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  }

  // Drag-and-drop transient state: which row is being dragged, and the row the
  // pointer is currently over (for the insertion indicator).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 18, alignSelf: "stretch", padding: 0, fontSize: "0.9rem", lineHeight: 1,
    border: "1px solid var(--border-strong, #c5ccd3)", borderRadius: 3,
    background: "var(--surface-sunken, #f4f6f8)", color: "var(--text-muted, #6b757e)",
    cursor: "grab", userSelect: "none", touchAction: "none",
  };
  return (
    <div
      data-testid="overlay-layers"
      style={{
        width: 248, flexShrink: 0, alignSelf: "stretch",
        border: "1px solid var(--border-hairline, #dde2e7)", borderRadius: 8,
        background: "var(--surface, #fff)", padding: "0.6rem", overflowY: "auto",
      }}
    >
      <div style={{ fontSize: "0.62rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted, #6b757e)", marginBottom: "0.5rem" }}>
        Layers
      </div>
      {order.map((key, i) => {
        const c = cfg[key];
        const has = avail[key];
        const dragging = dragIndex === i;
        const dropTarget = overIndex === i && dragIndex !== null && dragIndex !== i;
        return (
          <div
            key={key}
            data-testid={`overlay-layer-${key}`}
            // The whole row is a drop target; only the handle starts a drag, so the
            // opacity slider stays draggable on its own.
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (overIndex !== i) setOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) moveTo(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
            style={{
              display: "flex", flexDirection: "column", gap: "0.3rem",
              padding: "0.4rem", marginBottom: "0.35rem",
              border: "1px solid var(--border-soft, #e3e7eb)", borderRadius: 6,
              borderTop: dropTarget ? "2px solid var(--accent, #3b54da)" : undefined,
              background: has ? "var(--surface, #fff)" : "var(--surface-sunken, #f4f6f8)",
              opacity: dragging ? 0.4 : has ? 1 : 0.7,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              {/* Drag handle — drag to reorder; arrow keys move it (keyboard fallback). */}
              <div
                role="button"
                tabIndex={0}
                draggable
                aria-label={`Reorder ${LAYER_LABEL[key]} — drag, or use arrow keys`}
                title="Drag to reorder (or focus + ↑/↓)"
                data-testid={`overlay-layer-${key}-handle`}
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    move(i, -1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    move(i, 1);
                  }
                }}
                style={handleStyle}
              >
                ⠿
              </div>
              {/* Visibility */}
              <input
                type="checkbox" checked={c.visible} disabled={!has}
                aria-label={`${LAYER_LABEL[key]} visible`}
                data-testid={`overlay-layer-${key}-visible`}
                onChange={(e) => setCfg((s) => ({ ...s, [key]: { ...s[key], visible: e.target.checked } }))}
                style={{ accentColor: "var(--accent, #3b54da)" }}
              />
              {/* Swatch */}
              <span aria-hidden style={{ width: 22, height: 14, borderRadius: 3, background: layerSwatch(key, colormap), border: "1px solid var(--border-strong, #c5ccd3)", flexShrink: 0 }} />
              {/* Label */}
              <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-body, #353c43)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {LAYER_LABEL[key]}
              </span>
            </div>
            {has ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", paddingLeft: "1.4rem" }}>
                <input
                  type="range" min={0} max={100} step={1} value={Math.round(c.opacity * 100)}
                  disabled={!c.visible}
                  aria-label={`${LAYER_LABEL[key]} opacity`}
                  data-testid={`overlay-layer-${key}-opacity`}
                  onChange={(e) => setCfg((s) => ({ ...s, [key]: { ...s[key], opacity: Number(e.target.value) / 100 } }))}
                  style={{ flex: 1, accentColor: "var(--accent, #3b54da)", opacity: c.visible ? 1 : 0.4 }}
                />
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.68rem", color: "var(--text-muted, #6b757e)", minWidth: 30, textAlign: "right" }}>
                  {Math.round(c.opacity * 100)}%
                </span>
              </div>
            ) : (
              <span style={{ paddingLeft: "1.4rem", fontSize: "0.68rem", color: "var(--text-faint, #9aa4ad)" }}>
                {key === "optical" && opticalPending ? "decoding optical…" : LAYER_HINT[key]}
              </span>
            )}
          </div>
        );
      })}
    </div>
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
