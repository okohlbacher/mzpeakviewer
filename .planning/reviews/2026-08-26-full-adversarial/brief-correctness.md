# Adversarial CORRECTNESS review — mzpeakviewer @ 3f139f7 (clean tree)

You are reviewing the mzPeak viewer monorepo for CORRECTNESS BUGS. Scope: `app/src`,
`packages/core/src`, `packages/contracts/src`, `packages/ui-kit/src`. The vendored reader
`vendor/mzpeakts/lib/src` may be read for context and reviewed where the app depends on its
behavior. Do NOT review generated dist/, node_modules, or .planning.

## Domain invariants (violations of these are the highest-value findings)
1. The engine runs in a Web Worker; ONLY structured-clone/transferable data crosses the
   boundary (packages/contracts/src/wire.ts). Typed arrays transfer — a transferred buffer
   must never alias a cache the worker still holds.
2. The declared spectrum `representation` (MS:1000525) is NEVER rewritten; the displayed
   facet is `sourceUsed`. Forced-source reads must never poison the auto cache.
3. The spectrum LRU + ion cache share one byte budget; caches are keyed by spectrum index;
   provenance fields are stamped at write time.
4. URL grammar: ViewState is EXACTLY the shareable state; serialize→parse→resolve must be
   a fixpoint. VALID_VIEWS gates deep links.
5. Stale-async: every await in app/src/store.ts must guard against a newer open
   (currentOpenSeq) or a superseded selection.
6. Files are UNTRUSTED input: malformed metadata must degrade, not crash; all SDRF/study
   content renders as text only.
7. Flat vs nested (legacy) mzPeak column naming both resolve (reader/explorer/cv.ts getCol).
8. Imaging: ion images sum MS1 only (fallback: all when no MS1); pixel picks must stay on
   warm cache paths.

## Attack these specifically
Q1. app/src/store.ts race conditions: openSeq/selectSpectrum/setSignalSource/reselect,
    prefetch interplay, notices. Concrete interleavings that corrupt state.
Q2. packages/core/src/engine/spectrum.ts + cache.ts: the forced-source paths, prefetch
    provenance stamping (drains both facets), transfer-safety of every adaptSpectrum call.
Q3. packages/core/src/engine/{imaging,chrom,scanBreakdown,studyMeta,wavelength}.ts:
    numerical correctness, off-by-ones, NaN handling, per-level XIC source pick.
Q4. packages/contracts/src/url/grammar.ts round-trip completeness for EVERY ViewState field.
Q5. app/src/views/*.tsx: effect deps, stale closures, unmount races, cache keys
    (StudyDesign.tsx module cache), list keys.
Q6. worker dispatch + EngineClient: request supersede/cancel correctness, transfer lists,
    error propagation.

## Contract
- file:line for every claim + a concrete failing input/interleaving.
- Severity (BLOCKER/HIGH/MED/LOW) + "bites on real data or theoretical?".
- If an area is fine, say "fine" in one line.
- REVIEW ONLY — do not modify any file.
