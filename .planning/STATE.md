---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: unify-mzpeakiv-mzpeakexplorer
status: planning
stopped_at: Shared core in place (one reader submodule + Phase 1 contracts); one-app harvest model adopted
last_updated: "2026-06-12"
last_activity: 2026-06-12
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 8
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

## Shared core in place

- `vendor/mzpeakts` submodule @ `4067f84` (aux-arrays + Numpress Linear, one commit).
- `packages/contracts` shipped (49 tests). Workspace = `packages/*`.

## Next actions

1. Begin **Phase 2** (`packages/ui-kit`): unify the value-equal tokens (Explorer base + IV
   imaging extras) + harvest the verified zero-store-ref components (SpectrumPlot/useUplot/
   chartTheme/uplotZoom, TreeView, `components.tsx` primitives + IV `ds/*`, cvTerms/format)
   from the read-only sources; parity via captured render fixtures. Containers stay out.
2. Operator: review `research/ADVERSARIAL-REVIEW-v2-SYNTHESIS.md` and apply the remaining
   roadmap deltas (Phase 0 → schedule-critical; split Phase 3's Structure/Parquet
   workerization into a spike; move cancellation/perf/redirect smoke tests earlier).
2. Land Phase 0 prerequisite (HUPO-PSI/mzpeakts#1 merge → single vendored reader).
3. Phase 2/3 consume `@mzpeak/contracts`: the engine implements `MESSAGE_POLICY`; both
   shells wire the URL module behind their existing resolvers as a no-op parity check.
4. Decide whether the source apps are moved into this repo now or after Phase 1.
