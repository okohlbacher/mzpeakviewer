# MAP — mzPeakIV worker → unified `@mzpeak/contracts` protocol

Read-only analysis for Phase 3 (engine migration). Maps mzPeakIV's existing Web
Worker engine onto the superset protocol in
`packages/contracts/src/{protocol.ts,wire.ts}`. **No code was changed in IV.** An
implementer codes the single `packages/core` engine from this.

Source files (all in `mzPeakIV/`):
- Worker: `src/worker/mzPeakWorker.ts` (1607 lines — the engine), `src/worker/protocol.ts` (IV wire), `src/worker/parquetFooter.ts`, `src/worker/parquetMini.ts`
- Reader boundary: `src/reader/openUrl.ts` (the ONLY `mzpeakts` import besides the worker), `src/reader/{fileMeta,stats,arrays,scanCoords,capability,errors,types}.ts`
- Imaging: `src/imaging/{grid,optical,types}.ts`
- Compute: `src/compute/{ionImage,tic}.ts`

Key naming difference up front: IV's load messages are **`loadUrl` / `loadFile`**
(two messages) and IV's success responses are **`loadResult` / `noImaging`** (two
responses). The contract unifies these into **`open` (one message, `OpenSource`
union)** and **`opened` (one response, capability-driven)**. This rename is the
single largest mechanical change.

---

## 1. Contract message → IV handler map

Contract inbound message (`protocol.ts`) → IV handler (`mzPeakWorker.ts` unless noted).
"file:line" is the dispatch `case` in IV's `self.onmessage` switch (starts line 1341).

| Contract message | IV handler (file:line) | What it does | GAP |
|---|---|---|---|
| `open` `{source:url\|file}` | `case "loadUrl"` 1355 / `case "loadFile"` 1385 → `runFastLoad` 259 | Resets module state, builds `ZipStorage` (HttpReader+RANGE_OPTS for url / `fromBlob` for file), reads only `mzpeak_index.json`, emits manifest + imaging flag, background-builds grid+TIC. | **RENAME**: contract has ONE `open` with `OpenSource` union; IV splits into `loadUrl`/`loadFile`. Contract carries `requestId`; IV's load messages have **no requestId** (load is implicitly singleton). |
| `selectSpectrum` `{index,selectId}` | `case "selectSpectrum"` 1471 → `spectrumFromCache` 852 / `readFastSpectrum` 1034 / `runSelectSpectrum` 1317 | 3-tier: in-memory ion-cache hit → row-group-skip read of `spectra_data` → full reader. Echoes `selectId`. Transfers mz+intensity buffers. | Matches well. `selectId` semantics identical. |
| `meanSpectrum` `{requestId}` | `case "meanSpectrum"` 1517 → `computeMeanSpectrum` 1135 → `_computeMeanSpectrumFrom(null)` 1156 | Samples ≤300 spectra across all row groups, bins to first spectrum's mz axis (±0.5 Da), returns mean per bin. | **GAP**: contract adds `requestId`; IV `meanSpectrum` has none. Response type differs (see §below). |
| `roiSpectrum` `{spectrumIndices,requestId}` | `case "roiSpectrum"` 1528 → `computeRoiMeanSpectrum` 1144 → `_computeMeanSpectrumFrom(Set)` 1156 | Caps to 100 indices, sorts, skips row groups outside the index min/max range via stats, bins same as mean. | **GAP**: contract adds `requestId`; IV has none. IV caps at 100 silently. |
| `renderIonImage` `{mz,tolDa,requestId}` | `case "renderIonImage"` 1406 → `computeIonImageFast` 909 (fast) / `extractXIC`+`buildIonImage` 1461 (full fallback) | Builds grid lazily if absent, then exact ion image from in-memory cache, or streamed per-row-group accumulation, or full-reader XIC. Emits `renderProgress`. Transfers buffer. | Matches well. |
| `renderMultiChannel` `{channels[],requestId}` | `case "renderMultiChannel"` 1499 → `computeMultiIonImagesFast` 963 | Single pass over `spectra_data` accumulating all channel windows at once; position-aligned null-in→null-out. | Matches well. |
| `getOpticalImage` `{archivePath,gen,preloadMaxBytes?}` | `case "getOpticalImage"` 1540 | Finds ZIP entry, size-gates (preload cap / `MAX_OPTICAL_BYTES`), decodes TIFF→RGBA (`decodeTiff`), transfers. Soft errors → `opticalImageError`/`opticalImageSkipped`. | **Near-exact match** — contract `getOpticalImage` copied IV's shape incl. `gen` + `preloadMaxBytes`. |
| `setCacheConfig` `{preloadEnabled,cacheLimitBytes}` | `case "setCacheConfig"` 1345 | Sets `cfgPreloadEnabled`/`cfgCacheLimitBytes`; if preload just enabled, kicks `maybePreloadIonIndex`. | **Exact match.** |
| `close` | — | **GAP: no IV handler.** IV resets state at the *start* of the next `loadUrl`/`loadFile` (1356-1364, 1386-1395), never on an explicit close. |
| `cancel` `{cancelId}` | — | **GAP: no IV handler.** IV has NO cancel message at all — cancellation is stale-DROP via `loadSeq`/`requestId` echo only (see §2). |
| `scanBreakdown` `{requestId}` | — | **GAP: IV has none.** IV computes `FileStats` eagerly inside `buildGridFast` (536) / `computeStats`; there is no separate time-sliced scan-breakdown pass. (Explorer-side concept.) |
| `extractChrom` `{chrom}` | — | **GAP: IV has none.** No chromatogram messages. IV builds a TIC *raster* inside `buildGridFast` (529-534) but never returns a `ChromatogramSeries`. |
| `archiveList` | — | **GAP: IV has none** (Explorer Structure tab). IV builds a `ManifestEntry[]` (`manifestFromStore` 179) but not the richer `ArchiveMemberList` with compressed sizes. |
| `parquetFooter` `{archivePath}` | — | **GAP: no message.** IV *has the machinery* (`src/worker/parquetFooter.ts` `readParquetFooter`/`decodeFooter`, a hand-rolled Thrift compact decoder) but uses it INTERNALLY for fast grid build (404-406), never as a message handler. **Reusable for the contract handler.** |
| `deepColumn` / `sampleColumn` | — | **GAP: IV has none** (Explorer paged column reads). |
| `archiveMemberBytes` `{maxBytes}` | — | **GAP: IV has none.** Closest IV code is the `getOpticalImage` entry read (1569 `entry.getData(Uint8ArrayWriter)`). |
| `studyMeta` | — | **GAP: IV has none** (Explorer SDRF/ISA). |

### Outbound response naming gaps
| Contract response | IV equivalent | Note |
|---|---|---|
| `opened` (unified) | `loadResult` (imaging) + `noImaging` (LC) | **Must merge into one.** Contract `opened` carries `capabilities: CapabilityModel`, `grid`, `tic`, `opticalImages`, `fileSize`, `mixedRepresentationWarning` — IV splits imaging vs non-imaging into two response types and emits `loadResult` **multiple times** (fast → background grid → full reader) as a progressive-fill pattern. |
| `spectrumResult` | `spectrumResult` | match (incl. `selectId`). |
| `meanSpectrumResult` `{requestId}` | `meanSpectrumResult` (no requestId) | IV reuses `meanSpectrumResult` for BOTH mean and ROI; contract keeps that but adds `requestId`. |
| `renderResult` `{requestId}` | `renderResult` `{requestId}` | match. |
| `multiChannelResult` | `multiChannelResult` | match. |
| `renderProgress` / `ionIndexPreloading` / `ionIndexPreloadAborted` / `ionIndexReady` | same names | **contract copied these verbatim from IV.** |
| `opticalImageResult/Error/Skipped` | same | match. |
| `ready` / `progress` | same | match (note `LoadStage` enum differs slightly — see §risks). |
| `cancelled` `{cancelId}` | — | **GAP: IV never emits.** |
| `scanBreakdownResult` / `chromResult` / `archiveListResult` / `parquetFooterResult` / `deepColumnResult` / `sampleColumnResult` / `archiveMemberBytesResult` / `studyMetaResult` | — | **GAP: all Explorer-side, IV emits none.** |
| `error` `{requestId?,class,findings?}` | `error` `{class,findings?}` | **GAP**: IV's `error` has **no `requestId`** (`postError` 145) and IV's `class` values are `"unsupported-encoding"`/`"network"`/`"corrupt"` — contract `ReaderErrorClass` is `network\|cors\|not-found\|parse\|unsupported\|format\|internal`. **Error-class vocabulary must be remapped.** |

---

## 2. IV worker lifecycle

**WASM/reader init.** `mzpeakts` + `parquet-wasm` import at top of module (12-23).
`vite-plugin-top-level-await` wraps module init around the WASM top-level await; the
`self.onmessage = …` assignment (1341) and the final `send({type:"ready"})` (1606)
both run *after* WASM is ready. The `ready` handshake exists specifically so the main
thread buffers `open` until `onmessage` is provably registered (race fix, 1598-1606).
**Carry this verbatim — it is load-bearing for fast programmatic loads.**

**Module-global state (66-117).** Single-open-file model, all module-scope, never
crosses to main thread:
- `activeZipStorage` — the ZIP handle (fast path; reads `mzpeak_index.json`).
- `activeSourceUrl` — url for spinning up INDEPENDENT readers (own HTTP connection each) for parallel row-group reads; `null` for local.
- `activeReader` — full `MzPeakReader` (lazy; only built on demand).
- `activeStats`, `activeGrid` — derived state.
- `activeIonCache` `{mz:Float64,pix:Uint16|Int32,inten:Float32}` + `activeIonCacheSiToPix:Map` — the in-memory exact ion index (§4).
- `ionCacheTooBig`, `ionCacheBuildPromise` (single-flight), `cfgPreloadEnabled`, `cfgCacheLimitBytes`.
- `loadSeq` (== generation counter) — bumped each `runFastLoad`.

**Single-open-file model.** No `close`. Each `loadUrl`/`loadFile` (1356/1386)
**imperatively nulls every module global** before opening the next file ("Pitfall 5
— never reinitialize inside onmessage" applies to NOT reinitializing per-request, but
load DOES reset). Phase 3 must add an explicit `close` that runs the same reset.

**Load pipeline stages (progressive fill).** `runFastLoad` 259:
1. `manifestFromStore` (179) — manifest from `ZipStorage.fileIndex` (no Parquet read).
2. emits `progress("manifest")` → `progress("metadata")` with `yieldFrame()` (128) between, so the UI sees staged ticks.
3. **non-imaging branch** (284): emit `noImaging` immediately with nulls, then a fire-and-forget full-reader init fills `fileMeta`+`stats`+caps and emits `noImaging` again (MERGE on main thread).
4. **imaging branch** (320): parse optical metadata (cheap), emit `loadResult` (grid/tic null), then background `buildGridFast` (374) → second `loadResult` with grid+TIC+stats (transfers tic.buffer) → `maybePreloadIonIndex`.
5. Full `MzPeakReader` (`initReaderAndGrid` 569) is only ever built lazily — on first `renderIonImage`/`selectSpectrum` whose fast path fails, or for non-imaging metadata.

So `opened`-equivalent is emitted **2–3 times per load** (fast, then enriched). The
contract's single `opened` response either needs the same progressive-fill habit
(emit `opened` then patch via follow-up messages) or a redesign where `opened` is
final and intermediate state rides on `progress`.

**Cancellation = stale-DROP, confirmed.** There is **no `AbortController`, no hard
abort** anywhere in IV. Two stale-drop mechanisms:
- **`loadSeq` (generation)** — captured as `mySeq` at start of async work (260, 750, 816, 838); background grid / ion-cache build / preload all check `if (mySeq !== loadSeq) return` and silently drop, so a superseded file's slow background work can't bleed into the freshly opened file.
- **`requestId` / `selectId` echo** — render and spectrum responses echo the id; the MAIN THREAD discards stale ones. The worker still runs the work to completion.

This exactly matches `MESSAGE_POLICY` `cancellation:"stale-drop"`. **IV satisfies
NONE of the `cancellation:"abort"` entries** the contract declares (`open`,
`extractChrom`, `deepColumn`, `archiveMemberBytes`, `renderIonImage`,
`renderMultiChannel`). The contract's own doc-comment (protocol.ts 156-169) already
admits this: "neither mzpeakts path threads an AbortSignal". **Phase 3 must either
wire AbortControllers for those ops or honestly downgrade their policy labels to
`stale-drop`.** Today they would be stale-drop.

---

## 3. Imaging compute owned by the IV worker

| Compute | Where | IO / cost shape |
|---|---|---|
| **Fast grid + TIC** | `buildGridFast` 374; uses `src/worker/parquetFooter.ts` (`readParquetFooter`/`decodeFooter`) + `src/worker/parquetMini.ts` (`buildMiniParquet`) | Range-reads ONLY 5 leaf column chunks of `spectra_metadata` (`scan.IMS_1000050/51_position_x/y`, TIC, hi/lo mz) ≈ **650 KB total** instead of the ~553 MB full metadata file. Decodes a hand-built mini-Parquet via `readParquet`. Builds `ImagingGrid` (`buildImagingGrid`, `src/imaging/grid.ts`) + TIC raster. Reads `scan.source_index` separately to map scan-row→spectrum-index (NOT row-order safe). |
| **Full grid (fallback)** | `initReaderAndGrid` 569 → `extractCoords`+`readGridGeometry` (`src/reader/scanCoords.ts`) + `buildImagingGrid` | Reads full `spectra_metadata.parquet` via `MzPeakReader.fromStore` — the slow (~553 MB) path. Only when fast path fails. |
| **Ion image (exact, cached)** | `ionImageFromCache` 878 | Pure in-memory scan over `activeIonCache` arrays; sums intensity onto `pix[i]`. No IO. Any window, exact, no binning. |
| **Ion image (streamed fallback)** | `computeIonImageFast` 909 (cache-miss branch) → `forEachSpectraRowGroup` 663 | Streams every row group of `spectra_data.parquet` (small: ~208 KB compressed, ~39 row groups), striped across `RG_CONCURRENCY` (default 8) INDEPENDENT ParquetFile handles for network parallelism. Sparse `Map<si,sum>` accumulator. Emits `renderProgress` per group. |
| **Multi-channel** | `multiIonImagesFromCache` 890 (cached) / `computeMultiIonImagesFast` 963 (streamed) | One pass, all channels accumulated together (avoids 3× reads). |
| **Mean spectrum** | `_computeMeanSpectrumFrom(null)` 1156 | Reads `spectra_data` row groups, samples ≤300 spectra, builds reference mz axis from first spectrum, binary-search bins ±0.5 Da. |
| **ROI mean** | `_computeMeanSpectrumFrom(Set)` 1156 | Same, but ≤100 indices, **skips row groups outside the ROI index min/max** via row-group statistics (1177). |
| **Per-pixel spectrum** | `spectrumFromCache` 852 / `readFastSpectrum` 1034 | Cache hit (no IO), else row-group-skip read of `spectra_data` using spectrum_index min/max stats (~12 MB one group vs 553 MB), else full reader. |
| **Optical decode** | `case "getOpticalImage"` 1540 + `src/imaging/optical.ts` (`decodeTiff`, `parseOpticalImages`, `MAX_OPTICAL_BYTES`) | Lazy: reads one TIFF ZIP member, size-gated, decodes via `utif2` to RGBA, transfers. Metadata parsed eagerly at load (cheap). |
| **Grid build** | `src/imaging/grid.ts` `buildImagingGrid` | Sparse `Map<gridKey,spectrumIndex>` + dense `Uint8Array` presenceMask. **Wire form differs** — see §risks (contract `ImagingGridWire` flattens the Map to parallel typed arrays). |

**IO summary:** IV streams row groups for the small `spectra_data` file and uses
**parquet-level range reads + a mini-Parquet trick** to avoid the giant metadata
file. It caches an exact in-memory point index (§4), NOT a column/row-group LRU.

---

## 4. Cache / preload model

IV's cache is **one thing**: an in-memory EXACT ion-image point index, built by a
single full streaming pass over `spectra_data.parquet`.

- **What it caches** (`activeIonCache`, 90-97): three parallel typed arrays — `mz`
  (Float64, exact), `pix` (Uint16 if grid ≤65 535 cells else Int32), `inten`
  (Float32) — one entry per on-grid point. Plus `activeIonCacheSiToPix:Map<si,pix>`
  so per-pixel spectra are served from the same index.
- **Build** `buildIonCacheInner` 747: sizes from Parquet metadata FIRST (cheap row
  count, no data read) so an over-budget file never allocates. Single-flighted
  (`ionCacheBuildPromise` 728). Guarded by `loadSeq`. Emits
  `ionIndexPreloading`→`ionIndexReady`(points) or `ionIndexPreloadAborted`.
- **Budget** `cacheBudgetBytes` 714: explicit user limit (`cfgCacheLimitBytes`,
  bounded by `ABS_MAX_CACHE_BYTES` = 4 GB) wins; else `min(MAX_CACHE_BYTES=900 MB,
  20% of navigator.deviceMemory)`. Per point ≈ 14 B → ~64M points at 900 MB.
  Over-budget → `ionCacheTooBig=true`, fall back to per-render streaming
  (correctness identical, just slower).
- **Preload** `maybePreloadIonIndex` 838: after the TIC overview is up, proactively
  builds the index in the background IF `cfgPreloadEnabled` and it fits budget, so
  the first pixel-click / ion-image is instant.
- **Config** `setCacheConfig` 1345 sets `cfgPreloadEnabled` / `cfgCacheLimitBytes`
  (0 = auto/device-aware); turning preload on mid-session kicks a build.

This is **NOT** the roadmap's "LRU cache storage in-worker" (PHASE.md line 6). IV
caches a *derived point index*, not parquet row groups / columns. The contract's
`setCacheConfig` `{preloadEnabled, cacheLimitBytes}` maps 1:1 onto IV's config, but
the *thing being cached* is imaging-specific and won't serve Explorer's column/
footer reads — see §risks.

---

## 5. Risks of reusing IV's worker as the Phase-3 base

1. **It's an imaging engine, not a general data engine.** Every cache, the fast
   grid build, the mini-Parquet trick, the ion-index — all imaging-specific. The
   superset's Explorer half (`archiveList`, `parquetFooter`, `deepColumn`,
   `sampleColumn`, `extractChrom`, `scanBreakdown`, `studyMeta`,
   `archiveMemberBytes`) has **zero** IV implementation. IV is the right base for
   ~9 imaging messages and the worker lifecycle; ~8 Explorer messages are net-new.

2. **`open`/`opened` unification.** Merge `loadUrl`+`loadFile`→`open(OpenSource)` and
   `loadResult`+`noImaging`→`opened(CapabilityModel)`. IV emits the load response
   **2–3 times per load** (progressive fill). The contract's single `opened` must
   either keep that progressive habit or move intermediate state onto `progress`.
   Add `requestId` to `open` (IV load has none) and echo it on `opened`.

3. **Cancellation honesty.** IV is **pure stale-drop** (`loadSeq` + id-echo); there
   is no `AbortController`, no `cancel` handler, and it never emits `cancelled`.
   Six contract messages are declared `cancellation:"abort"`. Phase 3 must either
   (a) wire AbortControllers into the fetch/range-read path (real work — mzpeakts
   doesn't thread `AbortSignal`), or (b) relabel those `MESSAGE_POLICY` entries to
   `stale-drop` to match reality. Also add the `cancel`/`cancelled` round-trip.

4. **`CapabilityModel` shape gap.** IV's `Capabilities`
   (`{layout, encodings, isImaging, unsupported}`) is far thinner than the
   contract's `CapabilityModel` (`ImagingDetection` 3-signal probe,
   `ChromatogramCapability`, optical capability, tri-state `Presence`). IV's
   `computeCapabilities` (`src/reader/stats.ts`) + `probeIsImaging` must be
   extended to populate the full model. Imaging detection: contract standardizes on
   IV's 3-signal `probeIsImaging` (good — IV owns this), but the fields must be
   reshaped into `ImagingDetection`/`signals`.

5. **`ImagingGrid` wire mismatch.** IV passes the full `ImagingGrid` (a
   `Map<number,number>` + `Uint8Array`) by structured clone. Contract
   `ImagingGridWire` (wire.ts 58-69) flattens to parallel `Int32Array`
   (`coordKey`/`spectrumIndex`) + `presenceMask` + `originX/Y`, all transferable.
   Engine must serialize `ImagingGrid` → `ImagingGridWire` at the boundary (and the
   shell rebuilds a lookup). IV's grid key is `y0*width+x0` 0-based; wire `originX/Y`
   are the 1-based IMS minimums — keep the offset convention consistent.

6. **Error contract gap.** `postError` (145) emits no `requestId` and uses class
   strings `"unsupported-encoding"`/`"network"`/`"corrupt"`. Contract
   `ReaderErrorClass` = `network|cors|not-found|parse|unsupported|format|internal`
   and `error` carries optional `requestId`. Remap the vocabulary and thread
   `requestId` through so a failed render/read rejects the right pending promise.

7. **`LoadStage` enum drift.** IV `LoadStage`
   (`idle|zip-index|manifest|metadata|grid|tic|ready|no-imaging|error`,
   `reader/types.ts`) vs contract `LoadStage`
   (`fetching|unzipping|manifest|metadata|grid|tic|done`, wire.ts 140). Reconcile.

8. **No real LRU cache (PHASE.md asks for one).** IV caches a derived ion index, not
   row groups/columns. Serving Explorer's repeated footer/column reads efficiently
   needs a *new* cache layer; IV's budget model (`cacheBudgetBytes`) is a good
   template for the byte budget but not the storage.

9. **`mzpeakts` import boundary.** Two files import `mzpeakts`: `reader/openUrl.ts`
   and `mzPeakWorker.ts` (`ZipStorage`). In `packages/core` keep this discipline —
   all `mzpeakts`/`parquet-wasm`/`apache-arrow` imports inside the worker module
   only; the contract types must stay vendor-free (wire.ts already is).

10. **Parallel independent readers assume a throttled CDN.** `RG_CONCURRENCY`
    (default 8) opens N independent `ZipStorage`+`HttpReader` handles to parallelize
    range reads (`openIndependentSpectraParquet` 214). This is a perf optimization
    keyed to per-connection throttling; safe to keep, but note it multiplies open
    HTTP connections and re-inits ZipStorage per handle.

11. **Mini-Parquet / Thrift decoder is bespoke.** `parquetFooter.ts` (hand-rolled
    Thrift compact decoder) + `parquetMini.ts` are IV-authored, fragile against
    format drift, but **reusable** for the contract's `parquetFooter` message — a
    real asset for the Explorer-side rewrite rather than a liability.
