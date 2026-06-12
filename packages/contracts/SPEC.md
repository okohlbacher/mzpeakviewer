# @mzpeak/contracts — the Phase-1 contract spec

The keystone the engine (`@mzpeak/core`) and the unified shell are built against.
**Types + a pure URL module + tests only** — no reader, no engine, no UI, zero
runtime behavior change in either source app. This document is the written spec the
roadmap's Phase-1 success criterion #3 calls for; the code is the source of truth and
the tests are the executable contract.

Derived from `../../.planning/research/MERGE-ROADMAP.md` (§1 boundary, §2 capability
model, §3 URL grammar) and the v2 adversarial review
(`../../.planning/research/ADVERSARIAL-REVIEW-v2-SYNTHESIS.md`). Review findings folded
into the contract are tagged inline below.

## 1. Worker protocol (`protocol.ts`, `wire.ts`)

The superset of IV's ~30 imaging/worker messages and Explorer's data access (which is
main-thread today and becomes messages in Phase 3). One discriminated `WorkerRequest`
union (main → worker) and one `WorkerResponse` union (worker → main).

**Boundary rule (MERGE-ROADMAP §1.1):** only structured-clone-safe or transferable
values cross. No Reader, Arrow Table, parquet handle, or WASM memory. The engine maps
reader output into the plain `wire.ts` payloads (`SpectrumArrays`, `ImagingGridWire`,
`ChromatogramSeries`, `ParquetFooter`, `ColumnPage`, …). `ImagingGridWire` flattens
IV's `Map<number,number>` coord lookup to transferable typed arrays.

**Per-message policy (`MESSAGE_POLICY`)** — machine-readable, tested:

| Field | Meaning |
|---|---|
| `cancellation` | `abort` (AbortController-backed hard stop) · `stale-drop` (run to a chunk point, suppress by id) · `none`. Honest per-op — "everything abortable" was false (review codex #2). |
| `transfersResult` | result typed array/ArrayBuffer is moved via transfer list, never cloned. |
| `paged` | request takes `offset/limit`; large columns never cross in one clone. |
| `sizeCapBytes` | hard payload cap (`archiveMemberBytes` = `MAX_MEMBER_BYTES` = 256 MiB). |

Every long request carries a `requestId`; the response echoes it; `cancel{cancelId}`
targets it. `open` implies `close` of the prior reader — **single open file per
session** (multi-file is out of scope, stated not assumed).

## 2. Capability model (`capability.ts`)

The shell derives **all** nav visibility from `CapabilityModel` — never from a single
`isImaging` boolean (MERGE-ROADMAP §2).

- **Imaging detection** runs in two phases (review codex #4 / vibe CRITICAL-2):
  `confidence: "hint"` (cheap `metadata.imaging.is_imaging` only, available
  immediately) → `"probed"` (full 3-signal `probeIsImaging`: `ims-columns` OR
  `cv-params` OR `metadata-flag`). `detected` is the auto result; `override` forces
  on/off; `isImaging` is the effective flag; `hasDetectionDiscrepancy()` is true when
  a user override disagrees with detection (the Grid/Summary surface for NAV-07).
- **Chromatograms are imaging-independent.** `ticColumn` is tri-state
  `unknown | present | absent` (review codex #7): the rail shows Chromatograms on
  `numChromatograms>0 || ticColumn==="present"`, treating `unknown` as not-yet (the
  scan pass resolves it — no forced expensive scan just to build nav).
- **Optical** gates Optical + Overlay, additionally requiring `isImaging`.

## 3. Store + view-state (`store.ts`)

One active `View` id (the §2 rail maps 1:1), one `SpectrumSelector`, one
`SettingsPolicy`. `ViewState` is the *shareable* subset the URL round-trips; the full
`UnifiedState` adds load phase, capabilities, notices, and accordion state.

`SpectrumSelector` is **provenance-tagged**: `by: "scan" | "spectrum" | "pixel"`. The
URL serializer emits from this tag, never by re-parsing an id — so a synthesized
imaging `scan=N` id cannot leak out as a native-scan link (review codex #8).

## 4. URL grammar (`url/grammar.ts`, `url/legacy.ts`)

A pure parse / resolve / serialize module — no DOM, no store.

- **`parseSearch`** folds aliases (`url→file`, `tab→view`, `cacheMB→cache`) and
  collects repeatable `ch`.
- **`resolve(raw, mode)`** applies the §3.2 **conflict matrix** against the file
  `mode` (`imaging | lc | unknown`):
  - selection precedence **`scan` > `px` > `spectrum`** (exactly one wins; losers
    noticed); `px` is imaging-only.
  - cross-mode params are **dropped with a non-blocking info notice** (the §3.5
    banner), never an error/blank: `ion`/`ch`/`roi`/`optical`/`overlay` on an LC file;
    `xic`/`xicmz`/`chrom` on an imaging file; a cross-mode explicit `view` falls back
    to inference.
  - mixed spectrum + chromatogram/imaging params are **both applied** (data view
    active, spectrum stays selected) — matches Explorer today.
- **`inferView(raw, mode)`** (§3.3): explicit view → imaging `ch>ion>roi>overlay>
  optical` → LC `xicmz>xic>chrom` → selection→spectra → summary.
- **`serialize(v, mode)`** emits the **shortest canonical** query: `view` only when it
  differs from what inference would derive; selection from provenance; `ion` drops the
  tol when default. Round-trip is a tested fixpoint.
- **`legacy.ts`** — the two real `/IV/` translations: `scan=N` (1-based index) →
  `spectrum=N-1`, and `ion=mz` + `&tol=Da` → `ion=mz,Da`; everything else passes
  through verbatim. `LEGACY_PATH_MAP` covers **both** deploy roots (review codex #9):
  `/IV/`→`/view/` (mzpeak.org) and `/mzPeakIV/`→`/mzpeakviewer/` (GitHub Pages).

## 5. What this package deliberately does NOT do

No reader, no worker engine, no React. It imports nothing from `mzpeakts`. The wire
types are decoupled mirrors so Phase 0's `DataArrays`/`Reader` reshaping cannot break
the contract. Detection *logic*, scheduler, cache, and rendering live in `@mzpeak/core`
(Phase 3) and must populate these exact shapes.

## 6. Tests (executable contract)

`npm test` in this package: 49 tests across `url/grammar.test.ts` (parse, conflict
matrix, inference, provenance serialization, round-trip fixpoints), `url/legacy.test.ts`
(translations, pass-through, old-link regression corpus, per-target redirects),
`capability.test.ts` (nav gating, detection discrepancy), `protocol.test.ts`
(policy coverage + coherence).
