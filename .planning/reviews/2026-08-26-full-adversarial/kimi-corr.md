• This is a large read-only review. I'll fan out adversarial reviewers per attack area (Q1–Q6), then compile verified findings.

• All six reviewers reported. Now I'll spot-verify the HIGH-severity claims against the actual code before compiling.

• HIGH claims verified so far. Checking the remaining two key claims (prefetch stale-generation writes, wavelengthMatrix transfer).

• One point needs verification: whether the spectrum prefetch's mutex is the same as the worker dispatch mutex (decides if the stale-generation finding is real).

• All six areas reviewed; HIGH claims spot-verified against the code, including the mutex/gen mechanics behind the prefetch finding. Here is the consolidated report.

  # Adversarial CORRECTNESS review — mzpeakviewer

  Six attack areas reviewed (Q1–Q6); all findings below cite verified code. Repo untouched (scratch repros only under `/tmp`).

  ## HIGH

  **1. `setSignalSource` discards an in-flight user selection — plot and selector diverge** — `app/src/store.ts:748`
  `const cur = st.spectrum?.index ?? st.selector?.index ?? null` prefers the *previously loaded* spectrum over the current selector. Interleaving (reproduced against the real `EngineClient`): spectrum 3 shown → filter change fires `selectSpectrum(7)` (ungated, `Spectra.tsx:182-188`) → a second `selectSpectrum(9)` supersedes it; the superseded catch clears `spectrumLoading` (`store.ts:809-811`), re-enabling the Signal dropdown → user toggles Signal → `reselectWithSource(3, …)` (`store.ts:1041-1046`) supersedes select(9). End state: `selector.index = 9` (drives picker, share URL, USI at `urlSync.ts:207-211`) but the plot shows spectrum 3, silently. **Bites on real data** (cold remote reads make the window seconds wide). Fix direction: prefer `selector.index`, and/or a selection token so a reselect can't supersede a newer user selection.

  **2. Spectrum prefetch hardcodes nested-only column names — misroutes/misscopes on flat-layout files** — `packages/core/src/engine/spectrum.ts:28-29,596-605`
  `readCols` uses `getChild("MS_1000511_ms_level" / "MS_1000525_spectrum_representation")`, bypassing `getCol` (`packages/core/src/reader/explorer/cv.ts:36-43`), which exists because the current flat layout names them `ms_level` / `spectrum_representation`. On flat files both columns read `null`, so: `isMs01` (`:635-638`) treats MS2+ as MS1 → MS2 spectra get prefetched, wasting the shared budget; and `reprOf` returns null for all → the data drain accepts everything, the peaks drain nothing. On a centroid-only flat LC/DDA file the entire prefetch silently caches nothing; on a dual-stored flat file, centroid-declared spectra are cached from `spectra_data` stamped `sourceUsed:"profile"`, so a warm hit serves profile arrays under a `"centroid"` declaration — contradicting the module's own "cache hit never returns mismatched arrays" (`:614-616`). Reproduced with a mock flat-layout reader. **Bites on real data** (flat is the current converter layout).

  **3. Stale-generation spectrum prefetch writes file-A rows into file-B's cache** — `spectrum.ts:667-686`, `packages/core/src/worker/dispatch.ts:213-220,251-258`
  The drain checks `shouldStop` (gen) only in `waitWhileUserActive` *between* slices, never inside the mutex slice or between check and queue. Window: prefetch passes `shouldStop` while a newer `open` is still queued on `ctx.mutex` (gen not yet bumped — the bump happens synchronously at dispatch start) → prefetch's `runExclusive` queues behind the open → open clears `ctx.spectrumCache` (same instance, `clear()` not replace) and bumps gen → the queued slice resumes with the old reader's generator and `cache.set`s file-A rows, keyed purely by spectrum index, into file-B's fresh cache. `readEngineSpectrumCached` (`spectrum.ts:797`) then serves the old file's spectra under the new file's metadata until LRU eviction. Note the ion prefetch commit *is* gen-guarded (`dispatch.ts:191`) — the spectrum writes are not. **Bites on real data**: local non-imaging file (prefetch gated on `!ctx.remote`, `dispatch.ts:216`) → quickly open another file.

  **4. Mean/ROI accumulator doesn't skip NaN/Infinity — poisons bins onto the wire** — `packages/core/src/engine/imaging.ts:581-584,600-601`
  `sum[i] = intensity[i]!` with no finite check; `finalizeMean` (`:617-620`) emits `sum/cnt` verbatim and `adaptSpectrum` copies without sanitizing → NaN/±Infinity intensities in the wire `SpectrumArrays`. One NaN permanently poisons its bin. The module's own ion path guards (`if (Number.isFinite(v))`, `imaging.ts:141`), as does `sanitizePairs` — so the inconsistency is provably unintended. Failing input: any mean/ROI where one spectrum carries a NaN/Inf intensity (malformed numpress decode). Reproduced verbatim: `[10,20]+[NaN,40]+[30,60]` → means `[NaN,40]`. **Bites on real data** on malformed files (invariant 6); never on well-formed converters.

  **5. In-flight ion/RGB render writes the old file's image into the new file's store** — `app/src/views/Imaging.tsx:316,350`, `app/src/store.ts:759-761`
  `setIonImage` is a plain `set()` with no `currentOpenSeq` check; `EngineClient.open()` only supersedes pending *opens*, and the worker's single mutex resolves the render against the old reader before the open runs. Interleaving: open big imaging file A → cold Render (slow; the progress bar exists for this) → open file B mid-render → the render result lands after `INITIAL_OPEN_STATE` cleared `ionImage` but before `finishOpen` commits → B's Ion/Overlay views show A's image and A's `ionStats`; Overlay composites A's layer over B's grid. Same for `renderMulti`'s partial/final writes. The optical path right above it is gen-guarded (`Imaging.tsx:270-286`) — the guard was simply not applied here. **Bites on real data.**

  **6. Active DIA-XIC card shares as a windowed TIC — silent wrong-data link** — `app/src/urlSync.ts:220-227`
  `ChromRequest.mode === "diaXic"` (`packages/contracts/src/protocol.ts:69`, reachable via `Chromatograms.tsx:99`) has no grammar representation, so the fallthrough serializes it as `chrom=tic&rt=…`. Recipient gets a TIC card instead of the precursor/fragment XIC — no notice, wrong data. **Bites on real data** (DIA is common; every other mode round-trips).

  ## MED

  - **M-a. Sticky error banner.** `store.ts:818-821` sets `error` on a failed read; success paths (`:804`, `:956`) never clear it. One corrupt spectrum → permanent banner until reopen (`App.tsx:836`). **Bites on real data.**
  - **M-b. `applyViewState` continuation is not openSeq-guarded.** `urlSync.ts:61-160`: after the select awaits, `addXic`/`addTic` (`:124-130`), `setIonRequest`/`setRgbChannels`/`setRoiRect` (`:135-142`) and notices (`:148-159`) run unconditionally. Deep link on slow remote file + user drops a local file mid-hydration → file A's XIC card (perma-loading), imaging params and notices pollute file B. **Bites on real data.**
  - **M-c. `mixedRepresentationWarning` hardcoded `null`** (`dispatch.ts:280`) — the store's mixed-representation notice (`store.ts:397-399`) is dead code; dual-representation files never warn. **Bites on real data** (silently inoperative feature).
  - **M-d. Reference m/z axis of the mean never sorted.** `imaging.ts:578-590` copies the first spectrum's m/z in file order; `nearestBin` binary-searches it. Unsorted first spectrum → wrong bins for every subsequent spectrum (repro: means `[1,2,11.5]` vs correct `[15.5,6,11.5]`). **Bites on real data** but rare (MALDI axes are usually ascending).
  - **M-e. `buildWavelengthMatrix` throws on a single undecodable spectrum** (`wavelength.ts:399-401`, no try/catch) → the whole PDA view dies; sibling `wavelengthRange` degrades to `null` (`:361-364`). Invariant 6 violation. **Bites on real data** for malformed/truncated files.
  - **M-f. `wavelengthMatrix` transfers the worker's own cached matrix.** `dispatch.ts:360-368` caches `ctx.wavelengthMatrix` and transfers its buffers → first response detaches the cache; a second request in the same session throws `DataCloneError`, surfaced as a misleading `{class:"internal"}`. Reproduced. **Bites on real data** — currently masked because the store requests it exactly once per file (`store.ts:979-984`); every other cached-payload path copies before transfer.
  - **M-g. `EngineClient.open()` supersede race.** `EngineClient.ts:297-308`: the settle handler clears `openRequestId` unconditionally; with three opens, A's late settle zeroes the id so C never supersedes B → B's promise *resolves* with a stale `opened` payload, violating the documented contract. Reproduced (needs a macrotask boundary — the separate-clicks case). **Bites on real data** — masked today by the store's `currentOpenSeq` guard (`store.ts:640,650`).
  - **M-h. `chromatograms` reachable in-app on imaging files but deep links reject it** (`grammar.ts:284-285,317-323` vs `App.tsx:93,106` + `capability.ts:139-141`) → shared link lands on `summary` with cross-mode notices. **Bites on real data** for imaging files with TIC.
  - **M-i. `?view=ims|study|wavelength` accepted for files lacking the capability** (`grammar.ts:224-229` only mode-gates imaging/LC view sets; in-app tabs are capability-gated at `App.tsx:96-109`) → deep link lands on an empty view the app never offers. Degrades, doesn't crash.
  - **M-j. `num()` 4-decimal quantization corrupts small tolerances** (`grammar.ts:337-339`): `tolDa:0.00004` → `0`, and the ion/channel paths pass `tolDa:0` straight into `setIonRequest`/`setRgbChannels` (`urlSync.ts:135-136`) → degenerate m/z ± 0 extraction, no notice. Mostly theoretical (sub-0.05 mDa tolerances), but the ion path makes it a wrong empty image.
  - **M-k. `Structure.pick` has no stale-response guard** (`Structure.tsx:286-299`): slow member A then fast member B → footer A renders under selected row B (heading and selection visibly disagree). **Bites on real data** for remote files.
  - **M-l. StudyDesign module cache cross-contaminates same-basename local files** (`StudyDesign.tsx:36,61,69`): key is `"local"::basename::member`; two different `/data/*/run.mzpeak` files collide → file 1's parsed SDRF served for file 2, never invalidated on open. **Bites on real data** in exactly that scenario.

  ## LOW (abbreviated)

  - Q1: `spectrumLoading` flickers false mid-load on supersede (`store.ts:809-811` — enabler of HIGH-1); `reselectWithSource` swallows real errors (`:1047-1054`); failed select leaves `selector` pointing at an unloaded spectrum (`:794` vs `:818-821`); `reset()` never calls `engine.close()` — old-file prefetch keeps burning CPU (`:687-737`); `loadWavelengthMatrix` `inFlight` closure goes stale across opens (`:1001-1003`); 60 s hydration cap silently drops deep links (`urlSync.ts:179-183`); `?sig=` deep link wastes a forced re-read of spectrum 0 (`urlSync.ts:71-73`).
  - Q2: prefetch caches raw stream arrays, bypassing `sanitizePairs` (warm/cold behavioral split, `spectrum.ts:680`); prefetch drops ion mobility — warm hits lose the mobilogram on non-compact IMS LC files (`:701` gate vs `:823-828`); ion fast path serves arrays with no facet provenance (`:814-817`) and ignores a forced `source` argument (`:814-816`, flagged by two reviewers independently); `CacheBudget.sub` clamps at 0 (`cache.ts:67`); `IonCacheBuilder` doesn't reserve bytes during build (`cache.ts:278-303`).
  - Q3: `cheapTic` mixes seconds and scan indices on one axis (`chrom.ts:196`); `studyMeta` `numOf("")` coerces to 0 (`studyMeta.ts:24-27`); SDRF fallback reports `matchedRun:true` when no matching occurred (`:169,192-193`); λmax validation inconsistent between browse and reconstruct (`wavelength.ts:336` vs `:208`).
  - Q4: `spectrumZoom` collapse/truncation beyond 4 decimals (`grammar.ts:369,128-132`); stored-chrom id starting with literal `id:` mangled (`:393-396` vs `:195`); `xic.msLevel < 1` breaks the fixpoint (`:372` vs `:187-188`); dead `preload`/`cache` grammar surface (`:98-101`, consumed nowhere).
  - Q5: duplicate archive-member paths → duplicate React keys (`Structure.tsx:314`, `Metadata.tsx:84` — crafted ZIP); `setBusy` after unmount in download buttons (React 18 no-op).
  - Q6: six ops declared `cancellation:"abort"` but worker `cancel` is a no-op ack (`protocol.ts:229-253` vs `dispatch.ts:315-319`) — false machine-readable contract; no caller today.

  ## Fine (verified clean)

  - **Two opens in flight, prefetch/ionIndexReady interplay, notice lifecycle, chromList concurrency, selectPixel** (Q1) — all correctly seq/gen-guarded.
  - **Forced-source path** — never writes the LRU, exact `sourceUsed` match on hits, no auto-cache poisoning; **invariant 2** (representation never rewritten) holds on every branch; **transfer-safety** of all `adaptSpectrum` calls (always copies; no cached buffer aliases a transferred one); **invariant 3** budget mechanics and atomic provenance stamping (Q2).
  - **Imaging window sums, invariant 8 (MS1-only with all-levels fallback), pixel-pick warm paths, cache/budget parity; chrom.ts per-level XIC source pick; scanBreakdown.ts; studyMeta.ts coercion/degradation; wavelength.ts sorting/merge/empty-input** (Q3).
  - **Selector forms, channel colors with commas, view elision/inference, VALID_VIPS === ALL_VIEWS (14/14), no separator/NaN holes in numeric params** (Q4).
  - **Invariant 6 text-only rendering** (no HTML-injection sink anywhere in `app/src`/`packages/*/src`), hook order, unmount races across view switches, list keys, effect deps (Q5).
  - **Error propagation, all other transfer lists, select supersede/stale-drop, message-ID monotonicity, worker mutex serialization** (Q6).

  ## Caveats

  - `vendor/mzpeakts` is an uninitialized (empty) submodule in this checkout, so two vendor-dependent claims were dropped as unverifiable: whether `streamPointArrays` yields views into shared batch buffers (would undercount cache retention), and inverted-`mzLo > mzHi` XIC behavior.
  - Q2-HIGH-3's mechanism is the check-then-queue gap on the shared `ctx.mutex` (verified in `mutex.ts`/`engine.worker.ts`), not "clearing without the mutex" as the sub-reviewer phrased it — conclusion and repro unchanged.

