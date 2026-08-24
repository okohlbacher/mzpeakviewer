# PLAN: switchable profile/centroid display for dual-stored spectra — mzpeakviewer

Repo: ~/Claude/mzPeakViewer, HEAD c46faf2 (clean). Review the PLAN against the code it
cites. REVIEW ONLY — do not modify any file.

## Context

mzPeak can store the SAME spectrum both as profile (`spectra_data`) and centroided
(`spectra_peaks`). The reader materializes both on one record (`dataArrays` +
`centroids`); the engine's `reconstructSpectrum` (packages/core/src/engine/spectrum.ts:461)
routes by the DECLARED representation (MS:1000525) with silent fall-through to the other
source when the routed one is empty, and always reports the declared `representation`
(wire `SpectrumArrays`, packages/contracts/src/wire.ts:86 — has `representation`, no
source fields). The Spectra view renders centroid as sticks + peak table, profile as a
line (app/src/views/Spectra.tsx; peak table gated on `representation === "centroid"`,
line ~500).

Goal: when BOTH sources exist for the displayed spectrum, offer a "Signal" selector
(styled/placed like the MS-level Select in Spectra.tsx:229-244) to switch the display
between them. Auto (declared) remains the default.

Corpus note: no current corpus file dual-stores (0/60 scanned); testing needs a
synthetic dual fixture. Mixed files (profile MS1 + centroid MS2) are common (11/60)
and must be unaffected.

## Relevant machinery (verified)

- `readEngineSpectrum(reader, index)` spectrum.ts:525 → reconstruct → `adaptSpectrum`.
- `readEngineSpectrumCached(reader, index, cache, ionCache?)` spectrum.ts:671:
  1. spectrum LRU `SpectrumLruCache` keyed by **index only** (engine/cache.ts:80).
  2. an **imaging ion-cache fast path** (decoded f32 arrays from the ion prefetch)
     serving pixel-pick selects.
  3. cold read via reconstruct; result cached by index.
- Worker `case "selectSpectrum"` dispatch.ts:321 → `spectrumResult`; EngineClient
  `selectSpectrum(index)`; store `selectSpectrum(index, route?)` sets `spectrum`.
- Prefetch fills the SAME LRU (auto-source reads) around the current index.
- `spectrumMeta(reader, index)` supplies declared representation (fileMeta.ts).
- Per-spectrum metadata counts: `dataPointCount(i)` / `peakCount(i)` exist on the
  reader metadata (nullable — SciEX MRM ships null counts; null ≠ 0).

## Proposed change

### 1. Wire (packages/contracts/src/wire.ts)

`SpectrumArrays` gains:
- `sourceUsed?: "profile" | "centroid"` — which FACET supplied the displayed arrays
  (set by reconstruct; distinct from the declared `representation`, which is unchanged
  and still drives the "file claims X" pill).
- `altAvailable?: boolean` — the OTHER source also holds a non-empty signal for this
  spectrum (computed from the already-fetched record: `hasCentroids(spectrum)` &&
  data-arrays non-empty — NOT from the nullable count columns).

`selectSpectrum` request gains `source?: "profile" | "centroid"` (absent = auto).
Same field threaded through EngineClient.selectSpectrum(index, opts?).

### 2. Engine (packages/core/src/engine/spectrum.ts)

- `reconstructSpectrum(..., forceSource?: "profile" | "centroid")`:
  - forceSource undefined → exactly today's routing (bit-for-bit).
  - forceSource set → read THAT source; if it's empty, FALL BACK to auto routing and
    report the truthful `sourceUsed` (never throw just because the user toggled onto
    an empty facet — but also never silently show the same data labeled differently).
  - Always set `sourceUsed` (profile = data-arrays path, centroid = centroids path)
    and `altAvailable`.
- `readEngineSpectrum(reader, index, source?)` threads it through.
- `readEngineSpectrumCached`: forced reads **bypass the LRU and the ion fast path
  entirely** (no cache write): toggles are rare, one-spectrum reads; keying the LRU by
  (index, source) would let forced entries evict the prefetch working set, and the ion
  fast path only holds the profile stream. Auto reads stay exactly as today.
  The LRU CACHED entry however doesn't store sourceUsed/altAvailable — the cached-hit
  path recomputes altAvailable cheaply from metadata counts?? NO — counts are nullable.
  Decision: cache entries gain `sourceUsed`/`altAvailable` fields (2 bytes), set on the
  cold read; the ion-fast-path result sets `sourceUsed:"profile"`, `altAvailable` from
  a one-time per-file bit (see Q3 — this is the muddiest part, attack it).

### 3. Worker + client

dispatch `selectSpectrum` passes `req.source`; forced reads skip prefetch timing feed
(they're not representative user latency? — or keep; Q5). EngineClient mirrors.

### 4. App store

- `signalSource: "auto" | "profile" | "centroid"` (default auto), reset on open AND on
  file change; NOT in the URL/ViewState for this pass (deferred; Q6).
- `setSignalSource(src)`: sets state + re-selects the CURRENT spectrum with the forced
  source (route=false).
- `selectSpectrum` passes the current signalSource when != auto (so Prev/Next keep the
  chosen source while browsing — same stickiness as the MS-level filter; Q4).

### 5. Spectra view (app/src/views/Spectra.tsx)

- New "Signal" `<Select>` next to the MS-level filter, options Auto/Profile/Centroid,
  RENDERED ONLY when `spectrum.altAvailable === true` (or when signalSource != auto —
  so the user can always get back to Auto even after landing on a single-source
  spectrum; Q4).
- The representation pill shows `sourceUsed` (what IS displayed); tooltip keeps the
  declared value when they differ ("file declares profile — showing centroids").
- Peak table + centroid rendering gate on `sourceUsed === "centroid"` (today:
  declared representation).
- Mobility panel unchanged (per-peak mobility rides whichever source carries it).
- XIC/chromatogram source selection (chrom.ts pickUseProfileForLevel) is deliberately
  NOT coupled to this toggle (it's a per-level bulk-extraction policy; Q7).

### 6. Tests

- Pure: reconstructSpectrum forced-source cases (dual record: force each way; forced-
  onto-empty falls back with truthful sourceUsed; altAvailable set; mixed-file single-
  source records unchanged + altAvailable false; declared representation NEVER
  rewritten).
- Golden: generate a small committed dual fixture `packages/core/test/fixtures/
  dual.mzpeak` (python + pyarrow writer script committed next to it): 3 spectra ×
  ~30 profile pts + ~5 centroids each, flat schema (point-struct spectra_data +
  spectra_peaks + spectra_metadata with both counts + index json, zip64 not required).
  Golden test: openEngineFile → readEngineSpectrum auto/profile/centroid → assert
  point counts differ, sourceUsed truthful, altAvailable true.
- UI: dev-server manual verification with the fixture served over a local CORS
  server (?file=http://localhost:PORT/dual.mzpeak): toggle switches sticks↔line,
  pill + peak table follow sourceUsed. (No new e2e in this pass.)

## Invariants

- Auto path byte-identical to today for every existing file (mixed and single-source).
- Declared `representation` never rewritten anywhere.
- No cache poisoning: a forced read must never be served later for an auto request,
  and vice versa.
- Old-format files and the 12 legacy golden failures unaffected.
- typecheck 0, suite green (current: contracts 70, core+app 249, minus 12 legacy).

## Questions (attack these)

Q1. Wire compat: `sourceUsed`/`altAvailable` optional fields + optional request field —
    any place that structurally validates messages and would reject unknown fields?
Q2. Is bypass-the-cache for forced reads right, or should the LRU key become
    (index, source)? Consider the prefetch (fills by index), eviction fairness, and a
    user toggling back and forth on a huge profile spectrum (re-read each time?).
Q3. altAvailable on CACHE HITS and the imaging ion fast path: the record isn't
    re-fetched there. Options: (a) store altAvailable in the cache entry at cold-read
    time (ion fast path: unknown → omit → toggle hidden for pixel picks until a cold
    read happens); (b) recompute from nullable metadata counts (wrong on null-count
    files); (c) always cold-read when the LRU misses metadata (perf). Which failure
    mode is least bad?
Q4. Stickiness semantics: signalSource sticks across Prev/Next like the MS-level
    filter; when the next spectrum lacks the alt source, forced read falls back +
    pill shows truth. Acceptable, or should the toggle auto-reset to Auto?
Q5. Should forced reads feed the adaptive prefetch cooldown timing (dispatch.ts:325)?
Q6. Deferring the URL param (?sig=) — fine, or does Share-view silently losing the
    toggle violate the "share what I see" contract badly enough to include now?
Q7. Keeping XIC extraction decoupled from the toggle — correct, or surprising?
Q8. The dual fixture: flat schema hand-written via pyarrow — which subtleties will
    bite (array_index kv metadata? chunk vs point layout? counts columns)? Cite what
    the reader actually requires to open it (packages/core reader path).

## Review contract

file:line for claims; concrete failing inputs; severity + would-it-bite-on-real-data;
"fine" where fine; no padding; REVIEW ONLY.
