---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: unify-mzpeakiv-mzpeakexplorer
status: building
stopped_at: Phases 0–5 done; 180 unit + 15 e2e green; HEAD 5175c0c. Post-Phase-5 UAT polish (demo datasets, isobaric channel pills, deep parquet inspector) landed. Phase 6 (safety harness + single deploy + decommission) is next.
last_updated: "2026-06-14"
last_activity: 2026-06-14
progress:
  total_phases: 7
  completed_phases: 5
  total_plans: 0
  completed_plans: 0
  percent: 82
---

# Project State

## Project Reference

See: .planning/PROJECT.md

**Core value:** Open any mzPeak in a browser and explore it; the imaging (MSI) layer activates only for imaging files — one app replacing mzPeakIV + mzPeakExplorer.
**Current focus:** Phase 6 — Safety Harness + Single Deploy + Decommission (Phases 0–5 complete).

## Current Position

**Phases 0–5 complete; the app runs end-to-end in a browser** and is preview-deployed on
`gh-pages` (with the legacy `/IV/` shim + demo datasets). HEAD `5175c0c`. Built:
- **Phase 0/H1** `vendor/mzpeakts` submodule @4067f84 (aux-arrays + Numpress).
- **Phase 1** `@mzpeak/contracts` (49 tests) — protocol/wire/capability/store + URL grammar.
- **Phase 2** `@mzpeak/ui-kit` (19 tests) — tokens + harvested pure components; 2 review rounds.
- **Phase 3** `@mzpeak/core` (112 tests) — pure adapters + reader-I/O engine fns + worker
  dispatcher; opens REAL imaging + LC fixtures, VALUE-PARITY vs the old readers
  (spectrum within 1e-6, TIC matches); imaging-render handlers (ion/optical/multichannel).
- **Phase 4** `app/` — capability-adaptive shell: capability-gated sidebar (Advanced + MSI
  accordions), merged zustand store, pixel→spectrum round-trip, a11y tablist, lazy MSI views.
- **Phase 5** URL resolver + link stability — deep-link grammar/resolver wired, `/IV/`
  `scan=N→spectrum=N-1` shim, share button.

Total: **180 unit + 15 Playwright e2e, all green**; typecheck + build clean across all four
workspaces. Post-Phase-5 UAT polish landed (front-page demo datasets, isobaric channel pills,
deep parquet inspector, download abort).

## Next actions (Phase 6 — Safety Harness + Single Deploy + Decommission)
1. Compatibility/perf/memory harness + a rollback canary.
2. Collapse to one deploy on mzpeak.org (`/view/`); redirect the old `/IV/` and `/view/` paths.
3. Decommission the source apps (mzPeakIV, mzPeakExplorer) once parity + redirects are verified.

## How this was created

Design synthesized in `~/Claude/mzPeakIV` (where PROC-01 + the source-app analysis live), adversarially reviewed (codex + vibe — both REJECTED v1; outputs in `research/ADVERSARIAL-REVIEW-*.md`), revised to v2 (`research/MERGE-ROADMAP.md`), then harnessed into this 7-phase milestone. Operator decisions on record: repo home = fresh monorepo (`mzpeakviewer`); harness = scaffold directly from v2.

## Open decisions (non-blocking; see research/MERGE-ROADMAP.md §5)

- App URL: keep `/view/` unified path + `/IV/` shim (recommended).
- Workspace tool: npm workspaces (recommended).
- mzpeakts post-merge: single submodule (recommended).
- Phase 7 (extra deep-link capabilities `ch=`/`roi=`/`px=`): in or backlog.

## Model correction (operator, 2026-06-12)

We build **one new app**; the old apps are **external read-only sources** we harvest code
from (not hosted/built here). An earlier attempt copied both whole apps into `apps/iv` +
`apps/explorer` as in-repo parity oracles — that was removed. Parity is now via golden
fixtures captured from the old apps + their live deploys. ROADMAP Phase 2/3 success criteria
realigned accordingly. See `research/HARMONIZATION-PLAN.md` (revised).

Useful finding kept from the throwaway copies: both old codebases compile + unit-pass on the
single converged reader `4067f84` — Phase-0 convergence de-risked.

## Phase history (per-phase detail)

- **Phase 0/H1** — `vendor/mzpeakts` submodule @ `4067f84` (aux-arrays + Numpress Linear).
- **Phase 1** — `packages/contracts` (49 tests). Enriched post-Phase-3-maps: `BrowseIndex`,
  richer `ParquetFooter`/member types, required-nullable `SpectrumArrays.representation`.
- **Phase 2** — `packages/ui-kit` (19 tests): unified tokens (palette value-equal + Explorer
  semantic aliases) + IV ds primitives + Explorer SpectrumPlot/ChromPlot/TreeView/reporters/
  cvTerms; purely presentational; style **closure test** guards parity. Two codex review
  rounds (reject→reject→green); see `phases/02-shared-ui-kit/NOTES.md`.
- **Phase 3** — `packages/core` (112 tests): pure adapters + reader-I/O engine fns + worker
  dispatcher; value-parity vs the old readers; imaging-render handlers (ion/optical/
  multichannel). Two slices, each dual-reviewed (codex rejects → all fixed).
- **Phase 4** — `app/`: capability-adaptive shell (capability-gated sidebar, merged store,
  pixel→spectrum round-trip, a11y tablist, lazy MSI views).
- **Phase 5** — URL resolver + link stability (deep-link grammar/resolver, `/IV/` shim,
  share button); 15 Playwright e2e.

See `## Next actions` above for the remaining Phase 6 work.
