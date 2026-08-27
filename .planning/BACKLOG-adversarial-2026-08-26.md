# Backlog — full adversarial review + corpus UI sweep (2026-08-26)

> **Status update (v0.9.0, 2026-08-26):** the P0 correctness tier is fixed — items
> 1–13 all addressed (RT units, prefetch, select/hydration/open-seq races, mean/ROI,
> wavelengthMatrix transfer, XIC/TIC facet routing, dia= URL grammar, engine
> robustness, and the small-items cluster; only the share-URL provenance/zoom
> plumbing in item 13 remains: spectrumZoom/opticalRef aren't store-tracked and a
> deep-linked ?scan= re-serializes as spectrum=). From P1: 15 (silent failures),
> 18, 19, 22 (missing tokens + AA green + banner colors; forced-colors/dark-mode
> remain), 23, and the mislabel + matrix-retry-loop from 24 are fixed. From P2:
> 25 (deepColumn) and 29 (mixedRepresentationWarning) deleted. Everything else —
> P1 items 14, 16, 17, 20, 21, rest of 24; P2 26–28, 30–32; P3 — remains open.
> v0.9.2 residual: on a FAST local open of a dual-facet file, the initially-selected
> spectrum 0 can be served from the prefetch cache before the peaks drain stamps
> `altAvailable`, so the Signal toggle is hidden until the user navigates (from #1 on
> it shows; HTTP opens are unaffected — the cold read wins there). Fix direction:
> propagate the peaks-drain altAvailable flip to the store for the current selection,
> or re-stamp on the cache-hit read.
> > P3 item 33 note: the legacy `imaging.mzpeak` fixture also breaks 5 interaction
> e2e tests (error banner "Cannot read properties of null (reading 'get')") —
> verified pre-existing at the v0.8.8 baseline; regenerate the fixture flat.

**Baseline:** v0.8.8 @ `3f139f7` (clean).
**Sources** (verbatim outputs in `.planning/reviews/2026-08-26-full-adversarial/`):
codex 0.147.0 ×2 (correctness; ponytail+UI), kimi 0.34.0 ×2 (same splits, isolated
worktrees, verified untouched), an internal 20-agent workflow (51 raw findings →
adversarially verified: 13 confirmed / 1 refuted), and a 63-file Playwright sweep of the
LIVE corpus through the built app (real worker + WASM + Canvas).

**Corpus sweep verdict: 60/63 pass; the 3 "failures" are leading-empty-scan files**
(e.g. MSV000095995 has no signal before spectrum #829) — data characteristics, not
viewer bugs, but they motivate UX-9. Every capability surface exercised per file:
open, Spectra render, Chromatograms list, UV/VIS, Study design, Imaging TIC.
Sweep spec committed as `app/e2e/corpus.spec.ts` (opt-in: `CORPUS_SWEEP=1`).

Convergence notation: [C]=codex, [K]=kimi, [W]=internal workflow (verified). Items
found independently by ≥2 sources are marked ★. Severity is post-verification.

---

## P0 — Correctness: wrong science on screen (fix before any feature work)

1. ★ **RT minutes displayed as seconds, everywhere.** The wire contract says seconds
   (`wire.ts:58`); `scanBreakdown.ts:28` and `chrom.ts:138` pass the file's
   minute-unit times through raw. Already visible in shipped screenshots: SBA415
   "RT 0.0–80.0 s" is an 80-minute run. Affects browse RT, chromatogram axes, XIC RT
   windows, nearest-spectrum-by-RT. [C] (confirmed against live corpus evidence)
2. ★ **Stale-generation spectrum prefetch writes file A's spectra into file B's LRU.**
   Gen check happens between slices, never at the write (`spectrum.ts:667-686`);
   the ion prefetch IS gen-guarded (`dispatch.ts:191`), the spectrum one is not.
   File B then serves file A's arrays under B's metadata. [C BLOCKER][K H3]
3. ★ **Prefetch `readCols` uses nested-only column names** (`spectrum.ts:596-605`),
   bypassing `getCol`: on flat files (the current corpus!) MS-level and representation
   read null → MS2 spectra prefetched, centroid-declared spectra cached from the
   PROFILE facet stamped `sourceUsed:"profile"` — warm hits contradict the declaration;
   on centroid-only flat files the prefetch caches nothing. [C][K H2][W]
4. ★ **In-flight ion/RGB render commits the old file's image into the new file's store**
   (`Imaging.tsx:314-350` unguarded `set()`); optical path right above is gen-guarded.
   Also `ionIndexReady` lacks a seq guard (`store.ts:1028`) → new file wrongly marked
   warm. [C][K H5][W]
5. ★ **Mean/ROI spectrum aggregation is wrong four ways** (`imaging.ts:575-620`):
   NaN/Inf intensities permanently poison bins (ion path guards, mean doesn't);
   reference axis taken from the FIRST sampled pixel unsorted (binary search over
   unsorted axis → wrong bins) and truncates all m/z outside pixel 0's axis;
   includes MS2/non-grid spectra. [C][K H4+M-d][W ×3]
6. ★ **Signal-toggle/selection state divergence family** (all three confirmed by [W],
   echoed [C][K H1]): (a) `setSignalSource` prefers the DISPLAYED index over the
   pending selector (`store.ts:748`) — a toggle mid-load silently cancels the user's
   navigation and desyncs picker/share-URL/USI from the plot; (b) superseded selects
   unconditionally clear `spectrumLoading` (`store.ts:809`) — every rapid re-select
   shows the OLD spectrum with no loading indicator for the new one's whole load, and
   re-enables loading-gated controls (this is what makes (a) reachable); same pattern
   in `reselectWithSource` + UV selects; (c) `?sig=` hydration comment's premise is
   false — spectrum 0 IS loaded, the un-awaited reselect races the deep-linked
   selection. Fix direction: prefer selector over spectrum, per-select tokens before
   clearing flags, await/order hydration.
7. ★ **`wavelengthMatrix` transfers its own cached buffers** (`dispatch.ts:360-368`) —
   second request hits detached arrays (`DataCloneError` → misleading "internal").
   Masked today only because the store calls it once per file. [C][K M-f][W]
8. **XIC/TIC facet-selection blind spots:** an all-level XIC extracts from ONE facet
   chosen by whole-file majority, silently dropping the minority representation's
   signal (`chrom.ts:163,302`); the TIC signal-fallback picks the majority facet
   BEFORE MS1-filtering → can be empty despite valid MS1 profile (`chrom.ts:217-231`).
   [C ×2]
9. **Prefetch entries lose ion mobility and skip `sanitizePairs`** (`spectrum.ts:680`):
   warm hits on IMS files lose the mobility panel; unsorted/non-finite bulk rows are
   served unsanitized where cold reads sanitize. [C][W ×2]
10. **DIA-XIC has no URL grammar** — an active diaXic card serializes as `chrom=tic`
    (windowed TIC): silent wrong-data share links. [K H6]
11. **Cross-file guards missing at app edges:** `applyViewState` continuation not
    seq-guarded after its awaits (XIC cards/imaging params/notices from file A pollute
    file B) [K M-b]; demo-download completion reopens over a newer file
    (`Idle.tsx:131`) [C]; `selectSpectrum`'s captured `route=true` yanks the user back
    to Spectra after they navigated away [C]; EngineClient open/tracker supersede races
    (masked by store guards today) [C][K M-g].
12. **Engine robustness (untrusted input):** ion-window sums include NaN-m/z points
    (`imaging.ts:138,158`) [C][W]; `buildWavelengthMatrix` throws on one undecodable
    spectrum → whole PDA view dies (`wavelength.ts:399`) [K M-e]; archive-member cap
    ignores the protocol's 256 MiB (app passes 2 GiB → OOM risk on hostile files)
    (`structure.ts:179`) [C]; worker init failure (missing WASM/CSP) leaves `open()`
    pending forever — no error path (`EngineClient.ts:225-251`) [C].
13. **Smaller confirmed correctness items:** sticky error banner never cleared on
    success (`store.ts:818`) [K M-a][kimi-pony 3]; `sdrfChannelsFallback` reports
    `matchedRun` without real matching in a degenerate path (`studyMeta.ts:192`)
    [C][W]; `wavelengthRange` reads only spectrum 0 vs its dataset-range contract
    (`wavelength.ts:356`) [C][W]; sample-label channels pushed with null reporter m/z
    suppress the SDRF fallback [C]; `num()` 4-decimal URL quantization collapses tight
    tolerances/zooms to zero/equal → dropped or degenerate on hydration
    (`grammar.ts:336`) [C][K M-j]; share-URL omits `spectrumZoom`/`opticalRef` and
    rewrites `?scan=` provenance as `spectrum=` (`urlSync.ts:190,204`) [C];
    ROI/grid deep-link forcing to Overview (`urlSync.ts:143`) [C]; imaging files with
    chromatograms: in-app tab exists, deep link rejected (`grammar` vs `App.tsx`)
    [K M-h]; bigint polarity check fails (`chrom`) [W]; Structure member pick lacks a
    stale-response token (`Structure.tsx:286`) [C pony][K M-k].

## P1 — UI/UX defects (a user notices)

14. ★ **Charts are mouse-only and invisible to AT.** Every plot/heatmap is a bare
    div/canvas — no role/label/text fallback; zoom, pan, peak actions, hover: pointer
    only; the peak dialog takes no focus. The product's core surfaces exclude
    keyboard/SR users. [C pony 5][kimi-pony 1]
15. ★ **Async failures rendered as valid empty data** ("has no UV/VIS spectra",
    "no stored chromatograms", vanished Study tab, silent metadata download failure,
    silent reselect failure) — one silent-catch cluster in `store.ts` + views.
    [C pony 7,12][kimi-pony 2,4,5,8]
16. ★ **Imaging failure states:** failed pixel-pick shows "Loading spectrum…" forever;
    optical decode error cached forever with no retry; keyboard cell cursor moves but
    is never drawn. [C pony 6][kimi-pony 7]
17. **Structure view: out-of-order commits + no catalog loading/empty distinction.**
    [C pony 2]
18. ★ **StudyDesign module cache can serve the wrong file's study** (same
    source/filename/member key; no run/open-generation identity). [C pony 4][C corr]
19. **Imaging spectrum docks clip the fixed-320px plot inside 200px containers.**
    [C pony 3]
20. ★ **Keyboard-unreachable interactions:** peak-table/Parquet rows as clickable
    `<tr>`, chromatogram drag-reorder handle, TreeView nested-interactive + tab-stop
    flood + false clipboard ✓, Advanced tabs' fake tablist. [C pony 8-10][kimi-pony 6,10]
21. **UV/VIS navigation strands indices past 1,000** (no Go-to control, dead Select).
    [C pony 11]
22. ★ **Token debt with visible consequences:** ~15 token names referenced but never
    defined (`--surface-input`, `--text-secondary`, `--green-600`…) → transparent
    input surfaces + AA-failing green for numbers (`--syntax-num` ~3.4:1); error
    banner red-on-red (`--danger-soft` misuse); focus ring vanishes in forced-colors;
    dark mode structurally unsupported (charts hardcode light hexes).
    [C pony 13 + polish 3,4][kimi-pony 9,11][W]
23. **Leading-empty-scan files open onto a blank plot with zero guidance** (3 corpus
    files start with hundreds of empty scans; MSV000095995's first signal is #829).
    Add "jump to first non-empty spectrum" affordance + an explicit empty-spectrum
    state in the plot. [sweep + C pony 15]
24. **Misc:** "Load demo" button actually closes the current file (mislabel) [W];
    wavelength-matrix failure auto-retry loop [C pony 1]; UV/IMS chart-height
    contracts drift (dead space) [C pony polish]; Idle screen not responsive at phone
    widths [C pony polish]; async status changes not announced (role=status/alert)
    [C pony 14].

## P2 — Ponytail: delete/simplify (~700–800 LOC production + ~130 LOC tests)

Full itemized lists: codex-pony (12 items) + kimi-pony (29 items) — they agree on the
big six dead cross-package chains (~300 LOC, all risk-low):
25. ★ `deepColumn` protocol+client surface with no dispatch case and no caller.
26. ★ `cancel`/`CancelledError` chain (app never cancels; stale-drop covers it) and
    the decorative message-policy metadata (transfer/paging/size-cap table read
    nowhere at runtime; "abort" labels that cannot abort — see also P0-12).
27. ★ `setCacheConfig` + inert `?preload=`/`?cache=` URL params.
28. ★ `probeIsImaging` duplicate of `probeImagingSignals` (+ `computeStats` returning
    constants).
29. ★ `mixedRepresentationWarning` hardcoded null (protocol→client→store dead chain) —
    NOTE: or IMPLEMENT it; the store's notice branch was designed for dual files that
    now exist (decide, don't leave dead).
30. `url/legacy.ts` (only its own test), `parseUsi`, `ImagingDetection.override`,
    grid `diagnostics`/`strategy` write-only fields, dead store mirrors
    (`chrom`/`chromReq`/`activeMirror`), `reset()` third copy of the field list,
    `ALL_VIEWS` vs `VALID_VIEWS` duplication (drift-scarred), dead ui-kit primitive
    APIs + ~220 LOC dead stylesheet tokens + barrel over-exports, speculative decoders
    (tof-grid-global, Layout B) — delete until a real file exists.
31. ★ **Consolidations:** two copy-paste LRUs → one generic; `sanitizePairs` ×2;
    `toRepresentation` ×3 + REPR literals ×4; three viridis definitions (visibly
    different colors!); ui-kit heatmap/chart helper duplication (~135 LOC);
    popover-dismiss hook; chromatogram typed-array→objects→arrays round-trip;
    adaptive prefetch-cooldown machinery → fixed constant (unmeasured, floor-clamped);
    move test-only `getSpectrumArrays`/`readEngineSpectrum(source)` helpers out of
    prod modules; shadow opener (`explorer/open.ts`) vs canonical opener.
32. **Inline styles:** 384 `style={{}}` across 12 views. Per the ladder: ONE
    `TextInput` primitive (5 byte-similar copies) + adopt ui-kit `Button` for ~10
    hand-rolled buttons (already style-drifted); leave one-property muted-text inline.

## P3 — Standing debts (pre-review, still open)

33. 12 legacy golden tests fail (old nested-format fixtures) — migrate per the
    "drop old format" decision.
34. `.meta` per-record fallbacks return empty on flat records — proper reconciliation.
35. Converter-side handoffs outstanding: sample_list projection (SDRF), ragged
    `chromatograms_data.ms_level` (MSV000090203), DTIMS all-NaN mobility.
36. `PXD076703` single-spectrum >60 s read — serial re-check.
37. kimi/codex/vibe CLIs outdated (0.38.0 / 0.149.1 / 2.24.3 available).

## Suggested execution order

1. P0-1 (RT units) + P0-5 (mean/ROI) — wrong-science, small fixes, canonical tests.
2. P0-2/3/4 (generation + prefetch column names) — one "gen-guard + getCol" pass.
3. P0-6 (selection/loading tokens) — one store refactor with interleaving tests.
4. P1-15/16 (silent-failure cluster) + P1-22 (token debt) — highest UX leverage.
5. P2-25..29 (the six dead chains, ~300 LOC) — riskless deletions, then the rest.
