# Red-team review — FEASIBILITY auditor

Handoff audited: `design-reviews/mzpeakviewer-2026-06-15/handoff/review/mzPeak Viewer Handoff.html`
Ground truth: the real repo at `/Users/kohlbach/Claude/mzPeakViewer` (HEAD = `main`).

Every concrete claim in the handoff was grepped/read against the repo before being
asserted true or false below.

## Verdict in one line

The handoff's **architecture, tokens, and component inventory are accurate** — but its
**"before" state descriptions are substantially stale**: the start page and (especially)
the imaging view already ship most of the "after" affordances the handoff proposes as
new. The redesign is therefore lower-effort and lower-novelty than it presents.

## Findings

| Severity | Area | Finding | Evidence (repo file:line / quote) |
|---|---|---|---|
| Major | Imaging "before" | Handoff "before" for the Imaging view lists "an unframed render wait" and implies no progress bar; the redesign sells a "determinate render bar with pixel count" as new. **It already exists** — `IonRenderProgress`, a determinate bar driven by filled-cell counts. | `app/src/views/Imaging.tsx:188-189` (`// Ion-render progress (filled cells) — drives the progress bar`), `:554-555` (`<IonRenderProgress done total />`), `:722-724` (`Determinate progress bar shown while an ion image renders`) |
| Major | Imaging "before" / a11y | Handoff proposes keyboard pixel-picking ("arrows move a cursor cell, Enter picks … aria-live readout") as a redesign add. **Already implemented**: keyboard cursor cell, arrows + Enter/Space pick, and the canvas aria-label literally documents it. | `Imaging.tsx:142` (`Keyboard cursor cell … for accessible pixel picking`), `:426` (`Keyboard pixel picking (a11y): arrows move a cursor cell, Enter/Space picks`), `:590` (`aria-label="… Use arrow keys to move the cursor and Enter to inspect a pixel's spectrum"`), `:693` (`aria-live="polite"`) |
| Major | Imaging "before" | Handoff "before": "pixel-pick that can route away to Spectra"; "after": an in-place dock that keeps the ion image in view. **The in-place, non-routing dock already exists** (`route=false`), and the dock is the current default. The "before" misframes a shipped feature as a defect. | `Imaging.tsx:114-115` (`// route=false: fill the in-place spectrum dock without leaving the imaging view`), `:639-640` (`Persistent spectrum dock … Pixel-pick fills store.spectrum in-place (route=false)`), `:141` (`dockOpen` default `true`) |
| Major | Start page "before" | Handoff "before" for Start: "a spinner-only loading state", "two equal grey open-mode buttons", "three visually identical demo tiles", drop-zone with no `.mzpeak` sub-line / no accepted-formats link / no `role=button`/Enter-Space. **All four are already false.** Idle has a determinate `DownloadProgress` bar, a labelled `.mzpeak` drop-zone with `role=button`+keyboard, an mzpeak.org/examples link, and distinct titled cloud-vs-download buttons. | `app/src/views/Idle.tsx:309-328` (`DownloadProgress … Downloading… ${pct}%`), `:174-178` (`role="button"`, `tabIndex={0}`, `onKeyDown … Enter`/`" "`), `:192` (`Drop a <code>.mzpeak</code> file here`), `:201-203` (`link-mzpeak-examples … more at mzpeak.org/examples`), `:244`/`:251` (separate `☁ Open from cloud` / download buttons with distinct `title`s). The project's own `brief.md` corroborates: "three demo dataset cards (cloud-stream + download), URL field, paired OpenMS+mzPeak logos." |
| Major | Structure "after" | Handoff sells the manifest "View JSON → cross-link to Metadata" and the "≤50k-row sampled histogram stays opt-in" as redesign moves. **Both already exist** in the Structure inspector. | `app/src/views/Structure.tsx:2` (`manifest pinned, clicking it jumps to the Metadata JSON view`), `:5`/`:16` (`SAMPLE_ROWS = 50_000 … on-demand histogram`) |
| Minor | Component inventory | `ColormapScale` is tagged "extend (bind flush to canvas)", but the Imaging view does **not** render the `ColormapScale` primitive — it draws its legend from a `colormapGradientCss` helper. "Extend `ColormapScale`" would mean adopting an unused primitive, not extending the in-use code. Effort is mis-scoped (slightly higher than implied). | primitive exists at `packages/ui-kit/src/primitives/ColormapScale.tsx`; Imaging legend uses `colormapGradientCss` — `Imaging.tsx:25`, no `ColormapScale` import (`:18` imports only `SpectrumPlot`) |
| Minor | Kept-features list | Handoff §01 "Kept" lists "percentile clip + colormap + log scale" as existing user controls. Colormap (`Select`) and log scale (`Checkbox`) are real controls, but **percentile clip is hardcoded to `0.99`** — there is no percentile-clip control in the UI. Naming drift / overstated current surface. | `Imaging.tsx:531` (colormap `<select>`), `:539` (log-scale checkbox), `:290`/`:315` (`percentile: 0.99` literal, no control) |
| Info | Tokens / type / accent | **Correct.** `--blue-600 #3b54da` PRIMARY accent, IBM Plex Sans/Mono, `--focus-ring 0 0 0 3px rgba(59,84,218,0.28)`, `--ink #0e1216` stage all exist exactly as cited. | `packages/ui-kit/src/styles/tokens/colors.css:36` (`--blue-600: #3b54da; /* PRIMARY accent */`), `:122` (`--focus-ring`), `:27` (`--ink: #0e1216`); `typography.css:9-10` (IBM Plex Sans/Mono) |
| Info | Architecture fit | **Correct / no false architecture assumption.** Proposal stays React 19 + TS, zustand store, inline styles + ui-kit CSS tokens, Canvas 2D ion image, uPlot spectra, Web Worker engine. No CSS framework, no React component library that isn't there, no backend. | store usage `Imaging.tsx:99` (`useStore`), `engine` worker `:20`, uPlot via `SpectrumPlot` `:18`, Canvas 2D raster `:285-290` |
| Info | Component existence | **Correct.** Every "reuse" primitive the handoff names exists in `@mzpeak/ui-kit`: Button, SegmentedControl, Select, NumberField, Checkbox, Badge, StatRow, Panel, ColormapScale. The "exists in app source" tags for `MetricTile` and `ChannelPills` are accurate, and `SpectrumDock` exists in substance. The 3 "new" primitives (RoundTripStepper, CapabilityBanner, ShareCell) correctly do **not** exist. | `ls packages/ui-kit/src/primitives/` = Badge/Button/Checkbox/ColormapScale/NumberField/Panel/SegmentedControl/Select/StatRow; `Summary.tsx:282` (`function MetricTile`), `Spectra.tsx:84-98` (reporter/channel pills), `Imaging.tsx:644` (`data-testid="imaging-spectrum-dock"`) |
| Info | Capability/sidebar model | **Correct.** "real `role=tablist` sidebar … roving tabindex … Arrow/Home/End … auto-expand accordion owning active tab" matches the implementation precisely. Capability gating (MSI group only when `isImaging`, Chromatograms gated) is real. | `App.tsx:12-13` (`sidebar is a real tablist … roving tabindex, Enter/Space/Arrow`), `:131-140` (Arrow/Home/End), `:181-185` (`role="tab"`, `aria-selected`, roving `tabIndex`), `:307` (`role="tablist"`), `:86`/`:316`/`:338` (capability gating + MSI accordion) |

## Effort realism

Mostly plausible, with two caveats:

- The headline **"make the round-trip a guided loop" thesis is partly already shipped.**
  The imaging round-trip's hardest engineering pieces (in-place dock, render progress,
  keyboard picking, aria-live) exist. The remaining work is genuinely light
  (a `RoundTripStepper` presentational strip, copy, unit chips) — so the *effort* is
  realistic, but the *framing* overstates the gap and the novelty.
- **Imaging.tsx is a 42 KB single view** (`app/src/views/Imaging.tsx`, ~750 lines).
  Several proposed changes (stepper, on-stage readout chip + selection ring, legend
  flush-binding, prefetch "warming" badge) all land in this one already-dense file.
  That's a higher integration cost than the per-component table implies — not a blocker,
  but the inventory table's "thin presentational strip" understates touching this module.

## Categories with nothing to report

- **Blocker:** none. Nothing in the handoff rests on a non-existent component, token, or
  architecture; nothing proposed would break the product.
- **Wrong-framework / wrong-architecture assumptions:** none (see Info row above).

## Top line

The handoff is feasibility-clean on the things that usually sink an AI design export
(tokens, framework, component existence — all real and exactly named). Its real defect
is **honesty of the "before"**: it markets as redesign wins a determinate render bar,
in-place non-routing spectrum dock, keyboard pixel-picking + aria-live, a labelled
`.mzpeak`/keyboard drop-zone, a determinate download, and a manifest→JSON cross-link —
**all of which already ship today** (Imaging.tsx, Idle.tsx, Structure.tsx). The team
should treat the screen-by-screen "before" columns as unreliable and re-baseline against
current `app/src/views/*` before scoping work.
