• I'll review this two-part brief against the repo. First, let me size the scope.

• The scope is ~27k LOC. I'll run four parallel read-only review agents, then synthesize the ranked report.

• All four review passes are complete. Here is the consolidated report.

  # Adversarial Review — mzpeakviewer @ 3f139f7

  ## Part 1 — PONYTAIL AUDIT (ranked, worst-first)

  ### DELETE — dead production chains

  1. **Imaging-override subsystem — UI never existed** — `packages/contracts/src/capability.ts:47-53` (`ImagingDetection.override` + doc claiming a "detection-override UI"), `:153-156` (`hasDetectionDiscrepancy`); `packages/core/src/adapt/capability.ts:75-79` (`applyImagingOverride`). The field is only ever written as literal `null` (`adapt/capability.ts:51`). DELETE — ~20 LOC + false docs — risk low — user-notice: no.
  2. **`deepColumn` message chain — no worker case, no caller** — `packages/contracts/src/wire.ts:334`, `protocol.ts:107,159,247`; `packages/core/src/client/EngineClient.ts:183,425-439,749-750`. `dispatch.ts` has no `case "deepColumn"` (falls into "not implemented", enshrined by `dispatch.golden.test.ts:76-77`). DELETE — ~40 LOC — risk low — user-notice: no.
  3. **`cancel`/`CancelledError` chain — app never cancels** — `protocol.ts:79,180,232`; `EngineClient.ts:114-121,537-544,622-624`; `worker/dispatch.ts:315-319`. Zero `.cancel(` calls in `app/src`; the stale-drop model (selectId/requestId) already covers every real case. DELETE — ~45 LOC + test — risk low — user-notice: no.
  4. **`setCacheConfig` + `?preload=`/`?cache=` URL params — silently dropped** — `protocol.ts:77,231`; `EngineClient.ts:322-324`; `dispatch.ts:305-313`; `contracts/src/store.ts:96-100,122`; `url/grammar.ts:38-39,98-101` parses the params then `resolve()` discards them with no notice. DELETE the chain — ~55 LOC — risk low-med — user-notice: no (the params never did anything).
  5. **`probeIsImaging` + reader `Capabilities.isImaging` — computed then discarded** — `reader/stats.ts:182,205-246`, `reader/types.ts:38`; near-verbatim duplicate of `probeImagingSignals` (`stats.ts:257-297`); `open.ts:246-264` never reads `ivCaps.isImaging`. DELETE — ~50 LOC — risk low — user-notice: no.
  6. **`contracts/src/url/legacy.ts` — used only by its own test** — `legacy.ts:30-91`; header claims a "committed index.html shim" calls it; no such caller exists in this repo. DELETE (or move to the deploy repo) — ~90 LOC + 75 LOC test — risk med (out-of-repo consumer unverifiable) — user-notice: no.
  7. **`ImagingGrid.diagnostics` + `CoordResult.strategy` — write-only provenance** — computed in `reader/grid.ts:126-154`, typed in `imagingTypes.ts:55-66`, threaded via `scanCoords.ts:42`; no reader anywhere (`GridView.tsx` recomputes from the wire grid). DELETE — ~45 LOC — risk low — user-notice: no.
  8. **Dead store mirror `chrom` + `chromReq` + `activeMirror`** — `app/src/store.ts:210,544-547`: written at 6 sites, read nowhere (views render `chromList`); `chromReq` is pure derived state (`chromList.find(...)`). DELETE/SIMPLIFY — ~30 LOC + 6 invariant call sites — risk med (share-link round-trip; `e2e/url.spec.ts` covers it) — user-notice: only-if-bug.
  9. **`mixedRepresentationWarning` — hardcoded `null`** at the only producer (`worker/dispatch.ts:281`); field in `protocol.ts:142`, `EngineClient.ts:80`, dead render branch `app/src/store.ts:397-398`. DELETE — ~10 LOC cross-package — risk low — user-notice: no.
  10. **`reset()` is the third copy of the open-state field list** — `app/src/store.ts:687-737` hand-copies ~45 fields already centralized in `INITIAL_OPEN_STATE` (`store.ts:318-363`) — the drift the refactor was meant to kill. SIMPLIFY to `set({ ...INITIAL_OPEN_STATE, phase: "idle", fileName: null, sourceUrl: null })` — ~45 LOC — risk low — user-notice: no.
  11. **~220 of ~660 ui-kit stylesheet LOC provably dead** (grep-verified; the closure test only catches missing, never dead):
      - `packages/ui-kit/src/styles/tokens/colormaps.css:1-46` — entire file unreferenced; its 9-anchor viridis also drifts from the live 11-anchor LUT in `spectrum/colormap.ts:5-10` (46 LOC).
      - `styles/tokens/colors.css` — ~20 dead custom properties: `--gray-600/800`, `--ink-*`, `--sentinel:29`, `--blue-900…200`, `--red-700…50`, `--openms-spectrum`, `--indigo-*`, `--channel-r/g/b`, `--accent-quiet`, `--signal-hover/-subtle`, `--peak-line`, `--bg-canvas`, `--surface-raised`, `--info-bg` (~40 LOC).
      - `styles/tokens/spacing.css` — `--space-0,6…16`, `--radius-lg/xl`, border-width tokens, the whole shadow scale, the whole `--shell-*` block (styles.css:6 says shell layout is *not* here), `--ease-emphasis`, `--dur-base/slow` (~25 LOC).
      - `styles/tokens/typography.css` — `--text-base/xl/2xl/display`, `--weight-regular/bold`, `--leading-snug/relaxed`, `--tracking-*`, `--font-ui`, never-emitted `.mz-numeric`/`.mz-overline` (~26 LOC).
      - `styles/tokens/base.css:54-65` `.mz-scroll` block (~12 LOC); `styles/components.css:219-267` `.format-details`/`.optical-item*`/`.imgframe--native` — app-markup styles for markup no app file emits (~47 LOC); `styles/chart-components.css:104-109` dead `.data-stage` block allowlisted at `styles.closure.test.ts:31,54` (~8 LOC).
      DELETE — ~220 LOC — risk low — user-notice: no.
  12. **Test-only code shipped in prod modules** — `reader/explorer/browse.ts:68-112` `getSpectrumArrays` (only caller: `imaging.golden.test.ts:12`); `engine/spectrum.ts:565-592` `readEngineSpectrum` (only callers: golden tests). Move to test helpers — ~80 LOC — risk low — user-notice: no.
  13. **Dead primitive API locked in by tests** — `Button` props `iconRight`/`block`/`icon`/`variant="danger"` (`primitives/Button.tsx:5,11,13` + CSS), `Badge` tones `accent`/`danger` (`Badge.tsx:5`), `Panel` controlled mode (`Panel.tsx:6,10-11`); none used in `app/src`; `primitives.test.tsx:29-38,86-98` asserts the dead props. DELETE — ~35 LOC incl. CSS/tests — risk low — user-notice: no.
  14. **Speculative decoders for unwritten formats** — `engine/spectrum.ts:156-159` (`tof-grid-global`: "no corpus file uses it yet") and the m/z-chunked "Layout B" path (`:341,406-420,501`: "PROVISIONAL — the writer schema is NOT yet frozen"). Fail-loud paths remain; delete until a real file exists — ~25 LOC — risk med — user-notice: no.
  15. **`computeStats` returns only constants** — `reader/stats.ts:90-104`; `open.ts:282-290` could hold the literal, also killing reader-local `FileStats` (`types.ts:22-29`) and hardcoded-`false` `isImaging` fields (`explorer/summary.ts:57,212`). SIMPLIFY — ~35 LOC — risk low — user-notice: no.
  16. **`parseUsi` — only caller is its own test** — `contracts/src/usi.ts:36-47`; app only *builds* USIs (`urlSync.ts`). DELETE — ~15 LOC + test — risk low — user-notice: no.
  17. **Small dead bits (batch, all risk low, user-notice no)**: `engine/cache.ts:342-346` `pointCount()`; `EngineClient.ts:579-581` `peekNextRequestId()`; `protocol.ts:119` `preloadMaxBytes` (dispatch ignores it); `wire.ts:16` `ManifestEntry.bytes` never populated (`Metadata.tsx:87` renders `formatBytes(undefined)` — only-if-bug); `dispatch.ts:581` redundant `engineClass` annotation; `OpenSource.file.name` crossing the worker boundary to be ignored (`open.ts:215`); `ALL_VIEWS` (`contracts/src/store.ts:37-52`, no importers) duplicating `VALID_VIEWS` (`url/grammar.ts:62-77`, which already carries two drift-bug scars); dead `data-testid` props at `App.tsx:333,339,345,352`; duplicated comment block `App.tsx:120-128` + stale placeholder comment `App.tsx:472-475`; dead `"none"` histogram branch `app/src/compute/histogram.ts:57-60`; dead `mode` API `WavelengthSpectrumPlot.tsx:34,73-74,78,132`; dead fallback `SpectrumPlot.tsx:285` (`?? "#fff"` on `as const`).

  ### SIMPLIFY — duplication / platform APIs / unmeasured perf machinery

  18. **`WavelengthLruCache` is copy-paste of `SpectrumLruCache`** — `engine/cache.ts:169-228` vs `:83-146`; one `LruCache<T>` with a `bytesOf` fn covers both — ~60 LOC — risk low-med — user-notice: no.
  19. **ui-kit heatmap/chart duplication (~135 LOC)**: `yRange`/`drawZeroBaseline`/`drawNoSignal` copied between `WavelengthSpectrumPlot.tsx:116-124,213-228,274-283` and `WavelengthChromatogramPlot.tsx:142-150,153-168,171-180`; `token()`/`plotRect()`/colorbar block copied between `WavelengthHeatmap.tsx:103-120,249-273` and `MobilityFrameHeatmap.tsx:106-114,187-211`; `finite2` (`WavelengthHeatmap.tsx:298-309`) duplicates `finiteExtent` (`chartTheme.ts:40-54`); click-vs-drag disambiguation duplicated `SpectrumPlot.tsx:145-161` ↔ `ChromPlot.tsx:88-105`. — risk low — user-notice: no.
  20. **`sanitizePairs` ×2** — `engine/spectrum.ts:353-390` vs `reader/explorer/browse.ts:22-50`: same algorithm, one optional mobility param apart — ~35 LOC — risk low — no.
  21. **`toRepresentation` ×3 + REPR constants ×4** — `explorer/cv.ts:46-50`, `reader/fileMeta.ts:78-82`, `adapt/spectrum.ts:45-49`; accession literals at 4 sites. One home — ~20 LOC — risk low — no.
  22. **Two contradictory chart-palette sources + false comment** — `styles/tokens/colors.css:120-126` claims `--spectrum-line/fill/axis/grid` "are read via getComputedStyle and passed to canvas"; nothing reads them, and `chartTheme.ts:8-17` `STAGE` hardcodes *different* hexes. DELETE the dead tokens + comment (~9 LOC) or make STAGE resolve like `MobilityFrameHeatmap.tsx:112-114` — risk low — no.
  23. **"Contract-free ui-kit" invariant already broken** — three Wavelength components import `@mzpeak/contracts` (declared dep, `ui-kit/package.json:21`) while `peaks.ts:13-16`/`reporters.ts:9-14` mirror those types with a name-clash workaround. Pick one side — ~40 LOC — risk low-med — no.
  24. **Barrel `export *` over-exports internals** — `ui-kit/src/index.ts:7,17,21`: ~14 exported names used nowhere in `app/src` (grep-verified). Explicit exports of the 12 used names — risk trivial — no.
  25. **Adaptive prefetch cooldown — unmeasured perf machinery** — `worker/dispatch.ts:102-146` (50-sample ring, p75 sort, clamp ladder) + double `lastUserActivity` stamping in `engine.worker.ts:36-58`; no measurement cited; the floor clamp means it can only ever *lengthen* the old 350 ms constant. Fixed cooldown suffices — ~45 LOC — risk med — user-notice: only-if-bug.
  26. **`reader/capability.ts` Numpress gate is an empty Map** — `:30`, so `checkArrayIndex` (`:54-75`) can never fire; vestigial `_manifest` params (`:48`, `stats.ts:122`). Keep the two live checks — ~30 LOC — risk low — no.
  27. **App-side dupes**: popover-dismiss machinery copied `AboutButton.tsx:45-62` ↔ `SettingsButton.tsx:31-45` (one `usePopoverDismiss` hook, ~20 LOC); `seriesToPoints` (`store.ts:304-310`) zips arrays that `ChromPlot.tsx:24-32` immediately unzips — pass the series arrays through (~12 LOC + an allocation per plot); `reselectWithSource` (`store.ts:1035-1055`) near-copies `selectSpectrum` with an if/else whose branches are identical (~15 LOC); SDRF TSV split duplicated `core/engine/studyMeta.ts:155-158` ↔ `app/src/sdrf.ts:7-19` — move `parseSdrf` to `adapt/sdrf.ts` (~8 LOC); `showStat` vs `stringifyCell` (`adapt/footer.ts:74-87` ↔ `engine/structure.ts:510-520`) + stale "hand-rolled Thrift decoder" comment at `footer.ts:5-21` (~15 LOC). All risk low, user-notice no.
  28. **`rankOf` hand-rolled binary search** — `app/src/levelIndex.ts:59-70`: `indexOf` over ≤100k elements is sub-ms; unmeasured perf machinery — ~12 LOC — risk low — no. (The `buildLevelIndex` precompute itself is justified.)
  29. **`loadWavelengthMatrix` double bookkeeping** — `app/src/store.ts:976-1007`: module-closure `inFlight` promise AND `wavelengthMatrixLoading` flag with an awkward re-entrant fall-through; the promise alone expresses it — ~8 LOC — risk low — no.

  **Total estimated deletable: ~700–800 LOC of production code + ~130 LOC of tests.**

  ## Part 2 — UI QUALITY

  **Inline-style count (as briefed): 384 `style={{…}}` objects across the 12 views** — Structure 54, Imaging 54, Chromatograms 56, StudyDesign 46, Spectra 43, Idle 40, Summary 29, Metadata 22, Wavelength 20, Ims 11, GridView 7, AdvancedTabs 2. Verdict per the ladder: a `TextInput` primitive is **warranted** (5 byte-similar copies: `Chromatograms.tsx:15`, `Spectra.tsx:304`, `Wavelength.tsx:194`, `StudyDesign.tsx:380`, `Imaging.tsx:1409`), as is switching the ~10 hand-rolled buttons to ui-kit `Button` (`Idle.tsx:330,335`, `Imaging.tsx:883,896,1068,1146,1421,1433`, `Chromatograms.tsx:301`, `AdvancedTabs.tsx:41` — Imaging's have already drifted from the kit's focus/hover styling). The 115 inline `color: var(--text-muted…)` and the 5 bare-table scaffolds are one property each — inline is fine.

  ### Real usability defects (would-a-user-notice: yes)

  1. **Every chart/heatmap surface is a bare div/canvas** — `SpectrumPlot.tsx:203`, `ChromPlot.tsx:117`, `WavelengthSpectrumPlot.tsx:209`, `WavelengthChromatogramPlot.tsx:232`, `MobilityFrameHeatmap.tsx:50-53`, `WavelengthHeatmap.tsx:68-77`: no `role="img"`/`aria-label`/text fallback; zoom, middle-drag pan (undiscoverable even for mouse users), peak-pick, and hover tooltips are all mouse-only. The product's core views give keyboard/SR users nothing. **high**
  2. **Silent reselect failure** — `app/src/store.ts:1047-1054`: `reselectWithSource` catch swallows everything; toggling the Signal select (`Spectra.tsx:263`) can show the new source with the old spectrum, zero feedback. **high/med**
  3. **Sticky global error banner** — `store.ts:818-822` + `App.tsx:836`: one transient spectrum-read failure leaves a permanent red banner across all views; nothing clears it while `phase === "ready"`. **med**
  4. **Wrong-statement empty state** — `store.ts:475-477` empty catch + `Wavelength.tsx:41-47,83-84`: a failed browse load renders "This file has no UV/VIS spectra" for a file that has them, and `triedLoad` blocks retry. **med**
  5. **Silent feature disappearance** — `store.ts:433`: `engine.studyMeta().catch(() => {})` makes the Study-design tab vanish without a trace; the analogous scanBreakdown failure uses the notices mechanism (`store.ts:415-428`). **med**
  6. **Keyboard-unreachable row interactions**: PeakTable clickable `<tr>` (`Spectra.tsx:622-627`), Structure column rows (`Structure.tsx:494-498`), Chromatograms drag handle (`Chromatograms.tsx:293-300` — bare `draggable` span, no role/tabIndex; `Imaging.tsx:1330-1354` does the same widget correctly, so it's self-inflicted inconsistency). **med**
  7. **Imaging keyboard cursor never rendered** — `Imaging.tsx:676-696`: arrows move `kbCell` but no crosshair/outline is drawn; readout `<p>` at `:1029` has no `aria-live`. The a11y feature exists but is unusable. **med**
  8. **Silent download/metadata failures** — `Metadata.tsx:39-55` (try/finally, no catch → unhandled rejection), `Chromatograms.tsx:57` (fetch failure → "This file has no stored chromatograms"). **med**
  9. **`--syntax-num: #2e9e5b` fails WCAG AA (~3.4:1)** — `styles/tokens/aliases.css:17`; the exact value `colors.css:72-75` documents as an AA failure. Every number in every metadata TreeView renders sub-AA. **med**
  10. **TreeView: nested interactive elements + tab-stop flood** — `tree/TreeView.tsx:207-223`: `role="button"` div containing a real `<button>`; every row `tabIndex=0` with no roving tabindex → hundreds of Tab presses in large trees. **med**
  11. **App references ≥15 token names ui-kit never defines** — `--surface-input` (`Spectra.tsx:311`), `--green-600` (`Spectra.tsx:374`, falls back to the AA-failing green), `--shadow-md`, `--border-subtle`, `--text-danger`, `--weight-normal` (ui-kit calls it `--weight-regular`), `--warning-subtle/-text`, `--amber-50/300/900` — stale slate fallbacks silently render. **med**

  ### Polish (would-a-user-notice: marginal)

  - `Spectra.tsx:754-761` — PeakChromMenu `role="dialog"` without initial focus/focus trap/`aria-modal`. low
  - `Imaging.tsx` passim — raw `<button>`/`<select>` with local styles instead of kit `Button`/`Select`. low
  - Token fallback hexes drift (`--border-default` `#e2e8f0` vs `#cbd5e1` at `Chromatograms.tsx:290`, `Imaging.tsx:1414`, `Idle.tsx:212`; `--text-muted` 3 different fallbacks). No dark theme exists, so harmless today. low
  - `Ims.tsx:115` — Go input renders browser-default next to token-styled controls. low
  - `AdvancedTabs.tsx:41-50` — re-implements the kit's SegmentedControl; hardcoded `gap:2,padding:2` px amid rem tokens. low
  - Sub-24px interactive targets: `--control-h-sm: 22px` (`spacing.css:50`), `.mz-badge` 18px — WCAG 2.5.8. low-med
  - CV term info hover-`title`-only (`TreeView.tsx:132,160`). low-med
  - `Idle.tsx:368-369` — per-instance `<style>{keyframes}</style>`; `mz-spin` belongs in the stylesheet. low
  - `styles.css` imported twice (`App.tsx:17`, `main.tsx:6`). low
  - Stale comments: `ui-kit/index.ts:8-10`, `SegmentedControl.tsx:28-29` reference a nonexistent "primitives SegmentedControl". none
  - `SpectrumPlot.tsx:84-97` — seven refs written during render (React-Compiler-flagged pattern). low

  ### Fine (checked, one line each)

  - Trust-boundary validation (TIFF caps, grid DoS/NaN guards, URL grammar strict parsers, USI/id regexes) — correctly defensive, stays.
  - `gunzip.ts` already *is* the platform API (`DecompressionStream`); `locale-guard.ts` is a documented crash-prevention workaround — keep both.
  - Store stale-async guards (openSeq, per-item loadSeq, SupersededError) — thorough.
  - StudyDesign view — exemplary: explicit LoadState machine, `role="status"`, table captions/scope, gzip/BOM/truncation handling.
  - Imaging async UX (progress `role="status"`, per-mode EmptyState, scroll containment) and Idle drop-zone (`role="button"`, keyboard, abort/error surface) — solid.
  - SegmentedControl radio-group ARIA (roving tabindex, arrows/Home/End) and global `:focus-visible`/`prefers-reduced-motion` — textbook.
  - `Mutex`, footer cache, `dia.ts` WeakMap cache, prefetch time-slicing — justified by cited measurements.
  - Overall token discipline is high — dominant pattern is `var(--token, fallback)`, not raw hex; no dark-mode variant exists anywhere, which appears intentional per design docs.

  **Top three actions by leverage:** (1) delete the six dead cross-package chains (items 1–6, ~300 LOC, all risk low); (2) fix the silent-failure cluster in `store.ts` (defects 2–5) — same file, same pattern, users currently get lies instead of errors; (3) delete the ~220 LOC of dead ui-kit tokens so the token layer can become authoritative (defect 11's undefined-token drift becomes greppable).

  No files were modified.

