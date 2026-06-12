# mzPeakIV — Feature Backlog

Items below were derived from a structured review of the Cardinal v3 paper (Bemis et al.,
bioRxiv 2023.02.20.529280) and scoped against mzPeakIV's mission as a
**format-exploration and orientation tool** — not a full analysis suite.
Cardinal's full workflow (Fig. 1b) covers Import → Visualization → Preparation →
Pre-processing → Statistics/AI → Export.  mzPeakIV targets the Import and
Visualization columns only, plus lightweight extraction.

Statistical/analytical features (segmentation, classification, co-localization,
pre-processing pipelines) are explicitly **out of scope** and will not be added here.

---

## Tier 1 — High-impact, viewer-appropriate

### BL-01 · TIC normalization (default rendering mode)

**What**: Before painting an ion image, divide each pixel's XIC intensity by that
pixel's TIC (total ion current).  Without this, pixels with high total signal —
e.g. matrix hot-spots in MALDI — dominate the colormap and spatially relevant
variation disappears.

**User experience**: TIC normalization is ON by default.  A toggle in the Display
panel switches between raw and TIC-normalized rendering without re-fetching data
(the raw XIC array is cached; normalisation is applied in the rasteriser).

**Implementation notes**:
- The per-pixel TIC is already stored in `spectra_metadata.parquet`
  (`MS_1000285_total_ion_current`) and loaded by `buildGridFast`.
- `rasterize.ts → rasterizeImage()` receives both `ionImage: Float32Array` and
  `tic: Float32Array | null`; when normalization is enabled divide element-wise
  before scaling.
- When TIC is null (non-imaging or pre-grid) the toggle is disabled.

**Cross-cutting**: The imzML2mzPeak converter should pre-compute and store a
**per-pixel TIC** (the average TIC across all spectra that map to the same pixel,
for future datasets where multiple spectra share a pixel coordinate) as an
additional column in the metadata Parquet.  This is a separate backlog item for
the `imzML2mzPeak` project.

**Effort**: S (rasterise.ts change + store toggle)

---

### BL-02 · Flexible multi-ion channel overlay (1 / 2 / 3 channels)

**What**: Assign up to three independent m/z windows to the Red, Green, and Blue
channels of a single composite image.  Each channel is independently normalised
(0–max of that channel's XIC sum array).  Channels with no m/z entered are skipped
(black contribution), so 1-channel, 2-channel, and 3-channel modes all work
naturally through the same UI.

**User experience**:
- A new "Multi-channel" tab next to the current "Ion Image" tab in the controls
  panel opens three m/z / tolerance row inputs labelled R / G / B.
- Pressing "Render" fires three parallel `computeIonImageFast` calls (or a single
  batched worker message), then composites the three Float32Arrays into an RGB
  ImageData.
- The current single-channel ion image panel is preserved unchanged.

**Implementation notes**:
- Compositing: for each grid cell `k`:
  `R[k] = clip01(ionR[k] / maxR)`, same for G and B.
  `rgba[4k]   = Math.round(R[k] * 255)`
  `rgba[4k+1] = Math.round(G[k] * 255)`
  `rgba[4k+2] = Math.round(B[k] * 255)`
  `rgba[4k+3] = presenceMask[k] ? 255 : 0`
- Missing pixels (presenceMask = 0) render transparent (or a configurable
  background colour, default: black).
- A channel left blank contributes 0 to that colour component — the pixel
  brightness in that channel is zero, so colour mixing still works correctly for
  the filled channels.
- TIC normalization (BL-01) applies per-channel when enabled.

**Effort**: M (new worker message type + compositor + UI tab)

---

### BL-03 · Mean / reference spectrum

**What**: Compute and display the mean spectrum across all pixels in the file (or
across a selected ROI, see BL-07).  This is the standard "what does this tissue
look like?" reference view that every scientist checks first.

**User experience**: A "Mean spectrum" button in the Spectrum panel header fetches
the dataset-wide mean.  The spectrum panel switches to show it, labelled
"Mean spectrum (N=34,840 pixels)".  Clicking a pixel returns to the pixel-specific
view.

**Implementation notes**:
- For profile data: the mean spectrum is the element-wise average of all per-pixel
  spectra — computationally equivalent to an XIC across the full m/z range.
  In practice: read the full TIC-normalised ion image at N m/z points (expensive)
  or approximate by reading the mean intensity from `spectra_metadata` stats.
- For centroid data: use the mean spectrum of the peaks file, binned to a common
  m/z grid (bin width = median resolution).
- First iteration: approximate via the `spectra_metadata` mean intensity column if
  available, falling back to a sampled subset (every 10th pixel).

**Effort**: M

---

### BL-04 · Gaussian 2D image smoothing

**What**: Apply a Gaussian spatial filter (configurable σ in pixels, range 0–5) to
the ion image Float32Array before rasterising.  Reduces MALDI shot noise without
distorting spatial structure.  Cardinal offers Gaussian, moving-average, and
Savitzky-Golay; Gaussian is sufficient for an orientation viewer.

**User experience**: A "Smooth σ" numeric input (default 0 = off) in the Display
panel.  Applied in the worker after `computeIonImageFast`, before the raster is
transferred.  Changing σ re-smooths the cached raw image without re-reading Parquet.

**Implementation notes**:
- Separable 1D Gaussian applied row-then-column on the grid-shaped array.
- Kernel radius = ⌈3σ⌉; values outside the grid boundary are treated as 0 (or the
  nearest edge pixel — use whichever is consistent with presence-mask handling).
- Absent pixels (presenceMask = 0) are excluded from the kernel sum and from the
  weight denominator — they must not bleed intensity into their neighbours.

**Effort**: S (pure typed-array arithmetic, no Parquet I/O)

---

### BL-05 · Ion image export as TIFF

**What**: Download the currently displayed ion image as a TIFF file.  The exported
TIFF preserves full scientific fidelity: 32-bit float for single-channel images,
3×8-bit (24-bit) for multi-channel RGB overlays (BL-02).  No lossy compression.

**User experience**: A download icon / "Export TIFF" button in the ion-image panel
header.  Filename: `<filename-stem>_mz<center>±<tol>Da_<colormap>.tif` for
single-channel, `<stem>_RGB_R<mz1>_G<mz2>_B<mz3>.tif` for multi-channel.

**Implementation notes**:
- Single-channel: write a minimal TIFF with one 32-bit float plane (IFD tag
  BitsPerSample=32, SampleFormat=3 IEEEFP, PhotometricInterpretation=1 BlackIsZero).
  Grid width × height × 4 bytes.
- Multi-channel RGB: write a 3-sample-per-pixel 8-bit TIFF
  (BitsPerSample=8,8,8; SamplesPerPixel=3; PhotometricInterpretation=2 RGB).
- Implement a minimal TIFF encoder in `src/export/tiff.ts` — no external library
  needed for the simple tag set required.  TIFF spec §§ IFD structure, data types
  3 and 4, and stripOffsets.
- The raw ion image Float32Array (before colour-mapping but after normalisation and
  smoothing) is what gets written — not the RGBA canvas pixels.
- Multi-channel export writes the three float planes as separate TIFF strips or as
  a planar RGB 8-bit (quantise each channel 0–255 from its 0–1 composite values).

**Effort**: M (minimal TIFF encoder, no deps)

---

## Tier 2 — Useful, planned but not yet scheduled

### BL-06 · ROI rectangle selection → mean spectrum

**What**: The user draws a rectangle on the ion image or TIC canvas; the app
computes and displays the mean spectrum for all pixels within the selection.
Cardinal calls this "Annotate ROIs."  This is the most natural analytical action:
"what does this tissue region look like spectrally?"

**User experience**:
- Mouse-drag on the canvas (distinct from click-to-select-pixel) draws a visible
  rectangle overlay.
- After release, the worker receives the list of spectrum indices inside the
  rectangle and reads + averages their spectra.
- The spectrum panel shows "ROI mean (N=142 pixels)" and the averaged data.

**Implementation notes**:
- ROI state: `{x0, y0, x1, y1}` in grid coordinates; derived from mouse drag
  deltas via `toGridCoord()` at start and end.
- Worker message: `{ type: "roiSpectrum", gridKeys: number[] }` — the main thread
  sends the list of matching grid keys; worker looks up spectrum indices via
  `coordToSpectrumIndex` and averages.
- Averaging for profile: sort all spectra by row-group, read each row group once,
  accumulate sums, divide by count.
- Clear ROI on next single-pixel click.

**Effort**: L (canvas drag state + new worker message + averaging logic)

---

### BL-07 · Contrast enhancement (histogram-based)

**What**: Apply histogram equalisation or adaptive histogram equalisation (CLAHE) to
the ion image before rasterising.  More informative than the current percentile-clip
for images where signal is spatially concentrated in a small fraction of pixels.
Cardinal offers "contrast enhancement via suppression" and "histogram."

**User experience**: A "Contrast" dropdown in Display: None / Percentile (current) /
Histogram equalize / CLAHE (stretch goal).

**Effort**: S–M

---

### BL-08 · Peak table panel (centroid spectra)

**What**: For centroid-mode spectra, display a sortable table of detected peaks
(m/z, intensity, relative intensity %) below the spectrum chart.  Lets researchers
read off dominant masses without needing to hover the plot.

**User experience**: Appears automatically when `selectedSpectrum` is centroid mode.
Columns: m/z, intensity, rel %. Sortable by intensity descending by default.
"Copy as CSV" button.

**Effort**: S (pure UI over existing `selectedSpectrum` data)

---

### BL-09 · Spectrum-peak click → ion image

**What**: Clicking a peak in the uPlot spectrum chart immediately populates the
m/z field and fires `renderIonImage` for that m/z.  Closes the most natural
exploration loop: see a dominant peak in a pixel's spectrum → inspect where it
distributes across the tissue.

**User experience**: uPlot cursor `click` hook reads the cursor's x-position in m/z
space and calls `renderIonImage(mz, defaultTol)` with a configurable default
tolerance (e.g. 0.3 Da).  The m/z input fields in the Ion Image panel are updated
to reflect the chosen value.

**Implementation notes**:
- uPlot `click` hook: `u.cursor.left` → `u.posToVal(u.cursor.left, 'x')`.
- Default tolerance: read from the existing tolerance input (whatever the user last
  set), falling back to 0.3 Da.
- No new worker messages needed — reuses the existing `renderIonImage` action.

**Effort**: S (uPlot hook + store action call)

---

## Infrastructure & loading

### BL-S3 · Load datasets from `s3://` URLs — ✅ IMPLEMENTED

**Status**: Done. `src/reader/resolveUrl.ts` rewrites `s3://bucket/key` → the
configured HTTPS endpoint (default `object.storage.eu01.onstackit.cloud`,
path-style) in `store.openUrl`; anonymous public-read only, no in-browser signing.
Unit-tested in `resolveUrl.test.ts`. Still gated on the bucket's CORS (BL-CORS).

**What**: Accept an `s3://bucket/key` URL in the loader and stream it via HTTP Range,
the same way the current `https://…` path does.

**Why**: Demo/source datasets are addressed as `s3://` (e.g.
`s3://v09/demo/PXD001283-HR2MSI-urinary-bladder_HR2MSImouseurinarybladderS096.mzpeak`).
A browser's `fetch()` only speaks `http(s)://`, so an `s3://` URL cannot be loaded
client-side as-is — today it must be rewritten to the provider's HTTPS endpoint
(`https://object.storage.eu01.onstackit.cloud/v09/demo/…`).

**Implementation notes**:
- Map `s3://<bucket>/<key>` → the configured S3 HTTPS endpoint
  (`https://<endpoint>/<bucket>/<key>`) before handing the URL to the reader. A small
  endpoint setting (default the StackIT `object.storage.eu01.onstackit.cloud` host)
  would cover the common case.
- Anonymous (public-read) objects only — keep the client-side, no-credentials posture;
  presigned URLs are already plain HTTPS and work today. Do **not** add AWS-SDK signing
  / credentials to the browser app.
- Still requires the target bucket to allow byte-range + CORS (see BL-CORS).

### BL-CORS · Demo-bucket CORS / public-read (ops, not app code)

**What**: The default demo object must be browser-loadable. As of this writing
`https://object.storage.eu01.onstackit.cloud/v09/demo/PXD001283-…S096.mzpeak` is
**public-read and supports byte ranges (206 + `Accept-Ranges`)**, but the bucket has
**no CORS configuration** — a cross-origin Range GET from the Pages origin is blocked
(preflight `OPTIONS` → `403`, no `Access-Control-*` headers).

**Action (bucket policy, not app code)**: add a CORS rule allowing the app origin
`https://okohlbacher.github.io` — method `GET`, allowed request header `Range`, and
expose `Content-Range` / `Accept-Ranges`. Until then the default "Load URL" demo fails
with a CORS error; local files and any CORS-enabled URL work regardless.

---

## Explicitly out of scope

The following Cardinal features were reviewed and excluded from this backlog on the
grounds that they require full preprocessing or statistical pipelines, which are
outside the orientation-viewer scope:

- Mass re-calibration and spectral alignment
- Baseline removal
- Peak detection and peak binning
- Normalization other than TIC (reference m/z, median, Locmin, root-mean-square)
- Unsupervised segmentation (Spatial DGMM, Spatial Shrunken Centroids, k-means)
- Class comparison / classification (PLS-DA, OPLS-DA, mi-CNN)
- Co-localization analysis
- Multi-file / multi-tissue-section experiments

---

## Source

Bemis, K.A. et al. *Cardinal v3 — a versatile open source software for mass
spectrometry imaging analysis.* bioRxiv 2023.02.20.529280 (2023).
Feature taxonomy derived from Figure 1b (MSI workflow and Cardinal functionality
map).  Scope filtering against mzPeakIV CLAUDE.md mission statement.
