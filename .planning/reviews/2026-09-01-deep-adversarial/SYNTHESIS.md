# Deep adversarial review — 2026-09-01 (baseline 8f697aa, post-v0.9.2)

Reviewers: codex 0.152.0 (read-only, live tree, engine/reader + fix-wave brief),
kimi 0.39.1 (isolated worktree, whole-codebase/app-shell brief, worktree verified
untouched), internal pass (probes + a 4,000-case grammar-fixpoint fuzz). vibe 2.24.0
produced zero bytes in three backgrounded runs despite passing foreground smoke tests
— dropped, noted honestly. All three CLIs had upgrades available; codex/kimi were
current at dispatch (0.152.0/0.39.1).

## Confirmed and FIXED in v0.9.3 (verify-then-fix; every item empirically reproduced)

P0 (all in the vendored reader unless noted):
1. **Narrow m/z-window slicing returned EMPTY** — `binarySearchNearest` computed
   fractional mids, never advanced bounds, returned falsy 0; `betweenSorted` used
   "nearest" indices with an exclusive end. A centroid at exactly 150.0 with window
   [149.9,150.1] sliced to [0,0]. Every narrow XIC/DIA extraction was affected.
   Rewritten as true lower-bound math; pinned by test/window-slice.test.ts. [codex 1]
2. **Mapped `time` columns never populated Spectrum.time** — flat files map `time`,
   so ALL their record times were 0 (PDA RT axes collapsed to 0 s). [codex 2]
3. **Terminal group off-by-one** — the LAST spectrum lost its scans/precursors/
   selected-ions rows in every file (`binarySearchAll` conditional ++hi). [codex 12]
4. **DIA window map dead on flat files** (core `dia.ts`) — nested-only ms_level column
   name; proven 0 windows on HEK (1,837 MS2). + DIA facet chosen by whole-file majority
   instead of the MS2 level. [internal, independently codex 3+4]
5. **Manifest/archive roles showed "[object Object]"** on every file since the
   DataKind/EntityType class change (core fileMeta/structure) — fixing it un-broke the
   structure.golden legacy test (10 legacy fails remain, was 11). [codex 19]
6. **Zero-length profile rows blocked the centroid fallback** (core spectrum.ts daOk
   key-presence vs length). [codex 6]

P1/P2 (fixed):
- extractAllLevels merge hole: minority-facet points for indices ABSENT from the
  majority facet are now kept (mis-declared/minority-only spectra vanished). [codex 5]
- TIC >50k-row size-guard now fails loud instead of rendering an empty "successful"
  trace. [codex 17]
- EngineClient: terminal worker errors are sticky (later requests fail fast instead of
  buffering into a dead worker); superseded-open settlement no longer untracks a newer
  open. [codex 13+14]
- localPathOf rewritten (textual scheme strip, no URL truncation): #/?/% filenames
  verbatim, file:/ single-slash, file://host → UNC form, Explorer UNC paths, web
  origin-relative /path regression restored; readLocalFile stat-capped at 2 GiB.
  Pinned by localFile.test.ts. [internal + kimi 2/3/4/7]
- quadOf strict empty-field rejection [kimi 5]; StudyDesign cache key + open
  generation [kimi 1]; member downloads gen-guarded [kimi 8]; share links serialize
  ALL DIA cards [kimi 6]; flat chromatogram catalog type/nPoints from params
  (verified on HEK: TIC/BPC + 264 pts, was blank) [internal]; label-free projections
  no longer fake reporter channels [codex 20]; adapt/browse.ts time comment [kimi 9].

## Verified-fine (both reviewers + fuzz agree)
Store select/open token machinery; RT minutes↔seconds exactly once on every path;
grammar round-trip fixpoint (4,000-case fuzz; only failure mode is the documented
sub-8-sig-digit zoom collapse); RemoteBlob serialization has no bypass and no
deadlock; forced-source cache bypass; rejectAllPending bookkeeping; dia= hydration
cannot duplicate cards.

## Filed as backlog (real, not release-blocking; several need fixtures/design)
- codex 7 IMS mobility capability false-negative (standard non-compact IMS prefetch
  loses mobility on warm hits) — needs an IMS fixture to fix safely.
- codex 8 imaging ion-cache reused as spectrum-display cache (facet provenance +
  mobility loss on dual/IMS imaging).
- codex 9 mean/ROI populations (grid-membership + ROI MS2 filter) — design decision.
- codex 10 transient read failures cached as permanent zeros (imaging px, wavelength
  matrix row) — needs an invalidation/notice design.
- codex 11 compact-IMS imaging renders blank (pre-existing; no fixture).
- codex 15 prefetch gen-check before mutex (one obsolete read; latency only).
- codex 16 null-time points fall back to Number(index) labeled seconds; NaN-time sort.
- codex 21 capabilityGate swallows real I/O errors from spectrumData().
- codex 22 no-scans-facet flat file throws on every get() (theoretical; no fixture).
- codex 18 term_marker inconsistently applied upstream (Scan/Chromatogram builders
  bypass it) — REPORT UPSTREAM to mzpeakts.
- kimi 6-adjacent: share links still omit non-DIA extra cards (xic/stored mix).
- chainRead head-of-line blocking on a hung fetch (no fetch timeout) — pre-existing.
