---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: unify-mzpeakiv-mzpeakexplorer
status: building
stopped_at: Phase 3 engine (open/spectrum/scan/chrom, dual-reviewed, value-parity) + Phase 4 slice 1 (app runs in a browser, e2e green)
last_updated: "2026-06-12"
last_activity: 2026-06-12
progress:
  total_phases: 7
  completed_phases: 3
  total_plans: 0
  completed_plans: 0
  percent: 52
---

# Project State

## Project Reference

See: .planning/PROJECT.md

**Core value:** Open any mzPeak in a browser and explore it; the imaging (MSI) layer activates only for imaging files — one app replacing mzPeakIV + mzPeakExplorer.
**Current focus:** Phase 0 — Reader Convergence (prerequisite; in flight via HUPO-PSI/mzpeakts#1).

## Current Position

**The app runs end-to-end in a browser** (Phase 4 slice 1, e2e green). Built so far:
- **Phase 0/H1** `vendor/mzpeakts` submodule @4067f84 (aux-arrays + Numpress).
- **Phase 1** `@mzpeak/contracts` (49 tests) — protocol/wire/capability/store + URL grammar.
- **Phase 2** `@mzpeak/ui-kit` (19 tests) — tokens + harvested pure components; 2 review rounds.
- **Phase 3** `@mzpeak/core` (93 tests) — pure adapters + reader-I/O engine fns + worker
  dispatcher; opens REAL imaging + LC fixtures in node, VALUE-PARITY vs the old readers
  (spectrum within 1e-6, TIC matches). Two slices, each dual-reviewed (codex comprehensive
  rejects → all fixed). SLICE1-NOTES / SLICE2-NOTES.
- **Phase 4 slice 1** `app/` — Vite+React shell wiring EngineClient ↔ engine.worker ↔ ui-kit.
  Builds with the worker+wasm landmine cleared (hashed 6.6MB wasm, separate worker chunk);
  Playwright smoke opens imaging + LC fixtures in real Chromium and renders spectrum 0. ✅

Total: 161 unit tests + 2 e2e, all green; everything pushed (HEAD `47cf5dd`).

## Next actions
1. Phase 4 slice 2 — capability sidebar (Summary/Spectra/Chromatograms + Advanced) + the
   merged store + deep-link resolver (wire the Phase-1 URL module). Harvest Explorer shell
   primitives (NOTES §7 deferred: PlotSpinner/Logo/SideNav/TextField/AppHeader).
2. Phase 3 imaging-render slice — ion image / optical / multi-channel / ROI engine handlers
   (IV compute) → the MSI accordion (lazy chunk) → the full spatial round-trip.
3. The Structure/Parquet spike (archive/parquetFooter/deepColumn cache-identity redesign).

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

## Done so far

- **Phase 0/H1** — `vendor/mzpeakts` submodule @ `4067f84` (aux-arrays + Numpress Linear).
- **Phase 1** — `packages/contracts` (49 tests). Enriched post-Phase-3-maps: `BrowseIndex`,
  richer `ParquetFooter`/member types, required-nullable `SpectrumArrays.representation`.
- **Phase 2** — `packages/ui-kit` (19 tests): unified tokens (palette value-equal + Explorer
  semantic aliases) + IV ds primitives + Explorer SpectrumPlot/ChromPlot/TreeView/reporters/
  cvTerms; purely presentational; style **closure test** guards parity. Two codex review
  rounds (reject→reject→green); see `phases/02-shared-ui-kit/NOTES.md`.

## Next actions (Phase 3 — engine, HIGH risk / long pole)

Plan: `phases/03-engine-migration/SPIKE-PLAN.md` (+ MAP-iv-worker / MAP-explorer-data).
1. Build the **parity gate**: capture golden fixtures from the read-only old apps (open/
   scanBreakdown/selectSpectrum/extractChrom/renderIonImage on a small imaging + LC fixture).
2. Scaffold `packages/core` worker (base = IV's worker) + the main-thread protocol client;
   migrate messages in the maps' order (open → selectSpectrum → archive → extractChrom → …).
3. **Spike** the Structure/Parquet cache-identity redesign before #5/#7 (the reviews' CRITICAL).
4. Operator: apply remaining roadmap deltas from `ADVERSARIAL-REVIEW-v2-SYNTHESIS.md`.
2. Land Phase 0 prerequisite (HUPO-PSI/mzpeakts#1 merge → single vendored reader).
3. Phase 2/3 consume `@mzpeak/contracts`: the engine implements `MESSAGE_POLICY`; both
   shells wire the URL module behind their existing resolvers as a no-op parity check.
4. Decide whether the source apps are moved into this repo now or after Phase 1.
