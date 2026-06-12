---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: unify-mzpeakiv-mzpeakexplorer
status: planning
stopped_at: Step H harmonization (H1 one reader + H2 both apps ingested, all green); Phase 1 contracts shipped
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

## Step H — harmonization (DONE except e2e)

Operator chose copy-snapshot + run-now-on-fork-pin (HARMONIZATION-PLAN §6).
- **H1 ✅** one `vendor/mzpeakts` submodule @ `4067f84` (aux-arrays + Numpress Linear).
- **H2 ✅** both apps ingested (`apps/iv` @a5ec7c6, `apps/explorer` @f0723b0), rewired to
  the one reader; workspace = `packages/* + apps/*`. typecheck + unit + prod build green
  for both (Explorer 48, IV 150, contracts 49). Commit `141b853`.
- **H3 ⏳** remaining: port IV's Playwright harness to `apps/explorer` so "both apps e2e
  green" is an actionable parity gate (review codex #12). Then Step H is fully closed.

## Next actions

1. Close H3: add Explorer e2e (reuse `apps/iv/e2e` + a shared fixture), run both apps' e2e.
2. Begin **Phase 2** (`packages/ui-kit`): unify the value-equal tokens (Explorer base +
   IV imaging extras) + lift the verified zero-store-ref components (SpectrumPlot/useUplot/
   chartTheme, TreeView, components primitives + IV ds/*, cvTerms/format); both apps import
   from `@mzpeak/ui-kit`; snapshot/e2e parity gate. (Tabs stay in the apps — container line.)
3. Operator: review `research/ADVERSARIAL-REVIEW-v2-SYNTHESIS.md` and apply the roadmap
   deltas (Phase 0 → schedule-critical; split Phase 3's Structure/Parquet workerization
   into a spike; narrow Phase 2 ui-kit scope; move cancellation/perf/redirect smoke tests
   earlier; add the `0→2` dependency edge).
2. Land Phase 0 prerequisite (HUPO-PSI/mzpeakts#1 merge → single vendored reader).
3. Phase 2/3 consume `@mzpeak/contracts`: the engine implements `MESSAGE_POLICY`; both
   shells wire the URL module behind their existing resolvers as a no-op parity check.
4. Decide whether the source apps are moved into this repo now or after Phase 1.
