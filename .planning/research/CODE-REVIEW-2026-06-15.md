# Adversarial code review + remediation roadmap — 2026-06-15

HEAD `39a81b2`. Four parallel adversarial reviewers (core/reader, app, contracts/URL, tests/docs);
all HIGH/MED findings spot-verified by direct `grep`/read. Meta-theme: **drift** — duplicated
code paths that diverged, a URL grammar that over-promises vs. the app, docs lagging 31 commits,
and several "planned-but-disconnected" paths. The single missing safety net (no app-store /
integration tests) is what let the share-link bug ship.

## Findings by category (✓ = verified)

### A. Correctness (user-visible / latent bugs)
- **A1 ✓ HIGH** `grammar.ts:63` `VALID_VIEWS` is missing `overview` and `multi` (both are in
  `IMAGING_VIEWS`). So `?view=overview` / `?view=multi` don't deep-link (fall back to summary +
  spurious notice), and `serialize({view:"multi"})` emits `view=multi` that `resolve` can't read
  back → **broken round-trip** (the corpus omits these two, so tests stay green).
- **A2 ✓ HIGH** `Imaging.tsx:187` the optical-image `gen` guard (`opticalGen.current`) is **never
  incremented**, and `decoded`/`opticalErr`/`selectedOpticalPath` are component-local and not reset
  on file change → a stale/mis-keyed optical image can leak across an imaging→imaging file switch.
- **A3 ✓ MED** `reader/errors.ts:47` `CorruptFileError` is **never constructed** → the
  `classifyError` "parse" branch (`dispatch.ts`) is unreachable; a genuinely corrupt/non-ZIP file is
  classified `internal`, defeating the "fail loud, class-specific" design.
- **A4 ✓ MED** `grammar.ts:144` `ion=mz,` (empty tol) → `Number("")===0` passes the finite guard →
  `tolDa:0` (zero-width window, blank ion image) instead of `DEFAULT_TOL_DA`. Same class in
  `channelOf`/`xicOf`. `ch=100,0.1,rgb(1,2,3)` truncates color to `rgb(1` (splits on `,`).
- **A5 MED** `imaging.ts` warm-cache mean/ROI uses the **f32** cache m/z as the reference axis;
  the cold path uses f64 → the returned mean spectrum's axis differs by cache state (intensities
  match within ±0.5 Da binning; the axis dtype/values don't). No test catches the warm divergence.
  **DECISION (2026-06-15): use f32 axis CONSISTENTLY** — build the mean/ROI reference axis as
  `Float32Array` in BOTH paths (downcast the cold f64 source), matching the f32 ion pipeline, and
  assert warm==cold. (Not "upcast to f64".)
- **A6 MED** `App.tsx:113` auto-expand-accordion does `Promise.resolve().then(set…)` from render —
  a setState-during-render in disguise; belongs in a `useEffect`.
- **A7 LOW** `store.ts` `openFile`/`openUrl` initial `set()` omit `spectrumLoading`/`chromLoading`
  (which `reset()` clears) — narrow, self-healing "stuck loading" risk.

### B. Dead code / disconnected paths
- **B1 ✓ HIGH** `worker/state.ts` — entire module dead (no importers); a stale parallel copy of the
  `EngineContext` gen/cancel model. Trap for a future maintainer.
- **B2 ✓ HIGH** `reader/errors.ts:15` reader-side `ReaderErrorClass` is dead **and conflicts** with
  the live contracts `ReaderErrorClass` (different string values).
- **B3 ✓ MED** `reader/arrays.ts:86` `getSpectrumArrays`/`getSpectrumArraysFor` dead (only
  `harvestDataArraysOrNull` is used; a *different* `getSpectrumArrays` in `explorer/browse.ts` is the
  live one — name collision).
- **B4 ✓ MED** Four wire events declared + handled in `EngineClient` but **never emitted**:
  `progress` (+`LoadStage`), `ionIndexPreloading`, `ionIndexPreloadAborted`, `opticalImageSkipped`.
- **B5 ✓ MED** `grammar.ts` `preload`/`cache` URL params are parsed (and `legacy.ts` preserves them)
  but **no consumer** reads them — old `/IV/?…&cache=64&preload=1` links carry dead settings.
- **B6 MED** `imaging.ts` `prefetchIonCache` computes `total` + calls `control.onProgress`, but
  `startIonPrefetch` never wires `onProgress` → dead plumbing (and forces an early coord-map build).
- **B7 LOW** `render.ts` TIC-normalization (`tic`/`ticNorm`) params plumbed, every caller passes
  `null,false`. `Summary.tsx` `phase==="idle"` branch is dead UI (`Idle` renders instead).
  `fileMeta.ts:111 fileStats` dead in prod (test-only).

### C. Duplication
- **C1 ✓ HIGH** `store.ts` `openFile` and `openUrl` are ~95% identical (~110 lines), incl. a verbatim
  ~28-field reset `set` and the post-open/scanBreakdown/studyMeta/pre-select blocks. They've already
  **diverged**: `openFile` surfaces a "stats couldn't be computed" notice on scanBreakdown failure,
  `openUrl` swallows it silently. → extract `_openCommon` + `INITIAL_OPEN_STATE`.
- **C2 MED** Promoted MS-level column reader (`"MS_1000511_ms_level"`) reimplemented 3× (`open.ts`
  `readAllMsLevels`, `imaging.ts` `readMsLevels` — byte-identical, `spectrum.ts` `readCols`) + the
  literal in `cv.ts`/`fileMeta.ts`. The MS1-only "is any MS1?" gate is also hand-rolled 3× (`imaging
  makeMs1Only`, `open buildTic`, `chrom ticRows`).
- **C3 LOW-MED** The streamed-build + centroid-fallback loop is near-duplicated across
  `engineRenderIonImage` / `engineRenderMultiChannel` / `prefetchIonCache` (only the per-spectrum
  write differs). `saveBlob` boilerplate ×2; `fmtBytes` ×2 (divergent unit ladders); canvas blit ×3.

### D. Bloat
- **D1 MED** `Imaging.tsx` (~1024 lines) is a god-component (5 modes + canvas paint + zoom/pan +
  optical decode + overlay compositing + keyboard picking + spectrum dock; ~20 hooks; a 60-line
  hand-maintained paint-effect dep array). Highest future-regression risk by size.
- **D2 LOW** `readSpectrumArrays` is a pointless passthrough to `harvestDataArraysOrNull`. View
  registry spread across 3–4 parallel structures (`NAV_ICON_PATHS`/`VIEW_META`/`allTabs`/router).

### E. Consistency (code + a11y)
- **E1 ✓ MED** Two `Reader` type aliases (`reader/openUrl` vs `reader/explorer/open`) — structurally
  compatible today, latent drift.
- **E2 MED** `ViewState` contract over-promises: `urlSync.applyViewState` only applies
  `view`/`selector`/`chromMode==="tic"`; `xic`/`stored`/`ion`/`channels`/`roi`/`optical`/`msLevel`/
  `zoom` are resolved by the grammar then **dropped** by the app. Most of the deep-link surface the
  grammar tests validate isn't actually applied.
- **E3 MED** `Structure.tsx` parquet column rows are clickable `<tr onClick>` with no
  keyboard/role/`aria-expanded` — a11y gap vs the otherwise-careful app.
- **E4 LOW** `meanSpectrum`/`roiSpectrum` share one `meanSpectrumResult` wire type (no origin
  discriminator) — correlates by id today, latent.

### F. Test coverage gaps
- **F1 HIGH** The **app store is entirely untested** (no `app/src/*.test.ts`): `openFile`/`openUrl`,
  the `currentOpenSeq` stale-async guard, `sourceUrl` assignment, store→ShareButton wiring. This is
  the exact bug class that shipped (share dropped the dataset URL — pure fn tested, wiring not).
- **F2 HIGH** `IonCacheStore`/`IonCacheBuilder` budget accounting + over-budget no-op + `commit`
  budget-sync are untested (`cache.test.ts` covers only the old budget/LRU).
- **F3 HIGH** No **cold==warm equality** property guard (a cache-off render == cache-on render). The
  property most likely to silently break as the f32 cache evolves.
- **F4 MED** Prefetch lifecycle untested (`REMOTE_PREFETCH_DELAY_MS` gating, cooldown, gen-guard) —
  exactly where the recent Phase-1/3 perf bugs lived.
- **F5 LOW-MED** No "reuses warm ion cache" assertion for multichannel / chrom-XIC (mean/ROI and
  optical are covered).

### G. Docs (stale / missing)
- **G1 ✓ HIGH** `CLAUDE.md`, `.planning/{STATE,PROJECT,STACK,ROADMAP}.md`, `README.md` all cite stale
  facts: HEAD `5175c0c` (actual `39a81b2`), "180 unit / core 112 / 15 e2e" (actual **209** / core
  **141** / **18** e2e), submodule `mzpeakts@4067f84` (actual **`b85c051`**).
- **G2 ✓ HIGH** `dispatch.ts:52` comment says prefetch is **SUPPRESSED for remote** — false since the
  Phase-3 re-enable-with-delay (`if (ctx.remote) setTimeout(launch, …)`). Actively misleading.
- **G3 MED** Stale perf timings (`~35s`, `~700ms/pixel`, `~100s+`) in `imaging.ts`/`dispatch.ts`
  comments. `docs/perf/ion-image-and-prefetch-analysis-2026-06-15.md` still headlines "parallel reads
  = biggest lever (~2-3×)" — contradicts the landed conclusion (parallel reads are a dud; the win was
  `streamPointArrays`; cold read is bandwidth-bound). Reconcile or supersede.
- **G4 LOW** `capability.ts` doc references a non-existent `hasTicColumn` (field is `ticColumn:
  Presence`). `getOpticalImage`'s gen-correlation (not requestId) is undocumented at the type.
- **G5 MED** No architecture/onboarding doc for the `cache.ts` module (Budget/LRU/IonCacheStore/
  Builder) or the dispatch/prefetch state machine; no `@mzpeak/core` public-API reference.

## Roadmap (6 waves, ROI-ordered)

**Wave 1 — Correctness (ship first).** A1 (add `overview`/`multi` to `VALID_VIEWS` + `inferView`; +
round-trip test for both). A2 (bump `opticalGen` + reset optical caches on grid/source change, or
lift optical decode into the store like the ion image). A3 (throw `CorruptFileError` at the
open/parse boundary, or drop the class and map at the boundary). A4 (empty-tol → `DEFAULT_TOL_DA`;
rejoin color on `,`). A6 (auto-expand → `useEffect`). **A5 (make the mean/ROI reference axis f32
CONSISTENTLY — both paths — + assert warm==cold).** A7 (add the two loading flags to both open
paths — folds into C1).

**Wave 2 — Dead-code removal (low-risk clarity).** Delete `worker/state.ts` (B1), reader-side
`ReaderErrorClass` (B2), `getSpectrumArrays`/`For` + `fileStats` (B3/B7). Decide each of: the 4
never-emitted events + `LoadStage` (B4) and `preload`/`cache` (B5) — implement or remove (don't
leave half-wired). Drop the dead TIC-norm params + `Summary` idle branch + prefetch `onProgress`
(B6/B7).

**Wave 3 — De-duplication.** C1: `_openCommon` + `INITIAL_OPEN_STATE` (also fixes the scanBreakdown
silent-failure divergence and A7). C2: one `readPromotedInt16Column(reader, COL.msLevel)` + one
`ms1Predicate` helper. C3: a shared `streamGridSpectra(reader, grid, {onSpectrum, builder})` for the
three render/prefetch builders; `saveBlob`/`formatBytes`/`blit` utils. E1: canonicalize one `Reader`
export.

**Wave 4 — Structure/bloat.** D1: split `Imaging.tsx` (`OverlayCanvas`, `LayersPanel`,
`useOpticalDecode`, `useIonRender`/`useMultiRender` hooks; thin shell). D2: collapse the view
registry into one `Record<View, {...}>`. E2: decide the ViewState scope — either apply the dropped
deep-link fields in the app or mark them Phase-pending in the contract docs (don't keep the grammar
validating unreachable surface).

**Wave 5 — Test nets.** F1: `app/src/store.test.ts` (openFile/openUrl/stale-guard/sourceUrl + a fast
store→`currentShareUrl` wiring test). F2: `IonCacheStore`/`Builder` unit tests. F3: a cold==warm
equality test (fixture or corpus). F4: prefetch-lifecycle test (remote delay, gen-guard bail). F5:
multichannel/XIC cache-reuse assertions.

**Wave 6 — Docs + a11y.** G1: refresh HEAD/counts/submodule/phase across CLAUDE.md + `.planning/*` +
README. G2/G3: fix the "remote suppressed" comment + stale timings; reconcile the perf doc with the
measured conclusion. G4: `hasTicColumn`/`getOpticalImage` doc fixes. G5: an architecture section
(cache module + dispatch state machine) + `@mzpeak/core` API note. E3: keyboard a11y for the
Structure column inspector.

**Sequencing note:** Wave 1 before Wave 3 (fix bugs in the duplicated code before merging it, so the
merge is provably behavior-preserving). Wave 5 can run alongside 1–3 (write the store/cache tests
first so the dedup refactors are gated). Wave 6 is independent.

---

## Status (updated 2026-06-15)

**Waves 1–3 DONE + deployed** (commits c7fb598, b590781, 41435d9; gh-pages 41435d9). A round-2
adversarial re-review (two reviewers over the full diff) found **no regressions and no new bugs** —
every change traced clean (stale-async guards intact, no dropped open-state field, f32 binning
equals f64 within the 0.5-Da bin, the dropped `spectra.length` fallback is provably equal to
`sm.length`, all deletions left zero dangling refs, the wire-union routing stays safe). Also removed
the dead `urlSync.sourceUrl()` export it surfaced.

**Deferred** (judgment calls, not done): C3 `streamGridSpectra` build-helper (re-refactoring the
3 render/prefetch builders just validated for f32/parity — regression risk > value); C3
saveBlob/blit utils + the different-shape MS1 predicate; B5 `preload`/`cache` URL params and the
render.ts TIC-normalization params (both reserved feature-stubs — "wire or remove" later).

**Remaining: Waves 4–6.** Wave 4 (split `Imaging.tsx`; view-registry; ViewState contract-vs-app
scope). Wave 5 (the test nets — app-store tests F1, IonCacheStore tests F2, a real cold==warm
ion-render equality guard F3, prefetch-lifecycle F4 — high value, still open). Wave 6 (docs G1–G5:
refresh the stale HEAD/counts/submodule/phase across CLAUDE.md + .planning/* + README, fix the
"remote suppressed" + stale-timing comments, reconcile the perf doc, add an architecture/onboarding
section; + the Structure column-inspector keyboard a11y E3).
