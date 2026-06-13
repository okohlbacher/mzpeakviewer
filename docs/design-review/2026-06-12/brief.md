# Generation brief — mzPeak Viewer new overall layout

**Project**: Claude Design, high-fidelity interactive Prototype, design system "mzPeak IV Design System".
**Repo (GitHub connected)**: https://github.com/okohlbacher/mzpeakviewer
**Date**: 2026-06-12

## As-sent prompt

> Redesign the **overall layout** of the **mzPeak Viewer** — a browser-based, client-only
> tool for exploring mass-spectrometry files in the mzPeak format. It is ONE app that
> serves both **mass-spectrometry imaging (MSI)** files and general **LC-MS** files; the
> imaging panels appear only for imaging files. Import and reuse the connected repository
> **https://github.com/okohlbacher/mzpeakviewer** — its React components, design tokens,
> typography (IBM Plex Sans / IBM Plex Mono) and the existing blue accent (#3b54da). Light
> theme, clean scientific-instrument feel, comfortable density for data-dense panels.
>
> Audience: wet-lab MS scientists, mzPeak format implementers, and the HUPO-PSI community
> evaluating the format.
>
> HARD CONSTRAINTS — preserve exactly, do not redesign away:
> 1. The **mzPeak logo** must stay in the **top navigation bar** (left) AND as the
>    centered hero on the **start page**. Keep the existing logo asset.
> 2. The **start / idle page** keeps its current structure: centered hero logo + a short
>    heading + a drag-and-drop **.mzpeak** zone + a row of **demo-dataset cards**
>    (Imaging (MSI), LC-MS, Chunked layout) + a "paste a https:// .mzpeak URL" field.
>    Keep all three demo cards and this overall arrangement; you may refine spacing,
>    card styling, and typography only.
>
> REDESIGN (improve hierarchy, spacing, consistency, and the data-panel ergonomics):
> - **Top bar**: logo + app name, the open-file name chip, and the actions (Open file,
>   Load demo, Share view).
> - **Left navigation** (capability-gated): Summary, Spectra, Chromatograms (LC only),
>   an **Advanced** accordion (Metadata, Structure), and an **Imaging (MSI)** accordion
>   (Overview/TIC, Ion image, RGB channels, Optical, Overlay, Grid) — shown only for
>   imaging files. Plus a compact file-stats footer (spectra count, m/z range, layout,
>   imaging yes/no).
> - **Main content area** for each view: the spectrum plot, the chromatogram plot, and
>   especially the **imaging panel** — an ion-image heatmap on a dark stage with a
>   controls row (m/z, tolerance, Render, colormap picker viridis/inferno/gray,
>   linear/log scale, zoom) and a vertical colormap **legend** (max/min/pixel count).
>   Design clean **empty states** and a non-blocking notice/status bar.
>
> Produce a cohesive multi-screen prototype with these screens:
> 1. Start / idle page (preserving logo + the three demo cards + dropzone + URL field).
> 2. Summary view (file overview + stats).
> 3. Spectra view (m/z vs intensity plot + selection).
> 4. Imaging — Ion image (controls + dark-stage heatmap + colormap legend + hover readout).
> 5. Imaging — Overview (per-pixel TIC heatmap) and RGB channels.
> 6. Metadata / Structure (parquet inspector) as the "Advanced" surface.
>
> Keep it implementable with the repo's existing component model (React + Canvas 2D for
> the heatmap, uPlot for the spectra). Prioritize a calm, legible information hierarchy
> over decoration.

## Wizard answers (as answered)

1. **First file loaded past the start page** → Imaging (MSI) — shows the full nav incl. the Imaging accordion (best to showcase the redesign).
2. **Left navigation visual treatment** → Icon + label with a thin active-accent rail on the selected item (continuity with the current active-rail signature + icons for legibility).
3. **Spectrum on imaging views** → Persistent bottom dock on imaging views (click pixel → spectrum below), AND a full Spectra view.
4. **'Share view' action** → Copy a shareable link (URL with current view + params) — show a small 'Copied' confirmation (matches the repo's existing ShareButton deep-link behavior).
5. **Scope** → One cohesive, polished prototype across all 6 screens (no competing nav variations).
6. **Anything else (free text)** → "Keep the mzPeak/OpenMS logo asset exactly as-is (top bar + start hero). Keep all three demo cards + dropzone + URL field on the start page. Imaging heatmaps sit on a dark stage; default colormap viridis; absent/no-data pixels render as a near-black sentinel (#1a1a1a) visually distinct from the colormap's dark bottom. Use IBM Plex Sans/Mono and the existing #3b54da accent. Don't invent controls or file capabilities beyond what the repo supports (m/z + tolerance ion images, RGB channels, optical overlay, TIC overview, parquet structure)."

Note: the generator identified the logo as the OpenMS/mzPeak brand asset already present in the repo and confirmed it will preserve it.
