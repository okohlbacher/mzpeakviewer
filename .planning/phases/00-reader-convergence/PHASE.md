# Phase 0 — Reader Convergence

**Depends on:** nothing (prerequisite) · **Requirements:** RDR-01, RDR-02, RDR-03 · **Risk:** low

**Goal:** Both source apps build against ONE vendored `mzpeakts` that has aux-array
support AND a working Numpress Linear decode (HUPO-PSI/mzpeakts#1), via a single
consumption mechanism (git submodule), with `DataArrays`/`Reader` type deltas
reconciled and no local reader patches remaining.

**Deliverable:** identical reader in both trees; both build/typecheck/test green.

**In flight:** gated on the upstream PR merge; fallback = pin to the fork commit.

Full detail + success criteria: [../../ROADMAP.md](../../ROADMAP.md) → Phase 0.
Run `/gsd:plan-phase 00` to generate executable plans.
