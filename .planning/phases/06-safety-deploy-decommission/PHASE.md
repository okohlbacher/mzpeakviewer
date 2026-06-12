# Phase 6 — Safety Harness + Single Deploy + Decommission

**Depends on:** Phase 5 · **Requirements:** DEP-01…DEP-06 · **Risk:** low–medium · **UI:** no

**Goal:** BEFORE flipping deploys, stand up the safety harness and a rollback path;
then collapse to one deploy and decommission the retired apps.

**Safety harness:** golden engine outputs (new vs old) for imaging + LC fixtures;
imaging + LC e2e; redirect/query-preservation tests; worker-cancellation tests;
performance + memory budgets (worker round-trip must not regress old main-thread
reads for small files).

**Rollback/canary:** old `/IV/` and `/view/` artifacts stay deployable during a
canary window; documented restore.

**Deploy collapse:** combined-site build publishes ONE app section (unified app at
`/view/`, `/IV/` shim); one CI pipeline; fixtures consolidated into one imaging+LC
matrix; docs/redirects updated; retired apps decommissioned.

**Deliverable:** one app live on mzpeak.org + GitHub Pages; old deep links resolve;
CI is one pipeline; rollback documented.

**Policy:** deploy blast radius must be surfaced before running.

Full detail: [../../ROADMAP.md](../../ROADMAP.md) → Phase 6. Run `/gsd:plan-phase 06`.
