# Implementation roadmap — mzPeak Viewer redesign — 2026-06-12

Source: design review of `okohlbacher/mzpeakviewer` (Claude Design project
`/design/p/6c3c94e7-733a-41f7-8c37-fdefcdfd0424`), adversarial review 2026-06-12,
decisions in `decisions.md`. Only the four ADOPTED improvements are scheduled; all
DISCARD/NO-OP findings are listed under "Not scheduled" so they are not re-litigated.

## Goal

Bring the validated visual improvements from the redesign into the **real** app
(Vite + React 19 + `@mzpeak/ui-kit`, Canvas-2D engine in `@mzpeak/core`) without
importing any of the prototype's fabricated data or invented capabilities. The result:
the same correct file → ion-image → pixel → spectrum round-trip, presented with a
sharper layout — an in-place spectrum dock, honest enriched demo cards, a more legible
capability-gated nav with per-view headers, and a richer Summary.

## Wave plan

| Wave | Theme | Target | Tasks | Exit criterion | Status |
|------|-------|--------|-------|----------------|--------|
| A | Quick wins (low-risk, data + layout) | ~1–2 days | T-01, T-02, T-05 | Enriched real-fixture demo cards live; every view has a header; ui-kit token comment fixed; build + e2e green. | ✅ DONE (commit `f07b1d0`) |
| B | Spectrum dock (marquee UX) | ~2–4 days | T-03 | On an imaging view, clicking a present pixel renders its spectrum in a dock below the heatmap in-place, while the full Spectra view still works. | ✅ DONE (commit `04516af`) |
| C | Summary + nav polish | ~3–5 days | T-04, T-06 | Summary shows metric tiles + capability cards + a TIC thumbnail; nav rows carry icons; contrast spike resolved. | ⏳ pending (T-04, T-06, SP-1) |

## Tasks

### T-01 — Enrich the demo cards with real fixture facts
- Effort: S · Wave: A · Depends on: —
- What: In `app/src/views/Idle.tsx`, extend the `DEMOS` array + card render with compact stat chips populated from the REAL fixtures (verified from each `mzpeak_index.json`): **demo** → "imaging · 3×3 px · 100 µm · 9 pixels · m/z 100–800"; **lc** → "LC-MS · 48 spectra · MS 1/2 · TIC"; **chunked** → "48 spectra · chunked Parquet". No computed-at-runtime reads; hard-code the verified facts.
- Acceptance: Each card shows a stat row; every number traces to the fixture index or the engine's reported stats; no value from the prototype's fabricated set appears (grep the diff for `31200/48210/162840/208`).
- Trace: corrects F-01 (Blocker); decision "Enriched demo cards".

### T-02 — Per-view headers with subtitles
- Effort: S · Wave: A · Depends on: —
- What: Add a small reusable `ViewHeader` (title + one-line subtitle) rendered at the top of each routed view in `app/src/App.tsx`'s `ViewRouter` (or per view component). Subtitles describe the view purpose (e.g. Ion image — "spatial map for an m/z window").
- Acceptance: All 11 views render a header; headers truncate cleanly at narrow widths (no overflow); no layout shift on the spectrum/heatmap canvases.
- Trace: improvement (F-29 baseline); decision "Nav + view-header + notice-bar polish".

### T-03 — Persistent spectrum dock on imaging views
- Effort: M · Wave: B · Depends on: T-02
- What: In `app/src/views/Imaging.tsx`, add an optional bottom dock that renders the currently-selected spectrum (via the existing `SpectrumPlot` from `@mzpeak/ui-kit`) beneath the stage. Pixel-pick keeps calling `store.selectSpectrum(idx)` (so the full Spectra view and URL selector stay in sync) AND surfaces the result in the dock without forcing a view switch. Dock is collapsible; absent until a pixel is picked.
- Acceptance: On the imaging demo, render an ion image, click a present pixel → its spectrum appears in the dock in-place AND `selector.by==="index"` updates; navigating to Spectra shows the same spectrum; no engine API beyond `selectSpectrum`/the store `spectrum` is used; build + imaging e2e pass.
- Trace: marquee improvement; decision "Persistent spectrum dock". Must NOT reintroduce F-05 (no `spectrumAt`, no charge-state/peak-list invented on the engine).

### T-04 — Summary: metric tiles + capability cards + TIC thumbnail
- Effort: M · Wave: C · Depends on: —
- What: In `app/src/views/Summary.tsx`, present file stats as metric tiles (spectra count, m/z range, layout, imaging y/n) + capability cards derived from `CapabilityModel`, and a small TIC thumbnail (reuse `store.ticColumn` for imaging via `rasterizeTic`, or `loadChrom({mode:"tic"})` for LC). All values from the real store; no fabricated acquisition metadata (F-14 stays discarded).
- Acceptance: Summary renders tiles + cards from real capabilities; the thumbnail shows real TIC data or is omitted when unavailable; no invented instrument/sample strings.
- Trace: improvement; decision "Summary view tiles + TIC thumbnail".

### T-05 — Fix stale ui-kit token comment
- Effort: S · Wave: A · Depends on: —
- What: Correct `packages/ui-kit/src/styles/tokens/colors.css:3` comment from "Material blue (#1565c0) accent" to reflect the real `--blue-600: #3b54da`.
- Acceptance: Comment matches the token value; no token value changes.
- Trace: F-28 tail (Info, fix-at-source).

### T-06 — Nav row icons + section grouping polish
- Effort: M · Wave: C · Depends on: —
- What: Add a leading icon per nav tab in `app/src/App.tsx` `TabButton`, keep the active-accent rail, and keep the existing tablist a11y (role=tab/tablist, roving tabindex, aria) intact. Icons decorative (`aria-hidden`).
- Acceptance: Each nav row shows an icon; keyboard nav + `aria-selected` unchanged (a11y e2e/contract still passes); F-13 NOT regressed.
- Trace: improvement; decision "Nav + view-header + notice-bar polish".

## Spikes (from Investigate)

| Spike | Question to answer | Timebox | Trace |
|-------|--------------------|---------|-------|
| SP-1 | Does muted text on the dark imaging stage (`--ink` + `--text-muted`, and any dock chrome added in T-03) meet WCAG AA ≥4.5:1 at the sizes used? Instrument it; darken-down tokens if not. | 0.5 day | F-20 (Major) |

## Not scheduled — Discard (mock fabrication; do not re-litigate)

| Finding | Rejection rationale |
|---------|---------------------|
| F-05, F-08, F-09, F-10, F-14, F-16, F-17, F-18, F-19, F-27 | Contradict the real `@mzpeak/core` engine surface and the brief's "don't invent capabilities" — never port. |
| F-15 / F-21 (finished Grid) | Real `grid` stays an honest placeholder until a real grid-inspector slice is scheduled. |

## Not scheduled — No-op (real app already correct)

F-02, F-03, F-04, F-06, F-07, F-11, F-12, F-13, F-23, F-26, F-28 — prototype-only
defects; the real app already implements the correct behavior. Action = do not
regress (guarded by the acceptance criteria of T-03/T-06).

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Spectrum dock re-introduces a view-switch race with `selectSpectrum`'s `view:"spectra"` side-effect | Med | Med | Dock reads `store.spectrum`; decouple dock display from the `view` field, or add a `dockOnly` flag so pixel-pick on imaging doesn't force-route to Spectra. Covered by T-03 acceptance. |
| Enriched cards drift from fixtures if fixtures change | Low | Low | Comment each stat with its fixture source; a fixture swap is a deliberate change that updates the card. |
| Nav icons hurt the dense-instrument legibility | Low | Low | Keep icons small + `aria-hidden`; SP-1 contrast check covers legibility. |

## Traceability check (bidirectional)

Forward (adopted/investigate → task/spike):
- Enriched cards (F-01 corrective) → **T-01** ✓
- View headers (F-29 baseline) → **T-02** ✓
- Spectrum dock → **T-03** ✓
- Summary tiles/thumbnail → **T-04** ✓
- Nav polish (keep F-13) → **T-06** ✓
- ui-kit token comment (F-28 tail) → **T-05** ✓
- F-20 (Investigate) → **SP-1** ✓

Backward (every cited finding exists in adversarial-review.md): F-01…F-29 all present ✓.
Every adversarial-review finding has a decision in decisions.md (Adopt / Discard /
No-op / Investigate) ✓. No orphans in either direction.

## Next steps offered

1. **Apply Wave A quick wins now** (T-01, T-02, T-05) in the real app, each verified — IN PROGRESS this session.
2. Optionally copy `roadmap.md` + `adversarial-review.md` into the repo under
   `docs/design-review/2026-06-12/` (needs confirmation).
3. Schedule Waves B/C (spectrum dock, Summary/nav polish) as follow-up.
