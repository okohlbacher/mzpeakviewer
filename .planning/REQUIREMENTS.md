# mzpeakviewer — Requirements

Requirement IDs mapped to phases in [ROADMAP.md](ROADMAP.md). Derived from the
synthesized, adversarially-reviewed design at [research/MERGE-ROADMAP.md](research/MERGE-ROADMAP.md).

## RDR — Reader convergence (Phase 0)
- **RDR-01** One vendored `mzpeakts` commit has aux-array support AND a working Numpress Linear decode; no local reader patches remain.
- **RDR-02** The `DataArrays`/`Reader` type deltas between the two trees are reconciled into one type surface.
- **RDR-03** Both source apps build, typecheck, and pass existing tests against that one reader via a single consumption mechanism (git submodule).

## CTR — Unified contracts (Phase 1, KEYSTONE)
- **CTR-01** Superset `WorkerRequest`/`WorkerResponse` union covering every IV imaging message + every Explorer browse/archive/parquet/scan/chrom/study message, each annotated with clone-vs-transfer, size cap/paging, and cancellation.
- **CTR-02** Unified zustand store shape + view-state model (single source of truth for active `view`, selection, settings policy).
- **CTR-03** Capability model: `isImaging` (standardized on `probeIsImaging` 3-signal semantics), `numChromatograms`/`hasTicColumn`, `hasOptical`; plus a detection-override signal.
- **CTR-04** URL grammar as a pure parse/serialize module: full param set, conflict matrix, view inference, canonicalization, and legacy `/IV/` translation (`scan=N→spectrum=N-1`, `&tol=` folding) — unit-tested.
- **CTR-05** A written contract spec (protocol + store + capability + URL); zero engine/UI migration in this phase.

## KIT — Shared ui-kit (Phase 2)
- **KIT-01** npm-workspace monorepo with `@mzpeak/ui-kit` design tokens (the value-equal token set) building independently.
- **KIT-02** Purely presentational components in ui-kit (uPlot spectrum plot, metadata JSON tree, structure/parquet inspector view, cv/format utils) — no reader/store/imaging assumptions.
- **KIT-03** Both source apps consume ui-kit tokens + components and remain visually/behaviorally identical (snapshot/e2e green).

## ENG — Engine migration `@mzpeak/core` (Phase 3)
- **ENG-01** One Web Worker engine owns the Reader (Arrow/WASM handles never cross the boundary) + scheduler + LRU cache storage in-worker.
- **ENG-02** All Explorer main-thread data access (archiveList, parquetFooter, deepColumn, sampleColumn, scanBreakdown, XIC/stored chrom, studyMeta) rewritten as messages.
- **ENG-03** IV imaging handlers (renderIonImage, renderMultiChannel, meanSpectrum/ROI, opticalImage, grid) merged into the one engine.
- **ENG-04** Per-message cancellation + transfer lists + size caps/paging; large member reads stream/transfer (no 256 MB structured clone); single open file per session.
- **ENG-05** Golden-output parity tests vs old outputs for an imaging AND an LC fixture; imaging + LC e2e green; file→ion-image→spectrum invariant under e2e.

## NAV — Unified shell + capability sidebar (Phase 4)
- **NAV-01** Capability-adaptive rail: always-on Summary + Spectra; grouped accordions; single active `view`.
- **NAV-02** Advanced accordion (collapsed default, auto-expand on deep link) holding Metadata + Structure.
- **NAV-03** Imaging (MSI) accordion (Ion image / Optical / Overlay / Grid), gated on `isImaging`, lazy-loaded as a separate chunk.
- **NAV-04** Chromatograms gated on actual chromatogram capability, INDEPENDENT of imaging (an imaging file with stored chromatograms shows both).
- **NAV-05** Pixel-click and ROI selection route to the Spectra view (preserve the file→image→pixel→spectrum loop).
- **NAV-06** Accessibility: `tablist`/`tab`/`tabpanel` + accordion `aria-expanded`, roving focus, keyboard nav, deep-link auto-expand — as acceptance criteria/tests.
- **NAV-07** Imaging-detection override UI for mis-detected files (force on/off; surface the discrepancy); detection-parity tests.
- **NAV-08** The two zustand stores merged into the Phase-1 unified shape.

## URL — Unified resolver + link stability (Phase 5)
- **URL-01** Parse→replay on load (apply view/selection/data params in canonical order).
- **URL-02** Serialize←Share-view (shortest canonical link; `scan` preferred over `spectrum`).
- **URL-03** Conflict resolution + canonicalization per the §3 matrix; mixed spectrum+data params both applied.
- **URL-04** Legacy `/IV/` translation: `scan=N→spectrum=N-1`, `&tol=`→`ion=mz,tol`.
- **URL-05** Per-target redirect mechanism: committed client-side `index.html` shim for GitHub Pages + server/redirect for mzpeak.org; query string carried.
- **URL-06** Cross-mode params on the wrong file type → non-blocking, dismissible info notice (never error/blank).
- **URL-07** Old-link regression corpus + query-preservation tests for both source apps' links.

## DEP — Safety, deploy, decommission (Phase 6)
- **DEP-01** Compatibility harness: golden engine outputs + imaging/LC e2e + redirect tests + worker-cancellation tests.
- **DEP-02** Performance + memory budgets for worker round-trip vs old main-thread reads (no regression for small files).
- **DEP-03** Rollback/canary: old `/IV/` + `/view/` artifacts stay deployable during a canary window; documented restore.
- **DEP-04** Single combined-site deploy (unified app at `/view/`, `/IV/` shim); one CI pipeline.
- **DEP-05** Fixture consolidation into one imaging+LC test matrix.
- **DEP-06** Decommission retired apps; update docs/redirects.
