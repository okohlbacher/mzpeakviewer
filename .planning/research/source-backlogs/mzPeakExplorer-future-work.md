# mzPeakExplorer — future-work / known-limitations (extracted)

mzPeakExplorer has no formal `BACKLOG.md`. These forward-looking items were
extracted from its handoff/spec docs (2026-06-12) for provenance. Sources cited.

## Engine / scheduler (from `docs/preload-caching-mechanism-HANDOFF.md` §7)

- **EX-ENG-01 · No in-flight abort.** The scheduler has no `AbortSignal`; a user
  read waits for ≤1 in-flight background read to settle. True fix = thread an
  `AbortSignal` from `getSpectrum` through `zip.js` fetches. Called out as "invasive
  vendor surgery, deliberately not done." → **Addressed by the merge** (ENG-04
  requires per-message cancellation in `@mzpeak/core`).
- **EX-ENG-02 · Scheduler gates signal reads only.** Metadata/archive/parquet-column
  reads are NOT gated (scanSpectra, study-blob + archive-member reads,
  readParquetInfo, deep columns). Widen the gate if reader corruption appears under
  concurrency (except `scanSpectra`, intentionally concurrent). → Phase 3 should
  make all reads message-mediated (gating becomes uniform).
- **EX-ENG-03 · Preload order captured once.** If the user jumps away during the
  cooldown, preload resumes around the *old* selection; re-centering on live
  `selectedIndex` would tighten the low-bandwidth benefit.
- **EX-ENG-04 · `PRELOAD_COOLDOWN_MS=350` is a fixed guess.** Could be derived from
  observed read-latency percentiles for adaptivity.

## Deep-link / share-view (from `docs/share-view-deep-link-SPEC.md`)

- **EX-URL-01 · Live address-bar sync** — URL is written only on explicit "Share"
  click; auto-syncing the address bar as the user navigates is deferred (offer as a
  toggle, default off). → folds into Phase 5 URL resolver.
- **EX-URL-02 · On-the-fly chromatograms** (`xicmz`, `rt`) were added later than the
  rest of the grammar — historical note; the unified grammar (Phase 1/5) supersedes.

## SDRF / study metadata (from `docs/sdrf-sample-metadata-display-SPEC.md`)

- **EX-SDRF-01 · Long-tail characteristics matrix** deferred to an expander ("All
  characteristics & comments").
- **EX-SDRF-02 · Study protocols + ontology source reference registry** deferred to
  expanders.

These carry into the merged app's backlog (`.planning/BACKLOG.md`).
