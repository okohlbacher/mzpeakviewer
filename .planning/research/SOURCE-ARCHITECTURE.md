# Source architecture — what we're merging

Architecture maps of the two source apps as of 2026-06-12, plus the vendored-reader
divergence. This is the provenance for Phases 1–3 (contracts, ui-kit, engine). It
reflects deep reads of both codebases; re-verify against the live trees before
implementing.

---

## A. mzPeakIV (imaging viewer) — `~/Claude/mzPeakIV`

**~14.4k LOC `src`.** Stage-based shell; **Web Worker data engine**.

- **Shell:** `src/ui/App.tsx` — stage router (idle → loading → ready / no-imaging /
  error); conditional rendering on `capabilities.isImaging`. Center-stage `View`
  type = `overview | optical | ion | multi | blend`.
- **State:** `src/state/store.ts` (~761 LOC, zustand). Imaging state (grid, tic,
  ionImage, multiChannel, ROI, optical) is optional; non-imaging files skip it.
- **Worker engine:** `src/worker/mzPeakWorker.ts` + `protocol.ts` — **~30 message
  kinds**, the engine the merge adopts. Notable: `loadFile`/`loadUrl`,
  `selectSpectrum`, `renderIonImage`, `renderMultiChannel`, `meanSpectrum`,
  `roiSpectrum`, `getOpticalImage`, `ionIndexPreload*`, `setCacheConfig`. Returns
  plain typed arrays / ImageData. Module-global `activeReader` + `activeZipStorage`
  (single open file). Also `parquetFooter.ts` / `parquetMini.ts` in the worker.
- **Reader boundary:** `src/reader/` — `openUrl`, `resolveUrl`, `fileMeta`, `stats`
  (incl. `probeIsImaging` — **3-signal** detection: promoted IMS columns OR CV
  params OR `metadata.imaging.is_imaging`), `arrays`, `capability`, `types`.
- **Imaging surface (~1.3–2k LOC):** `src/imaging/` (grid reconstruction, optical
  decode), `src/compute/{ionImage,tic,smooth,histogram}.ts`, `src/ui/ImagingPanel.tsx`
  (1231 LOC — ion/multi/ROI/optical/blend + TIFF), `OpticalPanel`,
  `GridDiagnosticsPanel`, `src/export/tiff.ts` (428 LOC).
- **Deep-links:** `?scan=N` (**1-based displayed index** — NOT a native scan
  number), `?ion=<m/z>[&tol=Da]`, `?optical=<index|name>`, `?file`/`?url`,
  `?preload`, `?cache`/`?cacheMB`. Precedence scan > ion > optical.
- **Consumes mzpeakts** as a **git submodule** (vite alias → `lib/src`, types →
  `lib/dist/*.d.ts`).

## B. mzPeakExplorer (general explorer) — `~/Claude/mzPeakExplorer`

**~9.1k LOC `src`.** 5-tab nav; **NO Web Worker** — reader on the main thread.

- **Shell:** `src/ui/App.tsx` (~398 LOC) — `NAV` = Summary, Metadata, Spectra,
  Chromatograms, Structure; tab state in the store; conditional render gated on
  `ready`. Two-lane sidebar (rail / chip nav).
- **State:** `src/state/store.ts` (~952 LOC, zustand) + module-level `reader`,
  `loadGen`, `specCache` (LRU), `remoteSource`. `src/state/readScheduler.ts` (~110
  LOC) — **priority/background lanes**; preloader yields to user reads
  (`PRELOAD_COOLDOWN_MS=350`); **no AbortSignal**.
- **No worker:** the reader holds live Arrow/WASM handles on the main thread
  (Arrow not serializable). Concurrency is queue discipline, not threads.
- **Reader boundary:** `src/reader/` (~2.8k LOC) — `open`, `summary`
  (`computeFastSummary` O(1) + `scanSpectra` time-sliced), `imaging.ts`
  (`readImaging` — **1-signal** detection: `metadata.imaging.is_imaging` only),
  `browse`, `archive`, `parquetDeep` (uses `reader.store`, parquet handles, a
  `WeakMap` keyed by the reader, dynamic `hyparquet`), `meta`, `sampleMeta`
  (SDRF/ISA), `cv`/`curie`/`types`.
- **5 tabs:** Summary (388, incl. the imaging **metadata-only** block — pixel grid,
  optical listing, scan geometry; **no ion-image rendering**), Metadata (JSON tree,
  58), Spectra (292, uPlot + reporter ions/quant), Chromatograms (147 — TIC/XIC/
  stored, click→nearest spectrum), Structure (598 — parquet inspection).
- **Deep-links / resolver** (`src/ui/shareView.ts`): `file`/`url`, `tab`, `scan`
  (**native scan number**), `spectrum` (0-based), `ms`, `mz`, `chrom`
  (`tic|<id|index>`), `xic` (`mz,delta`), `xicmz` (`lo,hi`), `rt`, `preload`,
  `cacheMB`. "Share view" button copies a link for URL-loaded datasets.
- **Consumes mzpeakts** as an **in-tree copy** (vite alias → `lib/src`; `file:`
  install).

## C. The divergence that drives the merge

| Axis | mzPeakIV | mzPeakExplorer | Merge resolution |
|---|---|---|---|
| Data engine | Web Worker owns reader+compute | main-thread reader + scheduler + cache | **one worker engine** (`@mzpeak/core`) — port the scheduler/cache in (Phase 3) |
| Imaging | full visualization | metadata-only block | Explorer base + IV's imaging as a lazy chunk |
| `scan` param | 1-based displayed index | native scan number | unify on native number; legacy IV `scan=N`→`spectrum=N-1` |
| Imaging detect | `probeIsImaging` (3 signals) | `readImaging` (1 signal) | standardize on `probeIsImaging` + override |
| mzpeakts | submodule `b826397` (aux-arrays) | in-tree `a87abe3` + numpress patch | one submodule, Phase 0 |
| Reader type | `DataArrays` incl. `BigInt64Array` | older shape | reconcile in Phase 0 |

## D. Vendored reader differences (Phase 0 input)

- **mzPeakIV:** clean upstream submodule pin at `b826397` ("support auxiliary
  arrays"), **no local patches**.
- **mzPeakExplorer:** in-tree copy of upstream `a87abe3` + **two local patches**
  enabling Numpress Linear (`numpress.ts` 64-bit accumulation fix for negative m/z
  at high mass; `data.ts` removing a dead `Unsupported Numpress Linear` throw).
  Upstreamed as [HUPO-PSI/mzpeakts#1](https://github.com/HUPO-PSI/mzpeakts/pull/1).
- **Neither is a superset:** IV has aux-arrays Explorer lacks; Explorer has working
  Numpress Linear IV lacks. Phase 0 converges both to a commit with **both**.

## E. What survives vs what gets rebuilt

- **Survives largely intact:** the reader boundary (one superset), uPlot spectrum
  plot, metadata JSON tree, parquet/structure inspector, SDRF/ISA, design tokens,
  IV's imaging compute (ion image, multi-channel, ROI, TIFF, optical, grid).
- **Gets rebuilt/unified:** the data engine (worker boundary + scheduler/cache
  moved in), the two stores → one, the two deep-link grammars → one, the two
  deploy surfaces → one. This is unification, not deletion — see MERGE-ROADMAP.md §6.
