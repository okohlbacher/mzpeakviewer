# mzpeakviewer — Roadmap

**Granularity:** coarse (7 phases, contracts-first)
**Project mode:** mvp (vertical slices — each phase ships a demonstrable, reviewable capability)
**Core Value:** Open ANY `.mzpeak` in a browser and explore it; the imaging (MSI) visualization layer activates only for imaging files — replacing the two separate apps (mzPeakIV `/IV/`, mzPeakExplorer `/view/`) with one, ending the duplicated reader / design-system / deploy maintenance.

This roadmap is derived from the synthesized design at [research/MERGE-ROADMAP.md](research/MERGE-ROADMAP.md) (v2), which incorporates a dual adversarial review (codex + vibe, both REJECTED v1 — outputs in `research/ADVERSARIAL-REVIEW-*.md`). The decisive correction over v1: **contracts are designed before any migration** (Phase 1), breaking the circular dependency where the engine was being migrated before the protocol/store/view/URL contracts it must satisfy were decided.

**Process:** every phase is bracketed by a Codex CLI adversarial review (round1 on the phase plan, round2 on the phase diff) per PROC-01 (`tools/codex_review.sh round{1,2} <phase>`), verdict copied into the phase commit footer.

## Phases

- [ ] **Phase 0: Reader Convergence** — one vendored `mzpeakts` with aux-arrays AND Numpress Linear; both source apps build on it. *(prerequisite; in flight via HUPO-PSI/mzpeakts#1)*
- [ ] **Phase 1: Unified Contracts (KEYSTONE)** — superset worker protocol + unified store shape + capability model + URL grammar module, as types/spec/tests with zero behavior change.
- [ ] **Phase 2: Shared ui-kit** — monorepo workspace; design tokens + purely presentational components extracted; both shells consume them unchanged.
- [ ] **Phase 3: Engine Migration (`@mzpeak/core`)** — one Web Worker engine; rewrite Explorer's main-thread data access as messages; merge IV's imaging handlers; parity/golden tests gate it.
- [ ] **Phase 4: Unified Shell + Capability Sidebar** — one app; capability-gated rail (Advanced + MSI accordions); merged store; pixel/ROI→spectrum; a11y; lazy MSI chunk.
- [ ] **Phase 5: Unified URL Resolver + Link Stability** — one deep-link grammar/resolver; legacy `/IV/` shim (`scan=N→spectrum=N-1`); per-target redirects; old-link regression corpus.
- [ ] **Phase 6: Safety Harness + Single Deploy + Decommission** — compatibility/perf/memory harness + rollback canary; collapse to one deploy; redirect old paths; decommission.

## Dependency order

`0 → 1 → {2, 3} → 4 → 5 → 6`. Phase 1 is the keystone; nothing migrates before it. Phases 2 and 3 depend only on Phase 1 and may overlap.

## Phase Details

### Phase 0: Reader Convergence
**Goal:** Both source apps build against ONE vendored `mzpeakts` that has auxiliary-array support (`b826397`) AND a working Numpress Linear decode (HUPO-PSI/mzpeakts#1), via a single consumption style (git submodule), with the `DataArrays`/`Reader` type deltas reconciled.
**Mode:** mvp
**Depends on:** Nothing (prerequisite)
**Requirements:** RDR-01, RDR-02, RDR-03
**Success Criteria:**
  1. A single vendored `mzpeakts` commit contains both aux-arrays and Numpress Linear decode; no local reader patches remain in either tree.
  2. Both mzPeakIV and mzPeakExplorer typecheck, build, and pass their existing test suites against that one reader.
  3. Consumption is unified to one mechanism (git submodule) with a documented bootstrap.
**Plans:** TBD
**Review:** Codex round1 (plan) + round2 (diff) per PROC-01
**Notes:** In flight — gated on the upstream PR merge; fallback is pinning to the fork commit. Valuable even if the merge stops here.

### Phase 1: Unified Contracts (KEYSTONE)
**Goal:** Define every contract the engine and shell are built against — as TYPES, a SPEC, and TESTS, with zero runtime behavior change in either app: the superset worker protocol (all IV imaging messages + all Explorer browse/archive/parquet/scan/chrom/study messages, each annotated with clone-vs-transfer, size cap/paging, and cancellation), the unified zustand store shape + view-state model, the capability model (`isImaging` via `probeIsImaging` 3-signal semantics, `numChromatograms`/`hasTicColumn`, `hasOptical`), and the URL grammar as a pure parse/serialize module (conflict matrix, canonicalization, legacy `/IV/` translation).
**Mode:** mvp
**Depends on:** Phase 0
**Requirements:** CTR-01, CTR-02, CTR-03, CTR-04, CTR-05
**Success Criteria:**
  1. A `@mzpeak/contracts` package exports: the `WorkerRequest`/`WorkerResponse` superset union with per-message transfer/clone/cancellation annotations; the unified store/view-state types; the capability model types.
  2. A URL module parses and serializes the full §3 grammar, with unit tests covering the conflict matrix, view inference, and the legacy `/IV/` translations (`scan=N→spectrum=N-1`, `&tol=` folding) — all passing.
  3. A written contract spec (protocol + store + capability + URL) exists and is adversarially reviewed; NO engine or UI code is migrated in this phase.
**Plans:** TBD
**Review:** Codex round1 + round2 per PROC-01
**UI hint:** no (types/spec/tests only)

### Phase 2: Shared ui-kit
**Goal:** Stand up the monorepo workspace and extract the low-risk, purely presentational surface into `@mzpeak/ui-kit`: design tokens + components with no reader/store/imaging assumptions (uPlot spectrum plot, metadata JSON tree, structure/parquet inspector view, cv/format utils). Both existing shells consume them with behavior unchanged.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** KIT-01, KIT-02, KIT-03
**Success Criteria:**
  1. The repo is an npm workspace with `@mzpeak/ui-kit` (tokens + presentational components) building independently.
  2. The new app's tokens + at least the spectrum plot, metadata tree, and structure inspector view come from `@mzpeak/ui-kit` and render identically to fixtures **captured from the old apps** (snapshot parity). The old apps are external read-only sources — not built here (see research/HARMONIZATION-PLAN.md).
  3. No data-bound widget (file loader, anything touching the reader/store) is in ui-kit — those stay in the app shell.
**Plans:** TBD
**Review:** Codex round1 + round2 per PROC-01
**UI hint:** yes

### Phase 3: Engine Migration (`@mzpeak/core`)
**Goal:** Implement the Phase-1 protocol as ONE Web Worker engine that owns the `mzpeakts` Reader, hosts the scheduler + LRU cache storage in-worker, and exposes all reads/compute as messages — including a full rewrite of Explorer's main-thread data access (archiveList, parquetFooter, deepColumn, sampleColumn, scanBreakdown, XIC/stored chrom, studyMeta) into cancellable, transfer-aware messages, merged with IV's imaging handlers. The new app calls the engine via thin adapters (Explorer's data access is harvested from its read-only source, not run in-repo).
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** ENG-01, ENG-02, ENG-03, ENG-04, ENG-05
**Success Criteria:**
  1. One worker engine backs the new app's data path; Arrow/WASM handles never cross the boundary; large member reads use transfer/streaming (no 256 MB structured clone).
  2. Golden-output parity tests compare the new engine's results to **golden fixtures captured from the old apps** (and their live deploys) for an imaging fixture AND an LC fixture; imaging + LC e2e green on the new app.
  3. Lazy remote row-group reads, the priority/background scheduler, cancellation, and the spectrum cache all function through the worker; the file→ion-image→spectrum invariant holds under e2e.
**Plans:** TBD
**Review:** Codex round1 + round2 per PROC-01
**Notes:** HIGH risk — the long pole. Migrate behind unchanged UX; parity is the gate.

### Phase 4: Unified Shell + Capability Sidebar
**Goal:** Build the single app shell (Explorer base) with the capability-adaptive sidebar: always-on Summary + Spectra; an **Advanced** accordion (Metadata + Structure); a **Chromatograms** entry gated on actual chromatogram capability (independent of imaging); an **Imaging (MSI)** accordion (Ion image / Optical / Overlay / Grid) gated on `isImaging` and lazy-loaded. Merge the two zustand stores into the Phase-1 shape; wire pixel→spectrum and ROI→spectrum routing; implement the a11y acceptance criteria and the imaging-detection override.
**Mode:** mvp
**Depends on:** Phases 2, 3
**Requirements:** NAV-01, NAV-02, NAV-03, NAV-04, NAV-05, NAV-06, NAV-07, NAV-08
**Success Criteria:**
  1. Opening an imaging file shows the MSI accordion (lazy chunk loaded); opening a non-imaging LC file shows Chromatograms and does NOT download imaging code; both demo files are fully navigable.
  2. Nav is gated on real capabilities (`isImaging`, `numChromatograms>0`/`hasTicColumn`, `hasOptical`); an imaging file with stored chromatograms shows BOTH; a mis-detected file can be overridden from MSI ▸ Grid / Summary.
  3. The rail is a proper `tablist`/accordion with keyboard + ARIA support; pixel-click and ROI both route to the Spectra view.
**Plans:** TBD
**Review:** Codex round1 + round2 per PROC-01
**UI hint:** yes

### Phase 5: Unified URL Resolver + Link Stability
**Goal:** Wire the Phase-1 URL module into the shell (parse→replay on load; serialize←Share-view), implement the conflict resolution + canonicalization, the cross-mode "ignored + info notice" UX, and the legacy link stability: per-target redirect shims for `/IV/*`→`/view/*` (committed client-side `index.html` shim for GitHub Pages; server/redirect for mzpeak.org) carrying the query string and applying `scan=N→spectrum=N-1` + `&tol=` folding.
**Mode:** mvp
**Depends on:** Phase 4
**Requirements:** URL-01, URL-02, URL-03, URL-04, URL-05, URL-06, URL-07
**Success Criteria:**
  1. A single resolver applies the §3 grammar; the Share-view button emits the shortest canonical link and it round-trips.
  2. An old-link regression corpus (real `/IV/?ion=…&scan=…`, `/IV/?optical=…`, `/view/?xic=…&tab=…`, `/view/?chrom=tic&rt=…`) all resolve to the correct view, with query-preservation tests for the redirect shims.
  3. Cross-mode params on the wrong file type are ignored with a non-blocking info notice, never an error/blank.
**Plans:** TBD
**Review:** Codex round1 + round2 per PROC-01
**UI hint:** yes

### Phase 6: Safety Harness + Single Deploy + Decommission
**Goal:** Before flipping deploys, stand up the safety harness (golden engine outputs, imaging + LC e2e, redirect/query-preservation tests, worker-cancellation tests, performance + memory budgets for worker round-trip vs old main-thread reads) and a rollback path that keeps the old `/IV/` and `/view/` artifacts deployable during a canary window. Then collapse the combined-site build to one section (unified app at `/view/`, `/IV/` shim), consolidate fixtures, update docs, and decommission the retired apps.
**Mode:** mvp
**Depends on:** Phase 5
**Requirements:** DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06
**Success Criteria:**
  1. The unified app is live on mzpeak.org `/view/` and GitHub Pages; old `/IV/` and `/view/` deep links resolve via the shims.
  2. CI is one pipeline; the combined-site build publishes one app section; fixtures (imaging + LC) are consolidated into one test matrix.
  3. A documented rollback restores the prior `/IV/` + `/view/` artifacts within the canary window; performance/memory budgets are met (no regression vs the old main-thread reads for small files).
**Plans:** TBD
**Review:** Codex round1 + round2 per PROC-01
**Notes:** Deploy blast radius must be surfaced before running (existing operator policy).
