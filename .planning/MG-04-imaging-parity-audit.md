# MG-04 · Imaging feature-parity AUDIT (mzPeakIV → merged viewer)

**Date:** 2026-06-16
**Scope:** Validation + documentation only. This is the HONEST wired/not-wired gap
list for the imaging (MSI) parity checklist (BL-01…BL-09 + BL-S3). **No feature was
implemented, migrated, or wired** as part of this audit.

**Method:** Read the merged app's imaging surface (`app/src/views/Imaging.tsx`,
`app/src/views/render.ts`, `app/src/views/Spectra.tsx`, `app/src/App.tsx`,
`app/src/store.ts`), the merged engine (`packages/core/src/engine/imaging.ts`,
`packages/core/src/client/EngineClient.ts`, `packages/core/src/worker/dispatch.ts`),
and cross-referenced the source repo at `/Users/kohlbach/Claude/mzPeakIV/src` to judge
parity feature-by-feature. "WIRED" = reachable by a user through the merged UI. An
engine method with no UI caller is **NOT-WIRED** for parity purposes (the capability
exists in `@mzpeak/core` but the merged app exposes no way to invoke it).

**Headline:** The prior review's suspicion is **confirmed**. The merged Imaging view
exposes only colormap (viridis / inferno / gray), linear/log scale, and a hard-coded
`percentile: 0.99` clip. **BL-04 (Gaussian smoothing), BL-05 (ion-image TIFF export),
and BL-07 (histogram contrast) are NOT wired** — none of their code (`smooth.ts`,
`tiff.ts`, `histogram.ts`) was ported to the merged repo at all. In addition,
**BL-01 (TIC normalization of the ion image), BL-03 (mean/reference spectrum), BL-06
(ROI → mean spectrum), and BL-09 (peak-click → ion image) are NOT wired in the UI** —
BL-03/BL-06 have engine support (`engineMeanSpectrum` / `engineRoiSpectrum`) but **no
caller in `app/src`**, and BL-01's rasteriser supports `ticNorm` but the view never
enables it. The BACKLOG.md parity table (lines 108–117) calling all of these
"implemented" describes **mzPeakIV**, not the merged shell — it overstates merged
parity for 7 of the 10 items.

---

## Per-item verdict

### BL-01 · TIC normalization (default render mode) — **NOT-WIRED** (mislabeled in backlog)

- **What IV did:** divide each pixel's ion-image intensity by that pixel's TIC before
  rasterising; ON by default with a Display-panel toggle (raw ↔ TIC-normalised),
  applied in the rasteriser with no re-fetch.
- **Merged state:** the rasteriser *plumbing* exists —
  `render.ts:146 rasterizeImage(... opts.ticNorm && opts.tic ...)` (line 157) and
  `rasterizeMultiChannel(... ticNorm ...)` (line 227/235) both accept a `ticNorm`
  flag + per-pixel `tic` array. **But the UI never uses it.** Every call site in
  `Imaging.tsx` passes `{ colormap, percentile: 0.99, logScale }` with **no `tic`
  and no `ticNorm`** (lines 335, 360). There is **no TIC-normalization toggle** in the
  Imaging controls (grep for `ticNorm|normaliz|Raw` in `Imaging.tsx` → none in the UI).
- **Note on the "overview" mode:** `overview` paints `store.ticColumn` as a raw
  per-pixel TIC *heatmap* (`Imaging.tsx:330 rasterizeTic`). That is a different feature
  (a TIC image), **not** BL-01's "normalize the ion image by TIC". They must not be
  conflated.
- **Verdict: NOT-WIRED.** Ion images are always rendered raw (never TIC-normalised),
  and the default is raw, contradicting BL-01's "ON by default".
- **Migration effort:** **S.** Engine/raster already support it. Add a "TIC norm"
  checkbox to the ion/overlay controls in `Imaging.tsx` and thread `store.ticColumn`
  + `ticNorm` into the `rasterizeImage`/`rasterizeMultiChannel` opts.
- **Attaches at:** `Imaging.tsx` controls block (~line 596) + the paint effect (lines
  335, 360–361).

### BL-02 · Multi-ion RGB overlay (1/2/3 channels) — **WIRED**

- **Merged state:** the `multi` mode renders three R/G/B m/z windows.
  `Imaging.tsx:284 renderMulti()` → `engine.renderMultiChannel(reqs, onPreview)`
  (`EngineClient.ts:446`), composited via `rasterizeMultiChannel` (`render.ts:227`).
  Three labelled inputs (Red/Green/Blue m/z + tolerance, `Imaging.tsx:559–581`),
  progressive preview, and store mirroring for the `?ch=` deep link.
- **Verdict: WIRED.** (Reachable via `nav-tab-multi` → "Render RGB".) Per-channel TIC
  normalization (a BL-01 sub-clause) is **not** wired — `renderMulti` paints with
  `rasterizeMultiChannel(multi, grid, null, false)` (`Imaging.tsx:340`), i.e.
  `tic=null, ticNorm=false`.

### BL-03 · Mean / reference spectrum — **NOT-WIRED** (engine-only)

- **What IV did:** a "Mean spectrum" button computes/display the dataset-wide mean
  spectrum (reference-axis binning), labelled "Mean spectrum (N=… pixels)".
- **Merged state:** the engine fully implements it —
  `engineMeanSpectrum` (`imaging.ts:712`) and the `meanSpectrum` worker message
  (`dispatch.ts:381`), surfaced on the client as `EngineClient.meanSpectrum()`
  (`EngineClient.ts:343`). There is even a unit test (`mean-cache.test.ts`).
  **But there is NO caller in `app/src`** — grep across `app/src` for
  `meanSpectrum` returns zero hits. No button, no store action, no view.
- **Verdict: NOT-WIRED.** Capability present in `@mzpeak/core`; the merged UI exposes
  no way to invoke it.
- **Migration effort:** **S.** Wire-up only (no engine work). Add a "Mean spectrum"
  button (Spectra header or Imaging dock) → `engine.meanSpectrum()` → render in the
  existing `SpectrumPlot`.
- **Attaches at:** `Spectra.tsx` header, or the imaging spectrum dock in `Imaging.tsx`
  (~line 711); plus a thin store action mirroring `selectSpectrum`.

### BL-04 · Gaussian 2D image smoothing — **NOT-WIRED** (not ported at all)

- **What IV did:** `src/compute/smooth.ts` — separable 2D Gaussian (σ 0–5 px,
  presence-mask-aware), applied in-worker before raster transfer; "Smooth σ" input.
- **Merged state:** **no smoothing code exists in the merged repo.** Grep for
  `gaussianSmooth|smoothGaussian|smooth.ts` across `packages/`+`app/` → nothing
  (the only `smooth` hits are CSS `scroll-behavior` and `imageSmoothingEnabled=false`).
  No engine op, no worker message, no control.
- **Verdict: NOT-WIRED. Confirmed.**
- **Migration effort:** **M.** Port `smooth.ts` into `@mzpeak/core`, add a `smooth`
  worker op (or apply post-render in the rasteriser), add a "Smooth σ" control. Cheapest
  variant: smooth the already-rendered `store.ionImage` Float32Array on the main thread
  before `rasterizeImage` (no worker round-trip).
- **Attaches at:** `Imaging.tsx` ion-mode controls + the paint effect (line 335);
  port target `packages/core/src/compute/` (new) or a main-thread helper in `render.ts`.

### BL-05 · Ion-image TIFF export — **NOT-WIRED** (not ported at all)

- **What IV did:** `src/export/tiff.ts` — single-channel 32-bit float + RGB 8-bit TIFF
  encoders + `downloadTiff` browser helper; an export button.
- **Merged state:** **no TIFF *encoder* / export code exists in the merged repo.**
  Grep for `encodeSingleChannelTiff|encodeRgbTiff|downloadTiff` → nothing. (Note: the
  merged repo *does* have `decodeTiff` in `packages/core/src/engine/optical.ts` — that
  is TIFF *decode* for the optical-image layer, the opposite direction, and unrelated to
  BL-05.) No export button anywhere in `Imaging.tsx`.
- **Verdict: NOT-WIRED. Confirmed.**
- **Migration effort:** **M.** Port `tiff.ts` (pure, dependency-free) into the app or
  ui-kit, add an "Export TIFF" button that encodes `store.ionImage` / `multiChannel` +
  grid dims and triggers a download. Pure client-side; no engine change needed.
- **Attaches at:** `Imaging.tsx` controls (ion + multi modes); port target
  `app/src/export/tiff.ts` or `@mzpeak/ui-kit`.

### BL-06 · ROI rectangle → mean spectrum — **NOT-WIRED** (engine-only, no draw UI)

- **What IV did:** draw a rectangle on the ion image → mean spectrum over the enclosed
  pixels (`roiSpectrum`, 100-index cap).
- **Merged state:** the engine implements it — `engineRoiSpectrum` (`imaging.ts:745`,
  100-index cap), `roiSpectrum` worker message (`dispatch.ts:389`),
  `EngineClient.roiSpectrum(indices)` (`EngineClient.ts:348`), with a unit test
  (`mean-cache.test.ts:57`). **But there is NO ROI-draw UI and NO caller in `app/src`**
  — grep for `roiSpectrum`/`roi`/`ROI` in `app/src` returns nothing. The canvas
  supports only single-pixel pick (`Imaging.tsx:464 onClick → pickCell`), not a
  drag-rectangle.
- **Verdict: NOT-WIRED.** Engine capability present; no rectangle-draw interaction and
  no client call. (This is also why `?roi=` has "no producer UI" per MG-01.)
- **Migration effort:** **M.** Add rectangle-drag state to the canvas, collect the
  enclosed `coordMap` indices, call `engine.roiSpectrum(indices)`, render in the dock.
  Engine work is done; this is UI + a store action.
- **Attaches at:** `Imaging.tsx` canvas pointer handlers (lines 443–469) + the spectrum
  dock (~line 711). Pairs naturally with the deferred `?roi=` producer (MG-01).

### BL-07 · Histogram contrast enhancement — **NOT-WIRED** (not ported at all)

- **What IV did:** `src/compute/histogram.ts` — global histogram **equalization**
  (`HistogramMode = "none" | "equalize"`) over present pixels, preserving the max.
- **Merged state:** **no histogram-contrast code exists in the merged repo.** Grep for
  `histogramEqualiz|equalize|HistogramMode` across `packages/`+`app/` → nothing. (The
  `histogram` hits in `Structure.tsx` / `structure.ts` are the column-value inspector
  histogram — a different feature.) The merged ion render offers only a fixed
  `percentile: 0.99` clip (`Imaging.tsx:335`) + linear/log scale + colormap. There is
  **no histogram-equalization / contrast control.**
- **Verdict: NOT-WIRED. Confirmed.** The prior review's "only percentile:0.99 + log"
  description is exactly right.
- **Migration effort:** **M.** Port `histogram.ts`, add a "Contrast: none / equalize"
  control, apply to the rendered Float32Array before `rasterizeImage`. Pure compute;
  can run main-thread on the cached `store.ionImage`.
- **Attaches at:** `Imaging.tsx` ion-mode controls + the paint effect (line 335);
  port target `packages/core/src/compute/` or a main-thread helper in `render.ts`.

### BL-08 · Peak table panel (centroid spectra) — **NOT-WIRED**

- **What IV did:** `src/ui/App.tsx` rendered a peak table (m/z + intensity rows) for
  centroid spectra.
- **Merged state:** `Spectra.tsx` *labels* the representation as profile vs centroid
  (`Spectra.tsx:305–336`, "Centroid (stick) spectrum") and MG-07 added a representation
  **pill** — but there is **no tabular peak list** (no rows of m/z/intensity, no
  sortable peak table). Grep for `peak.?table|PeakTable` → none. The reporter-ion pills
  (TMT/iTRAQ) are channel matches, not a general peak table.
- **Verdict: NOT-WIRED.** Centroid spectra are plotted (as sticks) and labeled, but the
  per-peak **table** panel was not ported.
- **Migration effort:** **S–M.** Add a peak-table panel beside/under the spectrum plot
  that lists `spectrum.mz[i]` / `spectrum.intensity[i]` rows when
  `representation === "centroid"` (data already in `store.spectrum`).
- **Attaches at:** `Spectra.tsx` (and optionally the imaging dock). No engine change.

### BL-09 · Spectrum-peak click → ion image — **NOT-WIRED**

- **What IV did:** `src/ui/SpectrumPanel.tsx` — click a peak in the spectrum → render
  the ion image at that peak's m/z.
- **Merged state:** the spectrum plot supports clicking **reporter-ion pills** to *zoom*
  the plot (`Spectra.tsx:34`, "Click a pill to zoom… highlight its peak") — but this is
  zoom-only and does **not** drive an ion-image render. There is no peak-click handler
  that sets `store.ionRequest` / navigates to the ion view. Grep for an onPeakClick →
  ion path in `app/src` → none.
- **Verdict: NOT-WIRED.** No "click a spectrum peak → ion image" round-trip.
- **Migration effort:** **S–M.** Add a peak/click handler in `SpectrumPlot` (ui-kit
  already emits reporter markers; needs a generic peak-pick) → `setIonRequest({mz})` +
  switch to the `ion` view + `renderIon`. The ion-render path already exists; this is the
  click→request glue.
- **Attaches at:** `Spectra.tsx` plot + the store `setIonRequest` / view-switch; the
  ion render itself is reused from `Imaging.tsx:259 renderIon`.

### BL-S3 · Load datasets from URL — **WIRED**

- **What IV did:** load datasets from `s3://` URLs.
- **Merged state:** the whole app loads remote `.mzpeak` over HTTP — `store.openUrl`
  (`store.ts:352`, "remote .mzpeak by URL — deep-link `?file=` / cloud demo / paste"),
  backed by the engine's lazy remote row-group reads, and the demo datasets served from
  `data.mzpeak.org`. The `?file=` deep link round-trips (Phase 5).
- **Verdict: WIRED.** (CDN/HTTP supersedes the IV `s3://` scheme; functionally equal or
  better.)

---

## Summary table

| BL | Feature | mzPeakIV source | Merged status | Effort to wire | Attaches at |
|----|---------|-----------------|---------------|----------------|-------------|
| BL-01 | TIC normalization (ion image, default) | `compute`/rasteriser | **NOT-WIRED** (raster supports `ticNorm`; UI never enables it, no toggle) | S | `Imaging.tsx` controls + paint (335/360) |
| BL-02 | Multi-ion RGB overlay | `renderMultiChannel` | **WIRED** | — | `multi` view |
| BL-03 | Mean / reference spectrum | `meanSpectrum` | **NOT-WIRED** (engine `engineMeanSpectrum`, no UI caller) | S | Spectra header / imaging dock |
| BL-04 | Gaussian 2D smoothing | `src/compute/smooth.ts` | **NOT-WIRED** (not ported) | M | `Imaging.tsx` + new compute |
| BL-05 | Ion-image TIFF export | `src/export/tiff.ts` | **NOT-WIRED** (not ported; only `decodeTiff` for optical exists) | M | `Imaging.tsx` export button |
| BL-06 | ROI rectangle → mean spectrum | `roiSpectrum` | **NOT-WIRED** (engine `engineRoiSpectrum`, no draw UI / caller) | M | `Imaging.tsx` canvas + dock |
| BL-07 | Histogram contrast | `src/compute/histogram.ts` | **NOT-WIRED** (not ported; only percentile 0.99 + log) | M | `Imaging.tsx` + new compute |
| BL-08 | Peak table panel (centroid) | `src/ui/App.tsx` | **NOT-WIRED** (representation labeled, no table) | S–M | `Spectra.tsx` |
| BL-09 | Spectrum-peak click → ion image | `src/ui/SpectrumPanel.tsx` | **NOT-WIRED** (pill click zooms only) | S–M | `Spectra.tsx` + store |
| BL-S3 | Load from URL | s3:// | **WIRED** (HTTP / `data.mzpeak.org`) | — | `store.openUrl` |

**Tally:** WIRED 2 (BL-02, BL-S3) · NOT-WIRED 8 (BL-01, BL-03, BL-04, BL-05, BL-06,
BL-07, BL-08, BL-09). PARTIAL: 0 — every gap is binary (either the user can reach it or
they can't); the closest to PARTIAL are BL-01/03/06, where engine/raster support exists
but the UI exposes no entry point.

> **Backlog correction:** `BACKLOG.md` lines 108–117 mark all ten BL items "implemented".
> That table describes **mzPeakIV**, not the merged shell. For the merged app it is
> accurate only for BL-02 and BL-S3.

---

## Recommendation — open **MG-04b · migrate unported imaging features**

The merged viewer has reached imaging parity for **rendering + spatial round-trip**
(ion render, RGB overlay, optical, overlay-layers, pixel-pick → spectrum, TIC heatmap
overview, remote load) — the spatially load-bearing path. It has **not** reached parity
for the **analysis/contrast/export** features. Recommend a follow-up backlog item:

**MG-04b · migrate unported imaging features.** Scope = the 8 NOT-WIRED items, grouped:

- **Group A — pure wire-up (engine already done), do first (effort S each):**
  - BL-01 TIC-norm toggle (raster already supports `ticNorm`).
  - BL-03 Mean spectrum button (`engine.meanSpectrum()` exists, no caller).
  - BL-06 ROI → mean spectrum (`engine.roiSpectrum()` exists; needs rectangle-draw UI).
  These are the highest value-per-effort: the hard part (engine) is built and tested.
- **Group B — port pure compute modules from IV (effort M each):**
  - BL-04 `smooth.ts` (Gaussian σ).
  - BL-07 `histogram.ts` (equalize/contrast).
  - BL-05 `tiff.ts` (ion-image export).
  All three are dependency-free pure modules in
  `/Users/kohlbach/Claude/mzPeakIV/src/{compute,export}/`; can run main-thread on the
  cached `store.ionImage` / `multiChannel` arrays (no worker round-trip required).
- **Group C — spectrum-panel features (effort S–M each):**
  - BL-08 centroid peak table.
  - BL-09 spectrum-peak click → ion image (closes the bidirectional spatial loop).

Suggested split: **MG-04b** = Group A + Group C (UI-only / glue, no new compute), and a
separate **MG-04c** for Group B (port + adopt the three IV compute/export modules) if the
team wants to keep "wire existing capability" separate from "port new code". Until then,
the parity checklist in `BACKLOG.md` should be amended to reflect the 2-of-10 merged
reality above.
