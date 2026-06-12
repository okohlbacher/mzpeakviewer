---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: unify-mzpeakiv-mzpeakexplorer
status: building
stopped_at: Phase 2 ui-kit done (2 review rounds, green); Phase 3 engine kicked off (skeleton + spike plan)
last_updated: "2026-06-12"
last_activity: 2026-06-12
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 0
  completed_plans: 0
  percent: 30
---

# Project State

## Project Reference

See: .planning/PROJECT.md

**Core value:** Open any mzPeak in a browser and explore it; the imaging (MSI) layer activates only for imaging files — one app replacing mzPeakIV + mzPeakExplorer.
**Current focus:** Phase 0 — Reader Convergence (prerequisite; in flight via HUPO-PSI/mzpeakts#1).

## Current Position

Phase: 01 (Unified Contracts — first version delivered ahead of the Phase-0 gate)
Plan: None (built directly as the "first version" deliverable; not run through /gsd:plan-phase)
Status: `@mzpeak/contracts` package shipped — npm workspace + protocol/wire/capability/store
types + a pure URL grammar module + 49 passing tests + `SPEC.md`. Build, typecheck, and
tests all green. Phase 0 (reader convergence) is still gated on HUPO-PSI/mzpeakts#1 (OPEN)
and was intentionally NOT done here — the contracts decouple from the reader, so Phase 1
could land first. A round-2 design review (codex + vibe) was run on the v2 roadmap; both
returned `reject` on under-specification, which the contracts resolve — see
`research/ADVERSARIAL-REVIEW-v2-SYNTHESIS.md`.

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
