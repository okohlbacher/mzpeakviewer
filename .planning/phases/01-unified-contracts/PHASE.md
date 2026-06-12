# Phase 1 — Unified Contracts (KEYSTONE)

**Depends on:** Phase 0 · **Requirements:** CTR-01…CTR-05 · **Risk:** low (keystone) · **UI:** no

**Goal:** Define every contract the engine and shell are built against — as TYPES,
a SPEC, and TESTS, with zero runtime behavior change: the superset worker protocol
(all IV imaging + all Explorer browse/archive/parquet/scan/chrom/study messages,
each annotated clone-vs-transfer, size-cap/paging, cancellation); the unified
zustand store + view-state model; the capability model (`isImaging` via
`probeIsImaging` 3-signal semantics, `numChromatograms`/`hasTicColumn`,
`hasOptical`); and the URL grammar as a pure parse/serialize module (conflict
matrix, view inference, canonicalization, legacy `/IV/` translation).

**Deliverable:** `@mzpeak/contracts` (protocol + store + capability types, URL
module) + a contract spec doc + passing parser/canonicalization tests. NO engine
or UI migration.

**Why first:** breaks the circular dependency the adversarial review flagged —
nothing migrates before the contracts exist.

Full detail: [../../ROADMAP.md](../../ROADMAP.md) → Phase 1. Run `/gsd:plan-phase 01`.
