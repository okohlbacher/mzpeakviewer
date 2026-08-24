• I'll verify the plan against the cited code. Reading the key files now.

• The vendor submodule is empty here, so I'll check what the core code itself expects from the reader. Also verifying the checkout matches the plan's stated HEAD.

• One last check on the URL/ViewState mechanism for Q6, then I'll write the review.

• # Adversarial review: PLAN-UNDER-REVIEW.md (dual-source profile/centroid toggle)

  Reviewed against HEAD `c46faf2` (matches plan header; tree clean). Verification limits up front: `vendor/mzpeakts` is an **unchecked-out submodule** and `node_modules` is absent in this clone, so reader internals and the test-suite baseline ("contracts 70, core+app 249, minus 12 legacy") could not be executed — noted per item below.

  ## What checks out ("fine")

  - `reconstructSpectrum` routing, fall-through, declared-`representation` preservation, throw-on-neither: `packages/core/src/engine/spectrum.ts:461-519`, exactly as described.
  - `readEngineSpectrum` at spectrum.ts:525, `readEngineSpectrumCached` at spectrum.ts:671 with the three paths in the stated order (LRU hit 690-693, ion fast path 702-705, cold read 707-719).
  - LRU keyed by index only: `engine/cache.ts:80` (`Map<number, CachedSpectrum>`).
  - Ion fast path holds only the profile stream: the ion cache is filled exclusively from `streamSpectraDataArrays` (`engine/imaging.ts:281, 400, 481`). Plan's claim is correct.
  - Worker dispatch `case "selectSpectrum"` at `dispatch.ts:321`, latency feed at 329-331 (`recordReadLatency`).
  - Wire `SpectrumArrays` has `representation`, no source fields: `contracts/wire.ts:86-109`. Optional additive fields are safe.
  - MS-level Select at `Spectra.tsx:229-244`; peak-table gate at exactly `Spectra.tsx:500`; representation pill at 324-356.
  - `spectrumMeta` supplies declared representation: `reader/fileMeta.ts:103-122`.
  - XIC decoupling target exists as described: `engine/chrom.ts:161` (`pickUseProfileForLevel`).

  ## Findings

  ### HIGH-1 — The plan's own Q3 decision doesn't cover prefetch writes; the toggle stays hidden in the common case

  Plan §2 decision: "cache entries gain `sourceUsed`/`altAvailable` fields … set on the cold read." But `prefetchSpectrumCache` writes LRU entries directly — `cache.set(index, { mz, intensity, msLevel })` at `engine/spectrum.ts:632` — never touching `reconstructSpectrum`. For LC/DDA files the prefetch fills **all MS0/1** spectra (spectrum.ts:579-658), so the normal navigation path is a prefetch-warmed LRU hit (spectrum.ts:690-693) that never cold-reads.

  Concrete failing input: a dual-stored LC file → open → prefetch completes → navigate to a dual MS1 spectrum → LRU hit → entry has no `altAvailable` → "Signal" selector (gated on `altAvailable === true`, plan §5) **never renders**. The feature silently doesn't exist on precisely the files it targets. The golden test in §6 won't catch it: it uses uncached `readEngineSpectrum`.

  Fix is cheap and the plan already has the machinery: the prefetch drains **both** facets (spectrum.ts:654-656), so it can stamp `sourceUsed` (it knows which stream it's draining) and compute `altAvailable` per index during the second drain. This must be written into §2, not left to Q3.

  Would-it-bite-on-real-data: not today (0/60 dual per the plan's own corpus scan), but it's a defect in the feature's core mechanism, not an edge case.

  ### HIGH-2 — Sticky `signalSource` turns imaging pixel-picks into multi-second cold reads

  Plan §4: `selectSpectrum` passes the current `signalSource` when ≠ auto. Plan §2: forced reads "bypass the LRU and the ion fast path entirely." The imaging dock's pixel-pick goes through the same store action (`Imaging.tsx:123` → `store.ts:762,771`), and the ion fast path exists precisely because a cold `getSpectrum` "on large-row-group / no-page-index profile data costs ~seconds per pixel" (spectrum.ts:696-699).

  Concrete failing input: dual-storing timsTOF imaging file → user sets Signal = Centroid on one spectrum → switches to Imaging view → clicks pixels → every pick is a forced cold read, seconds per pixel, where today it's a warm-cache lookup. The plan never mentions this interaction; Q4 debates stickiness only in Prev/Next terms.

  Mitigation options: scope the forced source to Spectra-view selects (route=true), pass auto for pixel picks, or reset on view change. Must be decided in the plan, not discovered in review of the PR.

  Would-it-bite: only on dual-storing imaging files — none in the current corpus, but timsTOF is the stated IMS case and always has a peaks facet.

  ### MED-1 — `altAvailable` as specified isn't "non-empty", and empty scans are unspecified

  Plan §1: `altAvailable` = `hasCentroids(spectrum) && data-arrays non-empty`. `hasDataArrays` (spectrum.ts:312-314) tests **key presence, not length** — a present-but-0-length `m/z array` is truthy, and that's the file's explicit "0 data points" encoding (spectrum.ts:468-472). Concrete input: dual-schema file, one spectrum with 0-length profile arrays + 5 centroids → `altAvailable: true`; user toggles to Profile → forced read hits the fall-back. The plan's own §2 fallback makes this benign (truthful `sourceUsed`, no throw), so severity is low-medium — but the plan should use a length-checked predicate to match its own "non-empty signal" wording.

  Related gap: the genuinely-empty early return (spectrum.ts:485-487) returns before any routing. Plan §2 says "always set `sourceUsed`" — it must state what `sourceUsed` is for an empty spectrum, or the pill/peak-table gates see `undefined`.

  ### MED-2 — The rendering-gate mechanism is unspecified, and the pill change leaks onto real files

  `SpectrumPlot` branches **internally** on `spectrum.representation` (`ui-kit/src/spectrum/SpectrumPlot.tsx:31`, peak-picking at `peaks.ts:50`). Since `representation` must stay the declared value (invariant), §5's "centroid rendering gates on `sourceUsed`" requires Spectra.tsx to pass an overridden copy (`{...spectrum, representation: sourceUsed}`) into the plot at `Spectra.tsx:395` — the plan never says this. Consumers of declared representation that need an explicit decision, not just the two the plan lists:

  - footer text `Spectra.tsx:467-469` (unmentioned),
  - reporter-marker input built with `representation: spectrum.representation` at `Spectra.tsx:136-143` (TMT/iTRAQ peak picking — should follow `sourceUsed`),
  - imaging dock labels `Imaging.tsx:1065, 1144` (plan's §5 only touches the Spectra view; the dock shows the same store spectrum).

  Also: the pill is currently hidden when declared representation is null (`Spectra.tsx:324`: `spectrum.representation &&`). With `sourceUsed` always set, a pill would newly render on files lacking MS:1000525 — a visible change on real single-source files, which sits awkwardly next to the invariant "Auto path byte-identical to today for every existing file." Byte-identical arrays, yes; pixel-identical UI, no. Decide: keep the null-hide on the pill, or amend the invariant.

  ### LOW — Plan claims that don't check out or are unverifiable here

  - **`dataPointCount(i)` / `peakCount(i)` "exist on the reader metadata"** — no such symbols anywhere in `packages/core`, `app`, or `packages/contracts` (repo-wide grep: only the plan itself). The metadata record exposes `meta`/promoted columns + `isProfile` (`fileMeta.ts:103-122`). They may exist inside mzpeakts (not checked out here — unverifiable), but the "verified machinery" label is wrong for this repo. Impact: none — Q3 option (b) is rejected anyway.
  - **"12 legacy golden failures"** — the phrase occurs nowhere in the repo (HANDOFF.md, `.planning/`, tests). Baseline unverifiable; the suite can't run in this clone.
  - **Corpus claims (0/60 dual, 11/60 mixed)** — external data (`~/Claude/mzML2mzPeak/data`), not in-repo; unverified here.
  - Store signature is `selectSpectrum(index, route?, pixel?)` (`store.ts:250, 762`), not `(index, route?)` — cosmetic, but the `pixel` param is exactly where HIGH-2 enters.
  - "Prefetch fills the SAME LRU **around the current index**" — it caches all MS0/1, not a window (spectrum.ts:591-595). Wording only.

  ## Questions Q1–Q8

  - **Q1 — fine.** No runtime message validation exists: `dispatch(req: WorkerRequest, …)` trusts the type (`dispatch.ts:245-247`), structured clone ignores extra fields, the client passes `msg.spectrum` through untouched (`EngineClient.ts:691`), and ui-kit's plot input is a local structural type (`peaks.ts:19-27`). Optional fields both directions are safe.
  - **Q2 — bypass is right.** It makes the no-poisoning invariant hold by construction; (index, source) keying would let rare forced reads evict the prefetch working set and complicate the prefetch's index-keyed fills. Toggle-thrash re-read cost is bounded to one spectrum. Accept — but only together with a HIGH-2 fix.
  - **Q3 — (a), with two corrections.** Store the fields on cache entries at write time — and "write time" includes **prefetch** (HIGH-1), not just cold reads. For the ion fast path, omit `altAvailable` (toggle hidden for pixel picks): the plan's floated "one-time per-file bit" is the worst option — it's wrong for mixed files (profile MS1 + centroid MS2, 11/60 of corpus) and would advertise the toggle on every pixel of any imaging file with a non-empty peaks facet, each toggle triggering HIGH-2's cold read. Least-bad failure mode: hidden toggle until a real read happens.
  - **Q4 — sticky is acceptable, keep the plan's §5 escape hatch** (render the selector whenever `signalSource != auto`). Don't auto-reset: silently discarding an explicit user choice is worse than an honest fallback pill. But scope stickiness away from pixel-pick selects (HIGH-2).
  - **Q5 — keep feeding the timing.** A forced cold read is real user-perceived latency; the adaptive prefetch back-off (`dispatch.ts:329-331`) *should* account for it. Excluding it saves nothing and special-cases the dispatch path.
  - **Q6 — fine to defer.** The auto default means a shared link still shows the file's declared representation, so the "share what I see" violation is bounded to dual-stored files — which don't exist in the corpus yet. Revisit when the first dual file lands, not now.
  - **Q7 — correct to decouple.** `pickUseProfileForLevel` (chrom.ts:161-166) is a per-level bulk-extraction policy; coupling a per-spectrum display toggle to bulk XIC reads would silently change chromatograms — more surprising than the reverse.
  - **Q8 — partially answerable from this repo; the sharp edge is the accession values.** What the repo side demonstrably requires: `mzpeak_index.json` in the zip (missing index → `CorruptFileError`, `open.ts:186-199`); layout detection reads `bufferFormat` entries from the facets' array indexes, defaulting to `"point"` when absent (`reader/stats.ts:124-178` — a flat point-struct fixture is the path of least resistance); centroid records are read as `c["mz"]` / `c["intensity"]` (spectrum.ts:435-446); the promoted-column fast path wants `MS_1000511_ms_level` / `MS_1000525_spectrum_representation` (spectrum.ts:28-29), with per-record CV-param fallback in `spectrumMeta` (fileMeta.ts:110-114); TIC column must be one of `MS_1000285_total_ion_current_unit_MS_1000131` / `total_ion_current` (`open.ts:47-48`). **Bite candidate #1:** the representation column values must be the accessions `"MS:1000128"` / `"MS:1000127"` (spectrum.ts:30-31, 597-600) — write the CV term *name* and every spectrum silently routes profile-default. **Bite candidate #2:** mzpeakts renames/mangles array keys (spectrum.ts:419-422, 42-44) — the exact kv-metadata and naming requirements live in the vendored reader, which is not checked out here, so the writer script must be validated by running the golden test against the real reader, not by reading tea leaves. Budget one iteration of fixture debugging.

  ## Verdict

  Design is sound and the invariants are the right ones — but two holes sit in the feature's main path, not at the edges: prefetch-written cache entries never carry the fields the toggle depends on (HIGH-1), and sticky forced reads collide with the imaging ion fast path (HIGH-2). Both are fixable within the plan's own architecture; neither is acknowledged in the plan's Questions. MED-2's "how does the plot actually switch" belongs in §5 before implementation starts. Do not implement as written; amend §2/§4/§5 first.

