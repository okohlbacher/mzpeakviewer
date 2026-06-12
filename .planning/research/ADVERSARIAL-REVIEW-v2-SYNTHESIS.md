# Adversarial review of the v2 roadmap — synthesis (round 2 of the design review)

**Date:** 2026-06-12
**Reviewers:** codex (`codex exec`, full disk read) + vibe (`vibe -p`, bounded), run in
parallel per PROC-01 §2. Raw outputs: `ADVERSARIAL-REVIEW-codex-v2.md`,
`ADVERSARIAL-REVIEW-vibe-v2.md`.
**Both verdicts:** `reject`.

## How to read this rejection

The v1 review caught **structural infeasibility** (a circular phase dependency). The
v2 review is different: both reviewers reject on **under-specification**, not
infeasibility. The roadmap is intentionally *coarse* and defers the load-bearing
detail to Phase 1 (the contracts). Both reviewers, reading the roadmap prose alone,
correctly flag that the detail isn't pinned down — which is precisely Phase 1's job.

So the resolution is not "redesign the roadmap" — it is **"build Phase 1 and let the
contracts answer the findings."** That is what was done in this same session: the
`@mzpeak/contracts` package encodes the decisions the reviewers asked for. The
findings split into two buckets:

- **Resolved in contracts** — answered by `packages/contracts/` + tests.
- **Roadmap/operator deltas** — genuine corrections to phase scope, risk labels, or
  deploy mechanics that belong in the roadmap, recorded here for the operator.

## Convergent findings (both reviewers — highest signal)

| # | Finding | Disposition |
|---|---|---|
| A | **Imaging-detection parity is overstated.** "Standardize on `probeIsImaging` 3-signal" is only true *after* a full probe; IV's live fast path gates initial mode on the `metadata.imaging.is_imaging` hint alone and can misclassify a file with IMS columns but no flag. (codex #4, vibe CRITICAL-2) | **Resolved in contracts.** `ImagingDetection` now carries `confidence: "hint" \| "probed"`, the 3 `ImagingSignal`s, and an `override`; `hasDetectionDiscrepancy()` surfaces force-on/off. Phase-3 detection must reach `probed` before trusting `!isImaging`. |
| B | **URL `scan` can regress through synthesized ids.** IV synthesizes `id = "scan=${index+1}"`; Explorer's serializer emits `scan` whenever an id contains `scan=N`, so an imaging selection could leak out as a native-scan link. (codex #8, vibe CRITICAL-3) | **Resolved in contracts.** `SpectrumSelector` is provenance-tagged (`by: scan\|spectrum\|pixel`); `serialize()` emits from `.by`, never by parsing an id. Test: a pixel selection with id `"scan=8"` serializes as `px=`, not `scan=`. |
| C | **`hasTicColumn` gating is underspecified / may force an expensive scan.** Fast summary knows only `numChromatograms`; TIC availability needs the per-spectrum scan. (codex #7, vibe MAJOR-4) | **Resolved in contracts.** `ChromatogramCapability.ticColumn` is tri-state `unknown\|present\|absent`; the rail shows Chromatograms on `numChromatograms>0 \|\| ticColumn==="present"` and treats `unknown` as not-yet (resolved by the scan pass). |
| D | **Worker boundary / large member reads hand-waved.** Per-message transfer vs clone, the 256 MB cap, and cancellation need to be concrete. (codex #2/#10, vibe MAJOR-3) | **Resolved in contracts.** `MESSAGE_POLICY` declares `cancellation`, `transfersResult`, `paged`, `sizeCapBytes` per request; `archiveMemberBytes` is capped at `MAX_MEMBER_BYTES` and transfers. See E for the cancellation honesty fix. |
| E | **Phase 3 Structure/Parquet migration understated.** Explorer's Structure path uses `reader.store`, live parquet handles, a `WeakMap` keyed by the reader, and dynamic `hyparquet` — not a thin call surface. (codex #3, vibe CRITICAL-1) | **Partly resolved + roadmap delta.** The protocol covers it (`parquetFooter`/`deepColumn`/`sampleColumn`/`archiveList`), but the *migration* is a redesign of cache identity + dynamic imports. **Roadmap delta:** split Phase 3 into a Structure/Parquet workerization spike with parity fixtures before the general engine migration. |
| F | **Phase 0 mislabeled low-risk.** It's gated on an unmerged external PR; locally IV still throws on Numpress Linear and Explorer carries the fix. (codex #5, vibe MAJOR-1) | **Roadmap delta.** Reclassify Phase 0 as *schedule-critical*; name the fallback fork SHA, owner, and acceptance tests (aux-arrays + Numpress Linear round-trip). |

## codex-only findings

- **#1 Phase 1 needs the workspace before it can ship a package.** The graph
  `0→1→{2,3}` put monorepo setup in Phase 2, but Phase 1 promises `@mzpeak/contracts`.
  **Resolved:** this session scaffolds the npm workspace *in* Phase 1 (root
  `package.json` workspaces + `packages/contracts/`), so the package exists where the
  roadmap promised it. Roadmap should move "stand up workspace" from Phase 2 into Phase 1.
- **#2 "every long read is abortable" is false.** Neither reader threads an
  `AbortSignal`; IV uses stale-result suppression. **Resolved:** `CancellationMode` is
  `abort | stale-drop | none` per message — the label tells the truth (network opens =
  `abort`; rapid-click spectra = `stale-drop`). Phase 3 upgrades `stale-drop`→`abort`
  only where it actually wires an `AbortController`.
- **#9 Redirect paths conflate `/IV/` with the GitHub Pages `/mzPeakIV/` root.**
  **Resolved in contracts.** `LEGACY_PATH_MAP` carries both: `/IV/`→`/view/`
  (mzpeak.org) and `/mzPeakIV/`→`/mzpeakviewer/` (github-pages); `legacyIvRedirect`
  tested for both. **Roadmap delta:** Phase 5 must publish a shim per target with a
  built-asset `base` test.
- **#10 Large local-file open memory spike.** IV reads the whole file to an
  `ArrayBuffer` before transfer. **Roadmap delta:** Phase 3 should evaluate passing a
  `File`/`Blob` handle (structured-cloneable) instead of pre-read bytes, with a memory
  test. The contract's `OpenSource` leaves room (`file` variant) to swap this later.
- **#11/#12 Safety harness too late; Explorer has no e2e yet.** **Roadmap delta:**
  move minimal cancellation/perf/redirect smoke tests into Phases 3 & 5; add Explorer/
  unified e2e setup as an explicit Phase-3 deliverable before "both apps e2e green".

## vibe-only findings

- **MINOR-1 hidden edge: Phase 2 also depends on Phase 0** (both apps must build
  against one reader to consume ui-kit unchanged). **Roadmap delta:** add the `0→2`
  edge to the dependency graph.
- **MAJOR-2 / MINOR (codex #6) ui-kit "presentational only" is optimistic.** Spectra/
  Structure/Chromatograms import store actions today; extraction needs container/
  presenter splits. **Roadmap delta:** narrow Phase 2 to tokens + already-pure plots,
  or raise its risk and add explicit container-extraction work.
- **MINOR-5/6 `px=` is new (not a unification); override UX mechanism unspecified.**
  Acknowledged; `px=` is modeled in the grammar, override UX is a Phase-4 design item.

## Net disposition

- **6 findings resolved directly in `@mzpeak/contracts`** (A, B, C, D, codex #2, #9) —
  with tests. This is the substance of the rejection answered.
- **codex #1 resolved** by scaffolding the workspace in Phase 1.
- **~8 findings are roadmap/operator deltas** (E, F, codex #10/#11/#12, vibe MINOR-1/
  MAJOR-2): phase-scope and risk-label corrections that do not block Phase 1 and are
  recorded above for the operator to fold into ROADMAP.md before Phase 3.

**Recommendation:** accept Phase 1 (contracts) as the resolution of the
under-specification findings; apply the roadmap deltas (Phase 0 risk reclassification,
Phase 3 split, Phase 2 scope narrowing, harness-earlier, deploy-path split) before
planning Phase 3. No structural redesign is required — unlike v1.
