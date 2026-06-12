# MAP — Explorer data access → unified worker protocol

Phase 3 (engine migration) reference. **Read-only analysis** of mzPeakExplorer's
main-thread data layer mapped onto `@mzpeak/contracts` (`protocol.ts` / `wire.ts`).
Explorer has **NO worker today**: every function below runs on the main thread,
holds a live `Reader` (an mzpeakts `MzPeakReader` full of Arrow tables + WASM
handles), and returns Arrow-derived JS. Phase 3 must move all of it behind the
single worker in `packages/core`.

Anchor finding: IV's worker (`mzPeakIV/src/worker/mzPeakWorker.ts`) ALREADY holds
a live `ZipStorage` and calls `store.open()` / `store.entries` / `store.fileIndex`
inside the worker (lines 217, 259, 1377, 1546-1550). That proves the `reader.store`
handle Explorer reaches into can live worker-side — it is the migration foundation
for §2.

---

## 1. Contract message → Explorer implementation

All paths are `mzPeakExplorer/src/...`. "Today" = main-thread, synchronous reader
access. GAP = mismatch vs the wire type the worker must return.

| Contract message | Explorer fn (file:line) | What it does today | Today's return | GAP vs wire |
|---|---|---|---|---|
| `open` | `state/store.ts:644` `load()` → `reader/open.ts:39 openUrl` / `:28 openBlob` | `MzPeakReader.fromStore(ZipStorage(HttpReader))` (forced range reads) or `.fromBlob`; `warm()` triggers `spectrumData()`. Then fast: `manifest()`, `computeFastSummary()`, `fileMeta()`, `indexMetadata()`, `chromatogramIds()` | Stores `reader` in a **module var** (`store.ts:32`), sets `summary/fileMeta/manifest/indexMeta/storedChromIds` | `opened` wants `CapabilityModel` + `ImagingGridWire` + `tic: Float32Array` + `OpticalImageMeta[]`. Explorer has **no grid**, no TIC-on-open (lazy), no capability model. Imaging detection is 1-signal (`readImaging`) vs contract's 3-signal probe. `fileMeta.dataProcessing` exists in Explorer (`meta.ts:15`) but is dropped from wire `FileMeta`. |
| `scanBreakdown` | `reader/summary.ts:102 scanSpectra` (driven by `store.ts:746 runScan`) | Time-sliced (`SLICE_MS=12`) single pass over Arrow struct columns (`scanByColumns`): msLevelCounts, repr counts, mz/rt range, **Browse index rows** | `ScanResult { rows: SpectrumIndexRow[], aggregates }` | Wire `FileStats` has the aggregates but **NOT** `rows[]`. The per-spectrum Browse index (`SpectrumIndexRow[]`: id/msLevel/time/tic per spectrum) has **no wire carrier** — it is large and needs its own paged/transferred message OR must be folded into `scanBreakdownResult`. This is a real gap (see RISKS). |
| `selectSpectrum` | `reader/browse.ts:94 getSpectrumArrays` + `:57 getSpectrumMetadata` (via `store.ts:365`) | `reader.getSpectrum(i)` → reconstruct mz(f64)/intensity(f32), `sanitizePairs` (finite+ascending). Metadata via `sm.get(i)` + `plainify` | `SpectrumArrays {index,id,msLevel,representation,time,mz,intensity}` + separate plainified meta | Wire `SpectrumArrays` = `{index,id,mz,intensity}` only — **drops msLevel/representation/time** and the plainified metadata tree. `selectId` ordering token does not exist today (store uses `loadGen` + "still selected" check, `store.ts:387`). |
| `extractChrom` | `reader/browse.ts:152 extractChromatogram` (+ `store.ts:888 buildTic`, `:870 cheapTic`) | `reader.extractXIC(tRange,mzRange,useProfile)`, sums intensity per point, RT post-filter. TIC has a **cheap metadata-only path** (promoted TIC column) preferred over summing | `ChromPoint[]` (`{index,time,intensity}` objects) | Wire `ChromatogramSeries` = parallel `Float32Array time/intensity` (transferable). Today returns an **array of objects** → must be repacked into typed arrays. `ChromRequest.mode:"stored"` maps to `getStoredChromatogram` (`browse.ts:199`); `"tic"` to the cheap/`buildTic` path; `"xicRange"` (mzLo/mzHi) has **no exact Explorer equivalent** (Explorer only does mz±tol). |
| `archiveList` | `reader/archive.ts:48 listArchive` (via `store.ts:923 getArchiveListing`) | Reads `reader.store.entries` (raw zip entries), classifies kind, sums sizes. **Synchronous** | `ArchiveListing {entries[], totalCompressed, totalUncompressed}` with `kind`, `isDirectory`, `compressed/uncompressedSize` | Wire `ArchiveMemberList.members` = `{path,bytes,compressedBytes,isParquet}` — **drops `kind` and `isDirectory`** and the totals. The Structure tab UI needs `kind`; either extend the wire type or recompute kind shell-side from path. |
| `parquetFooter` | `reader/archive.ts:239 readParquetInfo` (via `store.ts:937 getParquetInfo`) | `openParquet()` resolves a **live parquet-wasm handle** via name-matched `store[accessor]()`; reads `handle.metadata()` (rowGroup/column footprints) + Arrow types from decoded vectors or IPC schema | `ParquetInfo {numRows,numColumns,numRowGroups,columns[],createdBy,...}` | Wire `ParquetFooter.columns` = `{name,type,logicalType}` — **drops per-column compressed/uncompressed bytes, numValues, compression codec, createdBy**. Structure tab shows all of those today → wire type is too thin. **HARD PART §2.** |
| `deepColumn` | `reader/parquetDeep.ts:105 deepColumn` (via `store.ts:943 getDeepColumn`) | `metadataFor()` (hyparquet `parquetMetadataAsync` on a `reader.store`-backed AsyncBuffer, cached in a `WeakMap<Reader,...>`); aggregates Thrift stats (encodings, pages, min/max/null/distinct) | `DeepColumn` (footer-stats object) | Contract `deepColumn` is a **paged column-VALUE read** (`offset/limit` → `ColumnPage`), but Explorer's `deepColumn` returns **footer STATISTICS**, not values. The value-sampling equivalent is `sampleColumnNumbers` (below). **The contract conflates two Explorer operations** — see RISKS. **HARD PART §2.** |
| `sampleColumn` | `reader/parquetDeep.ts:184 sampleColumnNumbers` (via `store.ts:949 sampleColumn`) | hyparquet `parquetReadObjects` over first `limit` rows of ONE column (dynamic `hyparquet` + `hyparquet-compressors` import); returns numeric values or null (non-numeric/list) | `number[] | null` | Wire `ColumnSample.preview = string[]` + `totalRows`. Explorer returns `number[]` (for a histogram), not stringified preview. Type/intent mismatch — histogram sampling vs preview. **HARD PART §2.** |
| `archiveMemberBytes` | `reader/archive.ts:80 readArchiveMember` (via `store.ts:930 getArchiveMemberBytes`) | `reader.store.open(name)` → `blob.bytes()`, size-capped, returns bytes + UTF-8 text | `{bytes: Uint8Array, text: string} | null`; store wrapper caps at **256 MB** | Wire `archiveMemberBytesResult.bytes` is an **ArrayBuffer TRANSFERRED**, with `truncated` flag. Today the `Uint8Array` is **cloned** through React state and TextDecoded eagerly. §4. |
| `studyMeta` | `reader/sampleMeta.ts:readStudyMetadata` (async, `store.ts:685`) | Locates SDRF/ISA member, reads+SHA-256 hashes it, parses (sdrf/isa-tab/isa-json), reconciles with index keys | `StudyMetadata { ...labeling, provenance{member,...} } | null` | Wire `StudyMeta = {sdrf?,isa?,present}` (opaque). Explorer's rich `StudyMetadata` (channel assignments, plex, provenance) collapses to `unknown`. `getStudyBlob` (`store.ts:599`) re-reads the raw member → maps to `archiveMemberBytes`, not `studyMeta`. |

Messages with **no Explorer equivalent** (IV-only, already in IV's worker):
`meanSpectrum`, `roiSpectrum`, `renderIonImage`, `renderMultiChannel`,
`getOpticalImage`, `setCacheConfig`, `cancel`, `ionIndex*`. These come from IV;
Explorer contributes nothing and Phase 3 keeps IV's implementations.

---

## 2. THE HARD PART — Structure/Parquet path (the spike target)

This is a **redesign of cache identity**, not a thin call surface. Four
intertwined mechanisms in `archive.ts` + `parquetDeep.ts` all assume a live,
main-thread `Reader` whose internals are reachable by reference.

### 2a. `reader.store` reach-through (untyped escape hatches)
Every Structure function casts the opaque `Reader` to expose `.store`:
- `archive.ts:49` `(reader as { store?: { entries?: RawZipEntry[] } }).store` — raw zip entry list.
- `archive.ts:85` `store.open(name)` → `{ size, bytes() }` RemoteBlob — member bytes.
- `archive.ts:213` `store as ParquetStore` — a record of **lazy accessors**
  (`spectrumMetadata()`, `spectrumData()`, `chromatogramData()`, ...) each
  returning a **live parquet-wasm `ParquetHandle`**.
- `parquetDeep.ts:53` `store.open(filename)` adapted to a hyparquet `AsyncBuffer`
  whose `slice(start,end)` does **HTTP range reads** through zip.js.

**What breaks across the worker boundary:** none of `entries`, the RemoteBlob,
the `ParquetHandle`, or the AsyncBuffer can be `postMessage`d — they carry
methods, closures, and WASM-backed memory. **All of this must run INSIDE the
worker** against the worker-resident `ZipStorage`. IV already proves this works
(`mzPeakWorker.ts:1546` reads `store.entries`; `:225` calls `store.open(name)`).

### 2b. Live parquet-wasm handle + Arrow vector type inspection
`readParquetInfo` (`archive.ts:239`) builds the column table from TWO live
sources that cannot cross the boundary:
1. `handle.metadata()` → `fileMetadata()/numRowGroups()/rowGroup(i).columns()`
   with method-bearing `ColumnChunk` objects (`columnPath()`, `compressedSize()`,
   `compression()` returning a parquet-wasm enum, decoded by `codecName` against
   a hardcoded enum order, `archive.ts:41`).
2. Arrow **logical types read off already-decoded struct vectors**
   (`columnTypes`, `archive.ts:156`): it pokes `reader.spectrumMetadata.spectra`,
   `.scans`, `.precursors`, `.selectedIons` (live Arrow `StructVector`s) and walks
   `vec.type.children` (`walkField`/`walkStruct`). Fallback `ipcColumnTypes`
   (`archive.ts:189`) calls `tableFromIPC(handle.schema().intoIPCStream())` — and
   **deliberately fails on LargeList** (chunked layout), leaving types empty.

**What breaks:** Arrow `StructVector`s, the IPC stream object, and the parquet
enum are all worker-only. The **type-walking logic must move whole into the
worker**; only the resulting `{name,type,logicalType}[]` (plus the dropped
byte/codec stats — see §1 GAP) crosses as plain JSON. The LargeList fragility and
the parquet-wasm-enum-order coupling (`CODECS`, `archive.ts:41`) travel with it.

### 2c. The `WeakMap<Reader, Map<filename, Promise<FileMetaData>>>` footer cache
`parquetDeep.ts:64 metaCache` keys the hyparquet footer cache **by the Reader
object identity**. New file → new Reader → WeakMap auto-invalidates (no explicit
clear). This is the **cache-identity redesign**: post-worker there is no
cross-boundary Reader to key on. Worker-side, the cache must be **re-keyed by load
generation** (mirror `loadGen`, `store.ts:36`) or by archivePath, and explicitly
cleared on `open`/`close`. The WeakMap-by-Reader trick does not survive the move;
a `Map<archivePath, Promise<footer>>` reset on each `open` replaces it.

### 2d. Dynamic hyparquet / hyparquet-compressors imports
`parquetDeep.ts:77` `import("hyparquet")`, `:195` `import("hyparquet")` +
`:196 import("hyparquet-compressors")`. These are a SECOND parquet stack
(pure-JS) alongside mzpeakts' parquet-wasm, loaded lazily so the zstd/snappy
codecs only download when a deep panel opens. **What breaks:** nothing functional
— dynamic import works in a worker — BUT Phase 3 must ensure the worker bundle's
code-splitting still lazy-loads them (Vite worker chunking), or the ~lazy cost
becomes an eager worker-init cost. Keep the dynamic `import()` inside the worker.

**Spike deliverable:** stand up `deepColumn` + `parquetFooter` + `sampleColumn`
end-to-end inside the worker against a chunked-layout (LargeList) fixture, proving
(a) the worker-resident `ZipStorage` serves both parquet-wasm handles AND hyparquet
AsyncBuffers, (b) the footer cache re-keys on generation, (c) Arrow type-walking
produces the same column types main-thread Explorer does, and (d) the wire types
are widened to carry the per-column byte/codec stats the UI needs.

---

## 3. Scheduler + cache → move into the worker

### `readScheduler.ts` (two-lane serial scheduler)
- Module-global `highLane`/`lowLane` arrays + single `draining` flag enforce
  **one read at a time** (reader not reentrant, `:50 drain`).
- `priorityRead` (user) always dequeues ahead of `backgroundRead` (preloader).
- `userReadsActive` counter + `lastUserReadAt` + `PRELOAD_COOLDOWN_MS = 350`
  drive `userIsActive()` — the preloader polls it and pauses during navigation
  bursts (`store.ts:831`).
- **Explicitly NO AbortSignal**: comment (`readScheduler.ts:17`) — a read in
  flight cannot be preempted; a user read waits for at most one in-flight
  background read (one row-group fetch).

**Move:** this entire module becomes **worker-internal**. The two lanes map to
the contract's cancellation modes: `priorityRead` ops are user-driven
(`selectSpectrum` = `stale-drop`, render/chrom = `abort`); `backgroundRead` is the
preloader. **The contract's `cancel` message is strictly stronger than today** —
`MESSAGE_POLICY` (`protocol.ts:191`) marks `extractChrom`/`renderIonImage`/
`deepColumn`/`archiveMemberBytes`/`open` as `"abort"`, but Explorer has **no
abort wiring at all**. Honest path: keep the lane scheduler as-is, label those ops
`stale-drop` until an AbortController is actually threaded into the fetch (the
contract's own caveat, `protocol.ts:160`). The `userIsActive`/cooldown logic stays
worker-internal and is **not** exposed on the wire.

### Store cache + `loadGen` (`store.ts`)
- `specCache: Map<number, SpectrumArrays>` (`:48`) = **insertion-order LRU** keyed
  by spectrum index; `specCacheBytes` budget; `evictToBudget` (`:122`) drops
  oldest keeping ≥1. Budget = `cacheBudgetBytes` (device-memory-scaled,
  URL/sessionStorage-presettable, `:59 defaultCacheMB`).
- `inflightSpectra: Map<number, Promise>` (`:155`) coalesces duplicate reads of
  the same index (preloader + user racing).
- `loadGen` (`:36`) monotonic counter — every async path re-checks
  `gen !== loadGen` after each await and **bails** if a newer file loaded
  (`:371, :384, :479, :766, :810, :826, :840`). This is exactly the contract's
  `stale-drop` / generation model and IV's `gen` echo.
- `preloadInBackground` (`:798`) + `preloadGen` (`:104`) + `remoteSource` (`:109`,
  remote files skip auto-preload) + `scanInFlight` dedupe (`:41`).

**Move:** `specCache`, `inflightSpectra`, `loadGen`, `preloadGen`, `remoteSource`,
`scanInFlight`, and `preloadInBackground` ALL become **worker state**. The cache
stays **worker-side** (decoded arrays never re-cross the boundary on a cache hit —
that's the whole point of transfer). `loadGen` is reborn as the worker's
generation, echoed in `opened`/`spectrumResult.selectId`/`getOpticalImage.gen`.
`setSettings` (cacheMB/preload) maps to the `setCacheConfig` message
(`protocol.ts:64`). **Subtlety:** today a cache hit returns the SAME object by
reference (`store.ts:376`); post-worker a transferred buffer is **moved** (caller
loses it), so the worker cache must either keep a copy or re-read — the
transfer-vs-cache tension is a Phase-3 design point.

---

## 4. `archiveMemberBytes` — transfer, not clone

Today (`archive.ts:80 readArchiveMember`): `reader.store.open(name)` → check
`blob.size > maxBytes` (throws) → `blob.bytes()` (a `Uint8Array`) → also
**eagerly `TextDecoder.decode`s** the whole thing to `text`. Store wrapper
(`store.ts:930 getArchiveMemberBytes`) caps at **256 MB** (matches contract's
`MAX_MEMBER_BYTES`, `protocol.ts:189`). The bytes then flow through React/zustand
state — a **structured clone** of up to 256 MB.

**Make it transfer-not-clone:**
- Worker reads the member, returns `archiveMemberBytesResult` with `bytes:
  ArrayBuffer` in the **postMessage transfer list** (`protocol.ts:132`,
  `MESSAGE_POLICY.archiveMemberBytes.transfersResult=true`). The worker loses its
  copy after transfer — fine, it's a one-shot download/view.
- **Drop the eager `text` decode** from the wire: send raw bytes, let the shell
  TextDecode only when it actually needs text (e.g. study-blob "View raw"). This
  removes a full-buffer string allocation from the hot path.
- Enforce the 256 MB cap **inside the worker** and set `truncated: true` rather
  than throwing (contract has a `truncated` flag; Explorer throws today). Behavior
  change: cap → truncate instead of error.
- `getStudyBlob` (`store.ts:599`) becomes an `archiveMemberBytes` call on the
  study member path; shell decodes to text.

---

## 5. Risks + recommended migration order

### Risks
1. **Browse index has no wire carrier (HIGH).** `scanSpectra` produces
   `SpectrumIndexRow[]` (id/msLevel/time/tic for *every* spectrum) that the whole
   Browse/MS-filter/cheap-TIC/`selectByScanNumber`/`selectByTime` machinery
   depends on (`store.ts:412,460,589,870`). `FileStats` carries only aggregates.
   Phase 3 must add a paged/transferred index message or extend
   `scanBreakdownResult`. Without it, Browse navigation breaks.
2. **`deepColumn` semantic collision (HIGH).** Contract `deepColumn` = paged
   column *values*; Explorer `deepColumn` = footer *statistics*, and
   `sampleColumn` = histogram *numbers* (`number[]`), not `preview: string[]`.
   The three don't line up. Resolve the mapping BEFORE coding (the spike must
   decide: rename Explorer's stat read to `parquetColumnStats`, or widen
   `ParquetFooter`/add a stats message).
3. **`ParquetFooter`/`ArchiveMemberList` wire types too thin (MED).** They drop
   per-column bytes/codec/numValues and member kind/isDirectory the Structure UI
   renders. Widen the wire types or recompute shell-side.
4. **No abort wiring exists (MED).** `MESSAGE_POLICY` promises `"abort"` for 5 ops
   Explorer cannot abort. Keep them `stale-drop` until an AbortController is
   genuinely threaded into zip.js fetches; don't claim a hard stop you don't have.
5. **Footer cache re-keying (MED).** The `WeakMap<Reader>` auto-invalidation
   (`parquetDeep.ts:64`) is gone post-worker; a generation-keyed `Map` that is
   explicitly cleared on `open` must replace it, or stale footers leak across files.
6. **Transfer-vs-cache for spectra (MED).** A worker-side LRU cache + a transfer
   protocol conflict (transfer moves the buffer out of the cache). Decide: copy on
   send, or cache-as-source-of-truth and re-slice.
7. **Two parquet stacks in the worker bundle (LOW).** hyparquet(+compressors) must
   stay lazy-`import()`ed inside the worker; verify Vite worker code-splitting
   keeps them out of the worker's initial chunk.

### Recommended order (easy/safe → spike)
1. **`archiveList`** — synchronous, reads `store.entries`; IV already does this
   worker-side. Pure data reshape. *(safe)*
2. **`archiveMemberBytes`** — small, well-bounded; switch clone→transfer + cap→
   truncate. IV already reads member bytes in-worker (`mzPeakWorker.ts:225`). *(safe)*
3. **`selectSpectrum` + spectrum cache** — reuse IV's worker `getSpectrum` path;
   port `specCache`/`inflightSpectra`/`loadGen` as worker state. *(medium)*
4. **`extractChrom`** (TIC/XIC/stored) — port `extractChromatogram` + cheap-TIC;
   repack objects→typed arrays. Needs the scan first for profile/centroid routing. *(medium)*
5. **`scanBreakdown` + Browse-index message** — port `scanSpectra`; FIRST resolve
   Risk 1 (index wire carrier). The two-lane scheduler + preloader move here. *(medium-hard)*
6. **`parquetFooter`** — port `readParquetInfo`: live parquet-wasm handle +
   Arrow-vector type walking, widen the wire type (Risk 3). *(hard — §2b)*
7. **`deepColumn` / `sampleColumn`** — THE SPIKE: hyparquet AsyncBuffer over the
   worker `ZipStorage`, generation-keyed footer cache, resolve the semantic
   collision (Risk 2), validate against a LargeList/chunked fixture. *(hard — §2)*
8. **`studyMeta`** — port the SDRF/ISA orchestrator last (rich, but isolated and
   already async; depends on `archiveMemberBytes` being in place). *(medium)*

Do 1–4 to get the critical round-trip (open → spectrum → chromatogram) green
behind the worker, THEN spike 6–7 (the Structure/Parquet redesign) before
committing wire-type changes.
