# Phase 3 — engine spike plan (`@mzpeak/core`)

Derived from `MAP-iv-worker.md` + `MAP-explorer-data.md` and the two adversarial reviews
(both flagged Phase 3 as a redesign, not a thin port). **The rule the reviews enforce:
build the engine against a parity gate — never refactor blind.**

## 0. Base + boundary (settled by the maps)
- **Base = IV's worker** (`mzPeakWorker.ts`) — it already owns the reader + a `ZipStorage`
  off-main-thread and implements ~9 of the contract messages 1:1 (the contract copied IV's
  imaging response types verbatim).
- **Port IN** Explorer's data access (it has no worker) as the ~8 net-new messages.
- Arrow/WASM/parquet handles never cross; only the `wire.ts` payloads do.

## 1. Parity gate FIRST (the thing that makes the rest safe)

**Key enabler (verified):** the `mzpeakts` reader + parquet-wasm run in **node** — IV's
`src/reader/*.test.ts` (reader/stats/capability/arrays/scanCoords) open the real
`example.mzpeak` (287 KB) in vitest. So the engine's reader-I/O HANDLERS and the golden
gate are node-testable against real fixtures — NO browser needed until the Worker
postMessage boundary + Canvas/WASM-in-worker bundling (Phase 4). This means slice 2
(handlers) is unit/integration-testable here, not deferred to e2e. Fixtures available:
IV `example.mzpeak` (imaging, 287 KB); Explorer `small.mzpeak` (LC, 2 MB),
`imaging-demo.mzpeak`, `small.chunked.mzpeak`.

Before porting anything, capture **golden fixtures** from the read-only old apps:
- Run each old app's existing unit suites and record the reader-output snapshots they already
  assert on (IV: stats/grid/ion-image; Explorer: summary/browse/chrom/parquet) into
  `packages/core/test/golden/`.
- For the round-trip, capture: open→capabilities, scanBreakdown→BrowseIndex, selectSpectrum→
  SpectrumArrays (incl. `representation`), extractChrom(tic)→series, renderIonImage→stats,
  on a small imaging fixture AND a small LC fixture (the consolidated `*.mzpeak` already in
  the old apps' `public/static`, ≤2 MB).
- The engine's output must equal these. This gate exists in CI before message #1 lands.

## 2. Migration order (maps' recommendation — easy/safe first, spike last)
1. **`open` / `opened`** — unify IV's `loadUrl`/`loadFile`+`loadResult`/`noImaging` into one
   capability-driven `opened`; map IV's thin `Capabilities` → the rich `CapabilityModel`
   (3-signal `ImagingDetection` from `probeIsImaging`; chrom/optical/`Presence`). Flatten IV's
   `ImagingGrid` (Map) → `ImagingGridWire` (transferable Int32Arrays).
2. **`selectSpectrum`** — IV path + emit `representation` (now required on the wire). Golden:
   centroid AND profile spectra render-correct. *(critical round-trip half)*
3. **`archiveList` + `archiveMemberBytes`** — Explorer's archive reads; make member bytes
   TRANSFER (not clone), cap→truncate (Explorer throws today), drop the eager TextDecode.
4. **`extractChrom` (tic/xic/stored)** — Explorer's chrom path. *(critical round-trip, LC)*
5. **`scanBreakdown` → `FileStats` + `BrowseIndex`** — Explorer's time-sliced `scanSpectra`
   as columnar transferable arrays.
6. **imaging compute** — IV's `renderIonImage`/`renderMultiChannel`/`meanSpectrum`/`roiSpectrum`/
   `getOpticalImage`/grid (already worker handlers) behind the unified protocol.

## 3. THE SPIKE (do before #5/#7 committal) — Structure/Parquet workerization
The hard redesign (review CRITICAL): Explorer's `parquetDeep.ts` keys a footer cache on a
`WeakMap<Reader,…>`, walks Arrow `StructVector` types, and dynamic-imports `hyparquet`. None
of that crosses a worker boundary.
- **Re-key** the cache by load-generation (mirror IV's `loadGen`), cleared on `open`.
- Move the dynamic `hyparquet` import + Arrow type-walk INSIDE the worker; emit only plain
  `ParquetFooter`/`ColumnPage`/`ColumnSample`.
- **Reconcile** the `deepColumn`(values) vs Explorer's deepColumn(stats) vs sampleColumn
  (histogram) collision (wire.ts SPIKE marker): footer stats → `ParquetFooter.columns`;
  paged values → `ColumnPage`; histogram → `ColumnSample.histogram`.
- Deliverable: a thin protocol slice + golden parity on the parquet fixture, proving the
  cache-identity redesign before the general migration depends on it.

## 4. Scheduler + cache (port into the worker)
Explorer's `readScheduler` (priority/background lanes, `PRELOAD_COOLDOWN_MS`) + the store's
`specCache` (LRU) + `loadGen` move in-worker. IV's device-aware `cacheBudgetBytes` is the
budget template. A NEW general cache layer is needed (IV caches only a derived ion-index).

## 5. Cancellation honesty (review)
No `AbortController` exists in either source. Implement: fetch-signal abort for `open` +
`archiveMemberBytes`; between-row-group cooperative abort for the streaming renders/chrom;
everything else stays `stale-drop` (requestId/selectId/gen suppression). Don't claim hard
abort where only stale-drop is wired.

## 6. Build gotcha (carried from IV, STACK.md)
`vite.config` MUST declare `worker.plugins: () => [wasm(), topLevelAwait()]` — without it the
WASM silently breaks in the production Worker bundle (works in dev only). This is a Phase-3
must-have, verified by an actual `vite build` of the app in Phase 4.

## Status
Skeleton staked (`packages/core`). Not yet implemented — the engine is built against §1's
golden gate, in §2's order, with §3 spiked first. This is the HIGH-risk long pole; expect it
to span several focused passes with PROC-01 reviews per slice.
