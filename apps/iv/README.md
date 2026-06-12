# mzPeakIV

**A browser-based explorer for mass-spectrometry imaging (MSI) data in the [mzPeak](https://github.com/HUPO-PSI/mzPeak) format.**

Open an imaging `.mzpeak` file — locally or from a URL — and explore it interactively:
reconstruct the spatial pixel grid, render **ion images** for a chosen *m/z* window,
click any pixel to inspect the **spectrum** behind it, overlay channels, and read the
file's metadata. Everything runs **client-side in your browser** — no backend, no
upload — and the app deploys as a static site.

🔬 **Live app:** https://okohlbacher.github.io/mzPeakIV/

> An OpenMS-family tool. The aesthetic is a *modern scientific instrument*: light,
> hairline chrome wrapping a dark "data stage" where the visualization lives.

---

## Core value

> **Open an imaging mzPeak file in a browser and see an ion image — pick an *m/z*, get
> a spatial map, click a pixel, see its spectrum.** That round-trip (file → ion image →
> spectrum) is the heart of the tool, and it must be correct.

It is a *format-exploration and orientation tool*, not a full analysis suite — built to
make the new mzPeak imaging format tangible and inspectable for wet-lab scientists,
format implementers, and the HUPO-PSI community.

---

## Features

- **Overview** — total-ion-current (TIC) heatmap of the whole image, honoring the global
  colormap (viridis / inferno / gray) and linear/log scale.
- **Ion image** — render the spatial intensity map for any *m/z* ± tolerance window.
- **Multi-channel** — composite up to three *m/z* windows into an R/G/B overlay.
- **Optical** — display embedded optical / histology TIFFs (imaging-spec v0.5), resampled
  onto the MS grid via their affine; multiple images are selectable.
- **Blend** — alpha-composite TIC / ion / RGB / optical layers with per-layer opacity.
- **Spectrum dock** — click a pixel (or drag a rectangle for an ROI mean) to see its
  *m/z* / intensity spectrum (uPlot); click a peak to jump to that mass's ion image.
- **Inspector rail** — researcher-first panels: *Sample & Run*, *MS Image*, *Optical*,
  *Settings*, and a collapsed *Format details* accordion for parquet/diagnostic internals.
- **Export** — download the displayed raster of any image tab as **TIFF / PNG / JPEG**.
- **Zoom & pan** on every image tab; pixel-accurate hover readout with 1-based coordinates.
- **Honest rendering** — one device pixel per data cell (`image-rendering: pixelated`);
  absent pixels render to a distinct sentinel, never colormap-low.

---

## Privacy — client-side only

Your data **never leaves your browser**. There is no backend, no upload, no telemetry,
no analytics, and no external scripts; fonts and the WASM parser are self-hosted. A
**local file** is read with `FileReader`/`arrayBuffer()` and parsed in a Web Worker —
it never touches the network. A **URL** is fetched directly by your browser (via HTTP
Range requests) — a download *from* the source you choose, not an upload of your data.

---

## Quick start

### Use it
Open **https://okohlbacher.github.io/mzPeakIV/**, then either drop a `.mzpeak` file,
browse for one, or paste a URL. A small example is bundled same-origin and loads
instantly (the pre-filled default); the full **PXD001283 HR2MSI** imaging dataset
(mouse urinary bladder, 260 × 134 px) is offered as a one-click **remote example**
— it streams from object storage and therefore needs that host's CORS configured
(see [Hosting the demo dataset](#hosting-the-demo-dataset)). URLs may be `https://`
or `s3://bucket/key` (an `s3://` address is rewritten to the storage HTTPS endpoint;
anonymous public-read only — no in-browser credentials).

### Deep links — open a file directly by URL
Append a `?file=` query parameter to open an external `.mzpeak` immediately, with no
clicks — handy for links emitted by the converter or embedded in another page:

```
https://okohlbacher.github.io/mzPeakIV/?file=<percent-encoded URL to a .mzpeak>
```

`?url=` is accepted as an alias; the value may be an `http(s)://` or `s3://` URL
(other schemes are rejected). The file is read over HTTP Range requests, so it
starts in seconds rather than after a full download. Once a file is open from a URL,
the header shows a **Copy link** button that builds such a link for the current
file. The hosted object must allow Range requests and CORS for the viewer origin
(see [Hosting the demo dataset](#hosting-the-demo-dataset)); a deep link to a host
without those shows a clear error and leaves the file picker available to recover.

### Run locally
```bash
git clone https://github.com/okohlbacher/mzPeakIV
cd mzPeakIV
npm run bootstrap   # builds the vendored mzpeakts reader (git submodule + tsc/vite build)
npm install
npm run dev         # http://localhost:5173
```

### Scripts
| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | type-check (`tsc -b`) + production build |
| `npm run preview` | serve the production build |
| `npm test` | unit tests (Vitest) — grid math, rasterize, store, optical, … |
| `npm run e2e` | end-to-end tests (Playwright) against `vite preview` |
| `npm run lint` / `npm run format` | ESLint / Prettier |

> The reader (`mzpeakts`) is vendored as a git submodule and built by `npm run bootstrap`
> before the first `npm install`. CI runs the same bootstrap step.

---

## How it works

### The mzPeak format
A `.mzpeak` file is an **uncompressed ZIP** of Apache **Parquet** files plus a
`mzpeak_index.json` manifest. Imaging files carry one spectrum per pixel; pixel
coordinates come from promoted `scan` columns (`IMS_1000050_position_x` /
`IMS_1000051_position_y`, 1-based, top-left origin, y-down — **no flip/transpose**).
Optical images (v0.5) are embedded as `images/image_NNNN.tiff` ZIP members described in
`metadata.imaging.images[]` with an affine display hint. The format is explicitly
unstable, so the reader version-detects and fails loudly rather than assuming schemas.

### Architecture
- **App shell** — a fixed frame (top bar · inspector rail · dark data stage · spectrum
  dock · status bar); only the toolbar controls and the stage content change between
  views.
- **Reader** — the vendored [`mzpeakts`](https://github.com/HUPO-PSI/mzpeakts) browser
  reader (`@zip.js/zip.js` + `parquet-wasm` + `apache-arrow`), driven entirely from a
  **Web Worker** so the UI never blocks. The worker reads only the column chunks it needs
  via byte-range requests (fast grid + TIC build, lazy per-pixel/ROI spectra).
- **Render** — pure transforms (`src/ui/rasterize.ts`, `src/compute/*`) turn intensity
  arrays into RGBA; Canvas 2D paints them one pixel per cell; uPlot draws spectra.
- **State** — a small Zustand store mediates the UI ↔ worker message protocol, with
  generation/request guards so stale or out-of-order responses are discarded.

### Tech stack
Vite + React + TypeScript · Zustand · Canvas 2D · uPlot · `mzpeakts` (parquet-wasm,
apache-arrow, zip.js) · `utif2` (optical TIFF decode) · IBM Plex Sans/Mono (self-hosted
via `@fontsource`) · Lucide icons · Vitest + Playwright · deployed to GitHub Pages via
GitHub Actions.

---

## Project structure
```
src/
  ui/        React components — App shell, ImagingPanel (stage + tabs), SpectrumPanel,
             inspector panels, and the design-system primitives (ui/ds)
  worker/    Web Worker: mzpeak read pipeline + the typed postMessage protocol
  reader/    metadata, stats, capabilities, grid-coordinate extraction
  imaging/   grid reconstruction + optical-image decode/affine placement
  compute/   pure transforms — TIC, ion image, smoothing, histogram
  state/     Zustand store (UI ↔ worker mediator)
  styles/ds/ design tokens (colors, colormaps, typography, spacing) + component CSS
  export/    TIFF encoder + download helpers
e2e/         Playwright specs       test/ + *.test.ts  Vitest unit tests
vendor/      vendored mzpeakts reader (git submodule)
tools/       inject_optical.py (fabricate an optical-bearing fixture for dev/UAT)
```

---

## Deployment
A static site. `npm run build` emits `dist/`; a GitHub Actions workflow builds and
publishes it to GitHub Pages on push to `main`. `base` is set to `/mzPeakIV/` for the
project page. No COOP/COEP headers are required — `parquet-wasm` is single-threaded.

### Hosting the demo dataset
The default demo URL is fetched by the browser with **HTTP Range** requests, so the
object-storage bucket must:
1. serve the object with **public read**,
2. support **byte-range** requests (`Accept-Ranges: bytes`),
3. set **CORS** allowing the app origin — `GET` + the `Range` request header, and expose
   `Content-Range` / `Accept-Ranges`.

Without these the demo will fail to load (a `403`/CORS error in the console); any
correctly-configured URL or a local file works regardless.

---

## Acknowledgements
- The mzPeak format — [HUPO-PSI/mzPeak](https://github.com/HUPO-PSI/mzPeak).
- The browser reader — [HUPO-PSI/mzpeakts](https://github.com/HUPO-PSI/mzpeakts)
  (MIT OR Apache-2.0).
- [OpenMS](https://openms.org) — branding and design language.
- Demo data — PXD001283 (PRIDE), HR2MSI mouse urinary bladder.
