# Phase 3 — Engine Migration (`@mzpeak/core`)

**Depends on:** Phase 1 · **Requirements:** ENG-01…ENG-05 · **Risk:** HIGH (long pole) · **UI:** no

**Goal:** Implement the Phase-1 protocol as ONE Web Worker engine that owns the
`mzpeakts` Reader, hosts the scheduler + LRU cache storage in-worker, and exposes
all reads/compute as messages — including a full rewrite of Explorer's main-thread
data access (archiveList, parquetFooter, deepColumn, sampleColumn, scanBreakdown,
XIC/stored chrom, studyMeta) into cancellable, transfer-aware messages, merged with
IV's imaging handlers. Both shells call the engine via thin adapters.

**Boundary:** Arrow/WASM handles never cross; large member reads stream/transfer
(no 256 MB structured clone); browser-policy ops (object URLs, downloads,
sessionStorage, cache policy) stay on the main thread; single open file per session.

**Gate:** golden-output parity tests vs old outputs for an imaging AND an LC
fixture; imaging + LC e2e green; file→ion-image→spectrum invariant under e2e.

**Deliverable:** both apps' data paths run through the single worker, behind
unchanged UX.

Full detail: [../../ROADMAP.md](../../ROADMAP.md) → Phase 3. Run `/gsd:plan-phase 03`.
