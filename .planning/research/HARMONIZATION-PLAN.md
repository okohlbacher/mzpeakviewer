# Harmonization & ingestion plan — pulling the two apps into one coherent codebase

**Date:** 2026-06-12 · **Status:** proposed (pre-execution) · **Author:** build session
**Sources:** `~/Claude/mzPeakIV` (imaging, ~14.4k LOC) + `~/Claude/mzPeakExplorer`
(general explorer, ~9.1k LOC). **Target:** this repo (`okohlbacher/mzpeakviewer`).
**Reads against:** `MERGE-ROADMAP.md` (the v2 phase design), `SOURCE-ARCHITECTURE.md`
(the deep tree maps), `ADVERSARIAL-REVIEW-v2-SYNTHESIS.md` (review deltas).

> Naming note: the operator wrote "mzPeakIV and mzPeakViewer". The two *source* apps
> are **mzPeakIV** and **mzPeakExplorer**; **mzpeakviewer** is the *target* merge repo
> (where `@mzpeak/contracts` already lives). This plan reads it that way.

The roadmap refactors **along** phases. This document is the step **before** that: how
the two existing codebases physically arrive in one repo and reach a *coherent,
green, behavior-unchanged baseline* — so every later refactor has a parity oracle to
measure against. The principle the adversarial reviews enforced: **never refactor
without a same-repo parity gate.** That gate only exists once both apps build and run
here.

---

## 0. The decomposition (what "shared core" actually is — grounded, not assumed)

Verified against the live trees this session:

| Layer | Genuinely shared? | Evidence | Lands in |
|---|---|---|---|
| **`mzpeakts` reader** (Parquet+Arrow+ZIP) | **Yes — THE core.** Both vendor it; only the commit/consumption differs. | IV = submodule `b826397`; Explorer = in-tree `a87abe3` + numpress patch | `vendor/mzpeakts` (one submodule) — **Phase 0** |
| **`@mzpeak/contracts`** | **Yes (already built).** | shipped commit `d63ccd0` | `packages/contracts` ✅ |
| **Design tokens** | **Yes — value-equal.** grays, `--blue-600 #3b54da`, reds byte-identical; IV only *adds* `--ink`/`--sentinel`/colormaps | diff of `colors.css` (this session) | `packages/ui-kit` tokens — **Phase 2** |
| **Pure presentational components** | **Yes — zero store coupling.** | IV `src/ui/ds/*` (Button/Select/Panel/Badge/…) import no store; Explorer `SpectrumPlot`, `TreeView`, `components.tsx`, `useUplot`, `chartTheme`, `cvTerms`, `format` → **0 store refs** | `packages/ui-kit` components — **Phase 2** |
| **`src/reader/*` adapter layer** | **No — app-specific.** IV: `stats`/`probeIsImaging`/`imaging`/`arrays`; Explorer: `browse`/`archive`/`parquetDeep`/`summary`/`sampleMeta`. Different surfaces over the same `mzpeakts`. | tree maps | merged **inside** `packages/core` — **Phase 3** |
| **Data engine** | **No — divergent (the long pole).** IV = Web Worker; Explorer = main-thread reader + scheduler + LRU cache | SOURCE-ARCHITECTURE §C | `packages/core` (one worker) — **Phase 3** |
| **Tab containers** (`SpectraTab`, `StructureTab`, `MetadataTab`, imaging panels) | **No — store-bound.** | SpectraTab=19 store refs, MetadataTab=3, StructureTab=1 | the unified shell `apps/viewer` — **Phase 4** |

**Consequence:** the genuinely shared core is small and low-risk (one reader + tokens +
pure components + contracts). The hard parts (reader adapters, engine, containers) are
*not* shared — they get **merged**, behind parity gates, in their roadmap phases. This
is why the reviewers' "presentational-only is optimistic" worry is real *for Tabs* but
not for the files we actually lift: we lift the pure layer and leave the Tabs as shell
containers.

---

## 1. Target monorepo layout

```
mzpeakviewer/
  packages/
    contracts/   ✅ Phase 1 — wire protocol, store/view, capability, URL grammar
    ui-kit/      Phase 2 — unified tokens + pure presentational components
    core/        Phase 3 — ONE Web Worker engine (owns mzpeakts + scheduler + cache)
  apps/
    iv/          transitional — mzPeakIV verbatim, rewired to packages; DELETED Phase 6
    explorer/    transitional — mzPeakExplorer verbatim, rewired to packages; DELETED Phase 6
    viewer/      Phase 4 — the unified shell (Explorer base + lazy MSI chunk)
  vendor/
    mzpeakts/    git submodule, ONE converged commit (Phase 0)
  .planning/ …   (unchanged)
```

`apps/iv` and `apps/explorer` are **scaffolding with a demolition date** (Phase 6).
They exist only so each refactor step has a living, runnable parity oracle. `apps/viewer`
is the product.

---

## 2. Ingestion mechanics — how the code physically arrives

**Recommendation: copy-snapshot at a recorded SHA, not `git subtree`.**

- The source repos **remain authoritative until Phase 6** (roadmap), so full git history
  is preserved *there* — the monorepo doesn't need it.
- Every ingested file will be **moved/renamed/refactored** within a few phases (into
  `packages/*`, then deleted). Subtree history would attach blame to soon-dead paths and
  bloat the monorepo's first commit with two unrelated histories.
- A `SOURCES.md` records the exact source SHA each app was copied from, so provenance is
  exact and re-syncable by diff if a source app changes before decommission.

*Alternative (if the operator wants blame continuity):* `git subtree add --prefix=apps/iv
<local-iv> main` (and `apps/explorer`). Reversible, but heavier. Decide once, in §6.

**Push/policy:** copying source code into this public repo pushes only to
`okohlbacher/mzpeakviewer` (authorized). It does **not** touch the source remotes — their
single-remote policies are untouched. (The source apps are already public deploys.)

---

## 3. The harmonization milestone (the pre-refactor baseline) — "Step H"

This is the gate between "two repos" and "refactor along the roadmap". It is essentially
**Phase 0 + ingestion**, and it is the first thing that makes the codebase *coherent*.

**H1. One reader (Phase 0).** Add `vendor/mzpeakts` as a single submodule pinned to the
converged commit (aux-arrays **and** Numpress Linear). Until `HUPO-PSI/mzpeakts#1` merges,
pin the **fork commit** carrying both (documented fallback; named SHA + owner in
`SOURCES.md`). Reconcile the `DataArrays`/`Reader` type delta into one surface.

**H2. Apps in, rewired to the one reader.** Copy `mzPeakIV → apps/iv`,
`mzPeakExplorer → apps/explorer` at recorded SHAs. Delete each app's private mzpeakts
copy; repoint both vite aliases + `file:` installs at `../../vendor/mzpeakts/lib`. Make
the repo an npm workspace member set (`apps/*` + `packages/*`).

**H3. Both green, behavior unchanged.** Each app builds, typechecks, unit-tests, and
e2e-passes from the monorepo against the one reader. **Add Explorer e2e** (it has none
today — review codex #12): port IV's Playwright harness to `apps/explorer` so "both apps
e2e green" is an actionable gate from here on.

**Definition of done for Step H:** `npm install && npm run -ws build && npm test` green;
both apps run via `npm run dev -w apps/iv` / `-w apps/explorer`; one `vendor/mzpeakts`;
no local reader patches; `SOURCES.md` records both SHAs + the reader SHA. **No feature
work, no extraction yet** — this is the coherent baseline the roadmap refactors from.

> Why this ordering: the roadmap's Phase-2 and Phase-3 acceptance criteria literally say
> "both source apps … remain visually/behaviorally identical (snapshot/e2e green)" and
> "golden-output parity vs the OLD outputs." Those gates are **impossible to run** until
> both apps live and build in this repo against one reader. Step H makes the gates exist.

---

## 4. Then refactor along the roadmap (each step keeps both apps green)

### Phase 2 — extract the shared UI core → `packages/ui-kit`
- **Tokens:** create the unified set = Explorer's base tokens **+** IV's imaging-only
  additions (`--ink`, `--ink-raised`, `--sentinel`, `colormaps.css`). They're value-equal,
  so this is a superset merge, not a reconciliation. Both apps import tokens from ui-kit;
  delete the two local token copies.
- **Components (pure, verified 0 store refs):** `SpectrumPlot` + `useUplot` + `chartTheme`
  + `uplotZoom` (spectrum plot), `TreeView` (metadata JSON tree), the `components.tsx`
  primitives + IV `ds/*` (Button/Select/Panel/Badge/SegmentedControl/NumberField/Checkbox/
  StatRow/ColormapScale), `cvTerms`/`curie`/`format` (cv/format utils). Move to ui-kit;
  both apps import from `@mzpeak/ui-kit`; delete local copies.
- **Explicitly NOT moved:** `SpectraTab`/`MetadataTab`/`StructureTab`/`ChromatogramsTab`/
  `SummaryTab`/imaging panels (store-bound containers) and `FileLoader` (data-bound) — they
  stay in the apps, now consuming ui-kit. This is the container/presenter line the
  reviewers flagged; we hold it.
- **Gate:** ui-kit builds standalone; both apps snapshot/e2e identical. **Risk: low**
  (only the already-pure files move).

### Phase 3 — merge the engine → `packages/core` (the long pole, HIGH risk)
- **Base:** IV's worker (`src/worker/mzPeakWorker.ts` + protocol) — it already owns the
  reader off-main-thread; the imaging compute needs it.
- **Port IN Explorer's data access** as worker handlers implementing `@mzpeak/contracts`
  `MESSAGE_POLICY`: `archiveList`/`parquetFooter`/`deepColumn`/`sampleColumn` (the
  Structure path — note review CRITICAL: it uses `reader.store`, a `WeakMap` keyed by the
  reader, and dynamic `hyparquet`; reconstruct cache identity **inside** the worker),
  `scanBreakdown`, `extractChrom` (TIC/XIC/stored), `studyMeta`. Port Explorer's
  `readScheduler` (priority/background lanes) + LRU spectrum cache **into** the worker.
- **Merge IN** IV's imaging handlers (`renderIonImage`/`renderMultiChannel`/`meanSpectrum`/
  `roiSpectrum`/`getOpticalImage`/grid) — they're already worker handlers.
- **Both apps call `core` via thin adapters** (a `postMessage` client matching the
  contracts union). Explorer's main-thread reader calls become async adapter calls.
- **Pre-req spike (review delta E):** before the general migration, a *Structure/Parquet
  workerization spike* with a concrete protocol slice + parity fixtures — it's a redesign
  of cache identity, not a thin call surface.
- **Gate:** golden-output parity (new engine vs OLD main-thread/worker outputs) for an
  imaging fixture AND an LC fixture; imaging+LC e2e green; the file→ion-image→spectrum
  invariant under e2e. Move minimal cancellation/perf smoke tests here (review delta).
  **Risk: HIGH.**

### Phase 4 — unified shell → `apps/viewer`
- Explorer's `App.tsx` shell as the base; build the capability-adaptive sidebar off the
  `CapabilityModel` (Summary/Spectra always; Chromatograms on
  `numChromatograms>0 || ticColumn==="present"`; Advanced accordion = Metadata+Structure;
  MSI accordion `isImaging`-gated, **lazy `import()` chunk** = IV's `ImagingPanel`/
  `OpticalPanel`/`GridDiagnosticsPanel`/`tiff` export).
- Merge the two zustand stores into the contracts' `UnifiedState`; wire pixel→spectrum and
  ROI→spectrum to the `spectra` view (provenance-tagged `SpectrumSelector`).
- a11y (`tablist`/accordion/roving focus) + detection-override UI from the contracts'
  `ImagingDetection`. **Risk: medium.**

### Phase 5 — URL resolver wired
- Wire `packages/contracts/url` into `apps/viewer` (parse→replay on load; serialize←Share).
- Publish the legacy redirect shims using `LEGACY_PATH_MAP`: `/IV/`→`/view/` (mzpeak.org)
  and `/mzPeakIV/`→`/mzpeakviewer/` (GitHub Pages, committed `index.html` client shim).
  Old-link regression corpus + query-preservation tests. **Risk: medium.**

### Phase 6 — collapse & decommission
- Safety harness + rollback canary; one CI pipeline; one deploy (`apps/viewer` at `/view/`,
  `/IV/` shim). **Delete `apps/iv` and `apps/explorer`** and their fixtures (consolidated).
  The transitional scaffolding is demolished here. **Risk: low–medium.**

---

## 5. The reconciliation list (the specific things that must be *harmonized*, not just copied)

1. **Reader vendoring** — submodule vs in-tree → ONE submodule; both vite aliases repointed
   (H1/H2).
2. **Reader type delta** — IV's `DataArrays` (incl. `BigInt64Array`) vs Explorer's older
   shape → one surface (H1).
3. **Tokens** — alias-name differences only; values equal → superset, single set (Phase 2).
4. **Imaging detection** — IV 3-signal `probeIsImaging` vs Explorer 1-signal `readImaging`
   → standardize on the contracts' phased `ImagingDetection` (hint→probed), replace
   `readImaging` (Phase 3/4).
5. **`scan` semantics** — IV 1-based index vs Explorer native number → contracts'
   provenance-tagged selector; legacy `/IV/ scan=N → spectrum=N-1` (Phase 5; already in
   `url/legacy.ts`).
6. **e2e infra** — Explorer has none → port IV's Playwright in Step H so both apps gate.
7. **Deploy base** — IV Pages base `/mzPeakIV/`, Explorer derives from repo name → unified
   `VITE_BASE` per target; both redirect roots covered (Phase 5/6).
8. **`hasTicColumn`** — only known after the scan pass → contracts' tri-state `ticColumn`;
   nav shows optimistically (Phase 4).

---

## 6. Open decisions (operator)

1. **Ingestion mechanics:** copy-snapshot at recorded SHA *(recommended)* vs `git subtree`
   (blame continuity) vs reference-in-place (apps stay external, only modules cherry-picked).
2. **Execute Step H now, or wait for the reader PR?** `HUPO-PSI/mzpeakts#1` is still OPEN.
   Option A: execute Step H now on the **fork-pin fallback** (named SHA with both fixes) and
   re-point to the upstream commit on merge. Option B: hold Step H until the PR merges.
   *Recommend A* — it unblocks the whole harmonization and the re-point is a one-line
   submodule bump.
3. **Source-app move timing** (the HANDOFF "still open" item): this plan resolves it →
   **move both in at Step H** (the parity gates require it).

---

## 7. Why this satisfies the adversarial review

- **codex #1** (Phase 1 needs the workspace): workspace exists; `apps/*` slot into it.
- **codex #3 / vibe CRITICAL-1** (Structure/Parquet understated): Phase 3 gets an explicit
  workerization spike + parity fixtures before the general migration (§4 Phase 3).
- **codex #6 / vibe MAJOR-2** (ui-kit not purely presentational): §0 + §4 move only the
  *verified* zero-store-ref files; Tabs stay containers — the line is grounded in a real
  grep, not optimism.
- **codex #5 / vibe MAJOR-1** (Phase 0 schedule-critical): Step H names the fork-pin
  fallback SHA + owner and treats the reader as the critical path.
- **codex #12** (no Explorer e2e): Step H ports Playwright to Explorer so the parity gates
  are real.
- **review delta** (harness too late): cancellation/perf/redirect smoke tests move into the
  phases that introduce those behaviors (§4).
