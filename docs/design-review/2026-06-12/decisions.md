# Phase 5 — Decisions — mzPeak Viewer design review — 2026-06-12

Decision frame: the generated prototype is a **layout/visual reference**, not an
implementation. The real app (`app/`, `packages/*`) is already correct on most of
the contract/a11y points the prototype *regressed*. So findings split three ways:
**ADOPT** (port a genuine improvement), **DISCARD** (mock fabrication — never port),
**NO-OP** (real app already does it right; finding is prototype-only).

## Adopted improvements → roadmap (user-confirmed all four)

| Decision | Finding link | Rationale |
|----------|-------------|-----------|
| **Persistent spectrum dock** on imaging views (pixel-pick → spectrum below the heatmap, in-place; keep full Spectra view too) | improvement over F-29 baseline | Biggest UX gain; sharpens the core "click a pixel → see its spectrum" round-trip without a view switch. |
| **Enriched demo cards** with REAL per-fixture facts | corrects F-01 the right way | Adopt the card *style* (stat chips), populated from the real fixtures: demo 3×3 px·100 µm·9 px; lc 48 spectra·MS 1/2·TIC; chunked 48 spectra·chunked Parquet. Never the invented numbers. |
| **Nav + view-header + notice-bar polish** | improvement; keep real a11y (F-13) | Icons + active-rail + section grouping + file-stats footer; per-view headers with subtitles; the existing NoticeBar stays. MUST retain the real app's tablist a11y (do not adopt the prototype's regression). |
| **Summary view tiles + TIC thumbnail** | improvement | Metric tiles + capability cards + small TIC thumbnail on Summary. |

## Discard (mock fabrication / invented capability — do NOT port)

Accepted as "real-app must not gain these": **F-01** invented dataset numbers,
**F-05** mock engine / per-pixel-spectra / charge-state / peak-list, **F-08** CLAHE /
Equalize / smoothing σ / percentile-preset controls, **F-09** base-peak overview mode,
**F-10** fabricated optical images, **F-14** fabricated acquisition metadata & Parquet
internals, **F-15**/**F-21** "finished" Grid (real Grid stays an honest placeholder
until built), **F-16** TIFF-export-that-emits-PNG, **F-17** fake "mean spectrum",
**F-18** custom plot mocks (keep `@mzpeak/ui-kit`/uPlot), **F-19** fake share hash,
**F-27** decorative scalebar. Rationale: each contradicts the real engine surface or
the brief's "don't invent capabilities" instruction.

## No-op (real app already correct — prototype-only defect)

**F-02** logo (real app already uses `mzpeak-logo.png`), **F-03** sentinel (real
`render.ts` already uses `#1a1a1a`), **F-04** dropzone a11y (real `Idle.tsx` already
`role=button`+tabIndex+keys), **F-06** view ids (real union is bare), **F-07** open/URL
flow (real app real), **F-11** capability model (real app nested + `showChromatograms`),
**F-12/F-23** legend tokens (real app's inline viridis LUT is acceptable),
**F-13** nav a11y (real app has full tablist), **F-26** DS namespace, **F-28** prototype
artifacts. No action in the real app beyond not regressing them.

## Investigate

- **F-20** dark-stage text contrast — when porting the nav/header polish and the
  spectrum dock, verify any muted text on the dark imaging stage meets WCAG AA
  (≥4.5:1). Currently the real `Imaging.tsx` stage uses `--ink` with `--text-muted`;
  confirm or darken-down.
- **F-29** "RGB channels" label vs `multi` view id — already resolved: the real
  sidebar labels the `multi` view "RGB channels"; keep label, keep id.

## Fix at source (real repo, surfaced by the review)

- **F-28 tail** — the stale `/* Material blue (#1565c0) accent */` comment in
  `packages/ui-kit/src/styles/tokens/colors.css:3` predates this work and contradicts
  the real `--blue-600: #3b54da`. Correct the comment (cosmetic, 1-line).
