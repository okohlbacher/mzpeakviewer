---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: unify-mzpeakiv-mzpeakexplorer
status: planning
stopped_at: Milestone scaffolded from reviewed v2 roadmap
last_updated: "2026-06-12"
last_activity: 2026-06-12
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md

**Core value:** Open any mzPeak in a browser and explore it; the imaging (MSI) layer activates only for imaging files — one app replacing mzPeakIV + mzPeakExplorer.
**Current focus:** Phase 0 — Reader Convergence (prerequisite; in flight via HUPO-PSI/mzpeakts#1).

## Current Position

Phase: 00 (not started)
Plan: None
Status: Planning — milestone scaffolded; phases defined in ROADMAP.md; ready for `/gsd:plan-phase 00`.

## How this was created

Design synthesized in `~/Claude/mzPeakIV` (where PROC-01 + the source-app analysis live), adversarially reviewed (codex + vibe — both REJECTED v1; outputs in `research/ADVERSARIAL-REVIEW-*.md`), revised to v2 (`research/MERGE-ROADMAP.md`), then harnessed into this 7-phase milestone. Operator decisions on record: repo home = fresh monorepo (`mzpeak-viewer`); harness = scaffold directly from v2.

## Open decisions (non-blocking; see research/MERGE-ROADMAP.md §5)

- App URL: keep `/view/` unified path + `/IV/` shim (recommended).
- Workspace tool: npm workspaces (recommended).
- mzpeakts post-merge: single submodule (recommended).
- Phase 7 (extra deep-link capabilities `ch=`/`roi=`/`px=`): in or backlog.

## Next actions

1. Land Phase 0 prerequisite (HUPO-PSI/mzpeakts#1 merge → single vendored reader).
2. `/gsd:plan-phase 01` for the keystone contracts phase once Phase 0 is green.
3. Decide whether the source apps are moved into this repo now or after Phase 1.
