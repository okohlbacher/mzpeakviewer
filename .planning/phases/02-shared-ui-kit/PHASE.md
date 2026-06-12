# Phase 2 — Shared ui-kit

**Depends on:** Phase 1 · **Requirements:** KIT-01, KIT-02, KIT-03 · **Risk:** low · **UI:** yes

**Goal:** Stand up the npm-workspace monorepo and extract the low-risk, purely
presentational surface into `@mzpeak/ui-kit`: design tokens (the value-equal token
set) + components with no reader/store/imaging assumptions (uPlot spectrum plot,
metadata JSON tree, structure/parquet inspector view, cv/format utils). Both
existing shells consume them with behavior unchanged. Data-bound widgets (file
loader) stay in the shells.

**Deliverable:** one design system + shared presentational components; both source
apps visually/behaviorally identical (snapshot/e2e green).

May overlap with Phase 3 (both depend only on Phase 1).

Full detail: [../../ROADMAP.md](../../ROADMAP.md) → Phase 2. Run `/gsd:plan-phase 02`.
