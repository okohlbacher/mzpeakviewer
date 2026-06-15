# mzPeak Design System

A design system for **mzPeak IV** — a browser-based **mass-spectrometry imaging (MSI)** explorer for the [mzPeak](https://github.com/HUPO-PSI/mzPeak) file format — visually aligned with the **[OpenMS](https://openms.org)** project, the open-source framework for mass spectrometry under which mzPeak tooling lives.

This project is the system itself: design tokens, reusable React primitives, foundation specimen cards, brand assets, and a high-fidelity UI kit. An automated compiler reads it and ships a runtime bundle (`_ds_bundle.js`) + token index that consuming projects link via `styles.css`.

---

## Product context

mzPeakIV lets a researcher open an imaging `.mzpeak` file (locally or by URL) and interactively explore it: **reconstruct the spatial pixel grid → render an ion image for a chosen *m/z* window → click a pixel → read the spectrum behind it.** Everything runs client-side; nothing is uploaded. It is a *format-orientation tool* for wet-lab scientists, format implementers and the HUPO-PSI community — not a full analysis suite.

Core round-trip that must always work and be correct: **file → ion image → spectrum.**

The interface is dense and instrument-like: a left inspection column — a human-readable **Sample & Run** summary, image stats, an **Optical** images list, and a collapsed **Format details** accordion that demotes the raw metadata, capability flags and grid diagnostics out of the primary view — a compact spectrum plot, and the ion-image canvases (TIC overview, base-peak m/z, single-ion image, RGB multi-channel, plus a native-aspect **optical-image** view) with hover readouts, percentile contrast, colormaps, smoothing and TIFF export.

### Sources used to build this system
- **GitHub — [okohlbacher/mzPeakIV](https://github.com/okohlbacher/mzPeakIV)** (`main`, last synced to HEAD `f3e4f7d`): the application. The visual vocabulary, control set, copy, colormaps (`src/ui/rasterize.ts`), panels (`src/ui/*.tsx`) and `CLAUDE.md` product brief were read directly from source. This sync reflects the **UAT-r3** inspector reorganization — a human-readable *Sample & Run* summary, an embedded-*Optical*-image picker, and a collapsed *Format details* accordion — and the app's move to **self-hosted fonts**. Explore this repo to build more faithful mzPeakIV designs.
- **Related — [okohlbacher/mzPeakExplorer](https://github.com/okohlbacher/mzPeakExplorer)**, **[okohlbacher/mzPeakJ](https://github.com/okohlbacher/mzPeakJ)**, and the **[HUPO-PSI/mzPeak](https://github.com/HUPO-PSI/mzPeak)** format spec.
- **Brand — [openms.org](https://openms.org)** and the OpenMS press kit: the **official OpenMS logo** (`assets/openms-logo.png`, supplied by the team) — a near-black “OpenMS” wordmark over a warm→cool **mass-spectrum** of coloured peaks (orange→red→magenta→purple→blue). That spectrum is captured as the `--openms-spectrum` brand token; the primary UI accent is the OpenMS electric blue `#3B54DA` (in sync with the logo's blue peaks).

---

## Content fundamentals — how mzPeak writes

The voice is **terse, technical and precise** — lab-instrument copy, not marketing.

- **Domain-literal, lowercase technical terms.** `m/z`, `TIC`, `ion image`, `viridis`, `inferno`, `centroid`, `profile`, `base-peak`, `percentile clip`, `TIC norm`. Casing of scientific terms is never "corrected."
- **Always carry units.** `799.95 Da`, `260 × 134 px`, `50 µm`, `σ 0.5`, `99th pct`. A number without its unit is incomplete.
- **Imperative, action-first labels.** "Show Ion Image", "Render", "Load URL", "Drop a `.mzpeak` file here, or browse". Buttons are verbs.
- **Honest empty/again states.** Missing data reads as an em-dash `—` or a plain statement: "no data", "TIC not yet available", "No spatial imaging coordinates — spectrum browser only." Never invent a value.
- **You-addressed, sparingly.** Instructions speak to the user ("Click a pixel or enter an index") but most surfaces are pure labels + values. First person is never used.
- **No emoji, no exclamation.** The single decorative glyphs in the source are functional: `⌀` (mean), `↓`/`±`/`–`/`×`. Tone is calm and exact.
- **Numbers are formatted for reading.** Thousands separators (`1,684`), compact scientific notation for large intensities (`1.4e6`), fixed precision for m/z (`740.5063`).

Examples (verbatim from the app): *“Overview ready — enter an m/z range and click **Show Ion Image**.”* · *“This file contains mass spectra but no spatial imaging coordinates.”* · *“{n} / {filled} pixels with signal · range {min}–{max} · scale: log (99th pct)”.*

---

## Visual foundations

**Overall feel:** a modern, compact scientific *instrument*. Light, hairline-bordered chrome wraps a **dark "data stage"** where ion images live — the duotone that makes the perceptual colormaps pop and reads as a pro imaging tool. Dense by default; every pixel earns its place.

- **Colors.** Primary identity is the **OpenMS electric blue `#3B54DA`** (a full 50→900 ramp, tuned to the logo's blue peaks), with **OpenMS signal red `#C00000`** as a sparing accent. Neutrals are a cool gray ramp for chrome/text/borders. Semantics: info = navy, success `#2E9E5B`, warning `#8A6D00` (+ the amber m/z band `rgba(255,200,0,.25)`), danger `#C62828`. RGB false-colour channels `#E53935 / #43A047 / #1E88E5`.
- **The hero: scientific colormaps.** Perceptually-uniform **viridis** (default) and **inferno**, plus **gray** and a **base-peak hue cycle**, exported as exact-anchor CSS gradients. Absent pixels render to a near-black **sentinel `#1A1A1A`**, always visually distinct from colormap-low. These are data, never "brand colored."
- **Type.** **IBM Plex Sans** for chrome; **IBM Plex Mono** (tabular figures) for *every measured value* — m/z, intensity, coordinates, counts. A compact scale (12.5px base UI; ion-image labels never below ~10.5px ticks). Uppercase, letter-spaced overlines label inspector sections.
- **Spacing.** A tight **2px-based** scale (`--space-1…16`). Controls are 28px (22px small). The shell rails are fixed: 44px top bar, 272px inspector, 188px spectrum dock, 26px status bar.
- **Backgrounds.** No photography, no gradient-for-decoration. Chrome is flat white/`--gray-50`. The stage is flat `--ink #0E1216` with a faint dot-grid texture (`radial-gradient` 22px) — a nod to instrument readouts. The only gradients in the system are the *colormap legends* themselves.
- **Borders, corners, cards.** Hairline 1px borders (`--gray-200`) everywhere; tight radii (3px controls, 4px tab groups, 6px cards/dropzone, 8px panels). Cards are border + very soft shadow (`--shadow-1/2`), never heavy. No colored left-border accent cards.
- **Elevation.** Restrained, instrument-grade: `--shadow-1` (hairline+lift) for resting cards, `--shadow-2/3` for popovers, `--shadow-pop` for the settings popover. The ion-image frame uses a deeper drop shadow to sit it "above" the dark stage.
- **Transparency & blur.** Used only for **stage overlays** floating over the dark canvas — the legend, hover readout and scale bar use `rgba(14,18,22,.72)` + `backdrop-filter: blur(8px)` with a 10%-white hairline. Chrome itself is opaque.
- **Motion.** Subtle and fast — `--dur-fast 120ms` / `--dur-base 180ms` on `--ease-standard` (cubic-bezier(.2,0,0,1)). Transitions cover background/border/color/shadow on controls and the rail slide-in. No bounces, no infinite decorative loops. Respects `prefers-reduced-motion`.
- **Hover / press states.** Hover = a step toward the accent (secondary buttons fill `--accent-subtle`; ghost fills `--gray-100`; icon buttons fill `--gray-100`). Press = the next-darker accent step (`--accent-active`). Active tabs/segments invert to the navy fill with white text. Focus = a 3px navy ring (`--focus-ring`).
- **Imagery vibe.** The "imagery" *is* the ion images: false-color scientific heatmaps on near-black, cool-to-warm perceptual ramps. Crosshair cursor over data; `image-rendering: pixelated` (one device pixel per grid cell — MSI pixels are honest, not smoothed).

---

## Iconography

- **System: [Lucide](https://lucide.dev)** — thin (2px), rounded line icons. The original app uses bare Unicode glyphs (`↓ ⌀ × ± –`); the redesign standardises on Lucide for a coherent, modern set while keeping the functional glyphs (`⌀` mean, `±` tolerance, `–` range) inline in labels. The kit ships a small hand-built Lucide-style subset in `ui_kits/mzpeak-iv/icons.js` (upload, image, layers, grid, crosshair, download, sliders, flask, panel-left, chevrons, info, search, sigma, ruler…) so it needs no CDN. To extend, pull the matching glyph from Lucide (same 24×24 / 2px stroke) — do not mix in a heavier or filled icon family.
- **No emoji.** Brand and UI are emoji-free. Status uses colored dots (`Badge dot`) and semantic color, not emoji.
- **Logo / brand marks** (in `assets/`): `openms-logo.png` (the official full-colour wordmark — use on light backgrounds; its wordmark is near-black, so do not place on dark) and `openms-mark.svg` (square app mark / favicon — white peaks on navy, for dark/compact contexts). The mass-spectrum "stick" peaks are the reusable brand device; `--openms-spectrum` reproduces their gradient for flourishes.
- **Data glyphs.** Channel swatches (R/G/B squares), the colormap legend bar, and the selection ring are first-class iconography here — they communicate state more than any UI icon.

---

## Index / manifest

**Root**
- `styles.css` — global entry point (consumers link this). `@import`s only.
- `readme.md` — this guide. · `SKILL.md` — Agent-Skill front-matter for download/Claude Code use.

**`tokens/`** — `fonts.css` (IBM Plex via Google Fonts), `colors.css`, `colormaps.css`, `typography.css`, `spacing.css`, `base.css`.

**`components/`** — React primitives + one card per group:
- `controls/` — **Button**, **SegmentedControl**
- `forms/` — **NumberField**, **Select**, **Checkbox**
- `data/` — **Badge**, **StatRow**, **ColormapScale**, **Panel** (Panel also composes the **Format details** nested accordion `.format-details` and the **Optical** picker `.optical-item` — see *Inspector patterns*).
- `components.css` — class styles for all primitives (shipped in the global closure).

**`guidelines/`** — foundation specimen cards (Design System tab): colors (brand / neutral / semantic / stage), colormaps (viridis / inferno / gray+basepeak), type (families / scale / numeric), spacing (scale / radii+elevation), brand (logo / product lockup), **inspector patterns** (optical picker + format-details accordion).

**`ui_kits/mzpeak-iv/`** — the compact redesign of the Imaging Viewer (`index.html` + engine/icons/panels/stage/app + `kit.css`). See its README.

**`assets/`** — OpenMS logo lockups + app mark (SVG).

---

## Caveats
- **Logo:** the official OpenMS logo (`assets/openms-logo.png`) is now in place. It has a near-black wordmark, so on dark surfaces the system uses `openms-mark.svg` instead. If you need a reversed (white) full wordmark for dark backgrounds, grab one from <https://openms.org/press-kit>.
- **Fonts.** This DS loads IBM Plex Sans/Mono by Google-Fonts `@import` (no self-hosted binaries) — the only portable mechanism for standalone HTML specimen/kit artifacts. Note the app at HEAD **neutralized** its own copy of `tokens/fonts.css`: the render-blocking `@import` was removed and IBM Plex is now self-hosted via `@fontsource` (JS modules in `src/main.tsx`) to satisfy the app's offline / GitHub-Pages constraints. For a production embed, follow the app and self-host the same weights, then drop the `@import`.
- **UI kit is a redesign, not a 1:1 clone.** Per request it's a modern, slim, compact reimagining with a persistent shell; data is mocked (no real Parquet/WASM reader) so canvases render representative MSI imagery. The kit's inspector now mirrors the UAT-r3 rail (Sample & Run · Image Info · Optical · Format details) and adds the native-aspect Optical-image view (a striped placeholder stands in for real microscopy pixels).
