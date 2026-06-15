# Generation brief — mzPeak Viewer (Claude Design)

> **Status: DRAFT — not sent.** Per the c-design-review safety rules, the generation
> prompt is confirmed with the user before sending (it is metered against the weekly
> Claude Design allowance; one rich generation ≈ 4–7 min). This file is the exact
> text that will be sent, so Phase 4's Hallucination Hunter can cross-check the
> handoff against it. Wizard answers get appended below after sending.

## Target / template
- **Template:** Product wireframe (lo-fi — cheaper output, same allowance). Escalate to
  Prototype only if the user wants a high-fidelity click-through.
- **Repo to import:** `github.com/okohlbacher/mzpeakviewer` (public) via "+ → Code →
  Connect GitHub". Reuse the imported repo's components, design tokens, and styling.

## Audience
Mass-spectrometry researchers (proteomics + imaging/MSI). Power users who want dense,
correct, fast readouts — not a consumer dashboard. Desktop-first.

## What the product is (for grounding the design)
A single browser-based, backend-free viewer for `.mzpeak` files. The general explorer
is always on; the imaging (MSI) layer activates only for imaging files. Core loop:
pick an m/z → ion image → click a pixel → its spectrum. Existing surfaces to redesign:
- **Start page** (`app/src/views/Idle.tsx`): drop-zone, three demo dataset cards
  (cloud-stream + download), URL field, paired OpenMS+mzPeak logos.
- **App shell** (`app/src/App.tsx`): top bar + capability-gated left sidebar
  (Summary, Spectra, Chromatograms, an Advanced accordion [Metadata, Structure], and
  an Imaging (MSI) accordion [Overview/TIC, Ion image, RGB channels, Optical, Overlay,
  Grid]) + a main view panel.
- **Views**: Summary (metric tiles + TIC thumbnail + file/capability panels),
  Spectra (uPlot m/z vs intensity), Chromatograms, Imaging (canvas ion image + colormap
  legend + per-pixel spectrum dock + render progress bar), Structure (parquet inspector).

## Design tokens to reuse (from `@mzpeak/ui-kit`)
- Type: IBM Plex Sans (UI), IBM Plex Mono (numbers/IDs).
- Accent/brand blue: `--blue-600` `#3b54da`; active `#2563eb`.
- Neutrals: page `#f8fafc`, card `#fff`, panel `#f1f5f9`, border `#e2e8f0`,
  text-heading `#1e293b`, text-secondary `#64748b`, text-muted `#94a3b8`.
- Imaging stage ink `#0e1216`; colormaps viridis/inferno/gray; channel R/G/B
  `#e53935 / #43a047 / #1e88e5`.

## Generation prompt (as will be sent)
> Using the imported mzpeakviewer repository's existing components, design tokens, and
> styling, produce an in-depth design review and redesign proposal for this scientific
> mass-spectrometry data viewer, for an audience of proteomics and imaging-MS
> researchers. Cover these screens as connected wireframes: (1) the start / file-open
> page; (2) the capability-adaptive application shell with its left sidebar (Summary,
> Spectra, Chromatograms, an Advanced group, and an Imaging/MSI group that only appears
> for imaging files); (3) the Summary overview; (4) the Spectra view (m/z vs intensity
> plot with spectrum selection); (5) the Imaging view (ion-image canvas with colormap
> legend, an m/z + tolerance control with a render progress indicator, and a docked
> per-pixel spectrum); and (6) the parquet Structure inspector. Keep the dense,
> instrument-grade aesthetic and the existing token palette (IBM Plex Sans/Mono, the
> #3b54da blue accent, the slate neutrals). For each screen, call out concrete UX
> improvements — information hierarchy, empty/loading/error states, affordance clarity,
> accessibility, and the discoverability of the imaging round-trip (m/z → ion image →
> pixel → spectrum). Produce a handoff document summarizing the proposed changes,
> component inventory, and rationale. Do not assume any backend; everything is
> client-side and static-deployable.

## AS-SENT (2026-06-15, Product wireframe, project /p/11a8b2ef-…, model Claude Opus 4.8)
GitHub repo-picker did not surface in the UI, so the repo URL was embedded inline in the
prompt (+ the loaded mzPeak IV Design System provides token/component context). Exact text:

> Using the GitHub repository https://github.com/okohlbacher/mzpeakviewer (reuse its
> existing components, design tokens, and styling) together with the loaded mzPeak design
> system, produce an in-depth design review and redesign proposal for this scientific
> mass-spectrometry data viewer, for an audience of proteomics and imaging-MS researchers.
> Cover these screens as connected wireframes: (1) the start / file-open page; (2) the
> capability-adaptive application shell with its left sidebar (Summary, Spectra,
> Chromatograms, an Advanced group, and an Imaging/MSI group that only appears for imaging
> files); (3) the Summary overview; (4) the Spectra view (m/z vs intensity plot with
> spectrum selection); (5) the Imaging view (ion-image canvas with colormap legend, an m/z
> + tolerance control with a render progress indicator, and a docked per-pixel spectrum);
> and (6) the parquet Structure inspector. Keep the dense, instrument-grade aesthetic and
> the existing token palette (IBM Plex Sans/Mono, the #3b54da blue accent, slate neutrals).
> For each screen, call out concrete UX improvements: information hierarchy,
> empty/loading/error states, affordance clarity, accessibility, and discoverability of the
> imaging round-trip (m/z to ion image to pixel to spectrum). Produce a handoff document
> summarizing the proposed changes, a component inventory, and rationale. Everything is
> client-side and static-deployable; assume no backend.

## Wizard answers (2026-06-15) — Claude Design read the GitHub repo successfully
Claude Design confirmed it browsed the repo ("Browsing GitHub repo ×2, Github read file") +
the design system, then asked a clarifying wizard. Answered from the brief:
- **Fidelity:** Mid-fi greyscale blocks using the real IBM Plex type + #3b54da accent
  (keeps the token palette per the brief without full hi-fi cost).
- **Direction:** One cohesive redesign across all 6 screens.
- **Packaging:** Connected/clickable wireframes (nav between screens) + a separate handoff doc.
- **Annotation depth:** Dense — every change annotated with before/after rationale.
- **Improvements to emphasize (multi):** imaging round-trip discoverability, empty/loading/error
  states, information hierarchy & density, accessibility, affordance clarity, capability-adaptive nav.
- **Per-screen states:** Yes — show key empty/loading/error/active states where they matter.
- **Imaging round-trip note:** make m/z→ion-image→pixel→spectrum self-evident; clear
  render-progress + "ion image ready" state (background prefetch warms it); keep the docked
  per-pixel spectrum visible; connect colormap/scale legend + readout to the canvas.
