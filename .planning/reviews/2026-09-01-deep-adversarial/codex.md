Reviewed HEAD `8f697aa`, `v0.8.8..HEAD`, and the vendored mzpeakts change `73ac172..30ddb8e`. I found 11 P0 and 11 P1 issues.

## Ranked findings

1. **P0 correctness — XIC m/z-window slicing is fundamentally broken.**  
   [utils.ts:111–170](/Users/kohlbach/Claude/mzPeakViewer/vendor/mzpeakts/lib/src/utils.ts:111), consumed by [data.ts:1246–1258](/Users/kohlbach/Claude/mzPeakViewer/vendor/mzpeakts/lib/src/data.ts:1246). `binarySearchNearest` creates fractional mids and does not advance bounds; `betweenSorted` then passes a matching upper index as the exclusive end of `Table.slice`.  
   Concrete repro: current `dual.mzpeak` contains a centroid at m/z 150 with intensity 100, but `extractXIC(null,{start:149.999,end:150.001},false)` returns empty arrays for every spectrum; profile does too.  
   **Real data:** Yes. Ordinary XICs and DIA-XICs are wrong now.

2. **P0 correctness — mapped time columns never populate `Spectrum.time`; wavelength RT becomes zero.**  
   [record.ts:533–590](/Users/kohlbach/Claude/mzPeakViewer/vendor/mzpeakts/lib/src/record.ts:533) initializes time to `0`, treats a mapped `time` column as a parameter, then `continue`s past the structural handler at [record.ts:605](/Users/kohlbach/Claude/mzPeakViewer/vendor/mzpeakts/lib/src/record.ts:605). Wavelength consumers multiply that zero at [wavelength.ts:198–200](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/wavelength.ts:198) and [wavelength.ts:331–333](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/wavelength.ts:331).  
   Concrete repro with the current flat fixture: raw times `[0.1,0.2,0.3]` minutes materialize as record times `[0,0,0]`. A PDA acquisition at 0.1 min therefore appears at 0 s, not 6 s.  
   **Real data:** Yes, for current mapped wavelength metadata. Regular spectrum metadata trees also show zero, although Browse/FileStats bypass the builder.

3. **P0 correctness — flat-layout DIA window discovery always returns empty.**  
   [dia.ts:23](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/dia.ts:23) hardcodes legacy `MS_1000511_ms_level`; [dia.ts:118–125](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/dia.ts:118) never checks flat `ms_level`, despite the shared resolver at [cv.ts:36–43](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/reader/explorer/cv.ts:36).  
   Concrete input: a current flat DIA run containing `ms_level=2` rows and valid precursor isolation windows. `msCol` is null, every row is skipped, and every DIA-XIC is empty.  
   **Real data:** Yes; flat is the current converter layout.

4. **P0 correctness — one-facet majority routing drops mixed representations within a level.**  
   [chrom.ts:166–176](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/chrom.ts:166), [chrom.ts:274–288](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/chrom.ts:274), and [chrom.ts:352–368](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/chrom.ts:352) select one facet for the whole requested level. DIA makes the same mistake using whole-file counts at [dia.ts:155–166](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/dia.ts:155).  
   Concrete input: MS1 index 0 is profile-only and index 1 centroid-only. A missing promoted TIC forces the profile fallback, omitting index 1; `xic(msLevel:1)` does likewise. Separately, profile-majority MS1 plus centroid MS2 causes a DIA request to read the profile facet and return no member points. The cheap TIC masks only the TIC case when every promoted TIC is finite.  
   **Real data:** Yes, for valid mixed-representation runs.

5. **P0 correctness — all-level dual-facet merging is lossy and suppresses minority read errors.**  
   [chrom.ts:194–220](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/chrom.ts:194). Declared, correctly dual-stored rows do not double-count. However, unknown rows are accepted only from the majority facet; a point returned by the minority facet for a majority-declared index is always discarded; and any minority read exception silently returns the majority trace.  
   Concrete sequence: profile-majority mixed file with an unknown-representation spectrum stored only in `spectra_peaks`; its point is dropped. Likewise, a profile-declared spectrum missing from data but present in peaks is discarded instead of using the supported fallback. A transient minority HTTP failure produces a successful partial XIC.  
   **Real data:** Yes—nullable representation, imperfect facet placement, and remote failures are all plausible.

6. **P0 correctness — zero-length profile rows prevent centroid fallback.**  
   [spectrum.ts:501](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/spectrum.ts:501) uses key presence for `daOk`, while availability at [spectrum.ts:516–537](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/spectrum.ts:516) is otherwise length-checked.  
   Concrete input: `{dataArrays:{"m/z array":[],"intensity array":[]}, centroids:[{mz:150,intensity:5}]}` with declared representation `profile` or null. It returns an empty profile spectrum rather than the centroid.  
   **Real data:** Yes; explicit empty rows are an established encoding.

7. **P0 correctness — standard non-compact IMS bypasses the prefetch gate and loses mobility.**  
   [stats.ts:151–161](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/reader/stats.ts:151) recognizes mobility only through `ims_calibration`; open initializes only `spectra_data` at [openUrl.ts:29–40](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/reader/openUrl.ts:29). The false capability lets [dispatch.ts:216–221](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/worker/dispatch.ts:216) prefetch m/z and intensity without mobility, then [spectrum.ts:811–818](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/spectrum.ts:811) serves that incomplete entry.  
   Concrete input: local explicit-m/z PASEF/IMS data carrying MS:1003006 but no calibration block. Cold selection has mobility; warm selection does not, and IMS navigation is hidden.  
   **Real data:** Yes, for ordinary non-compact IMS.

8. **P0 correctness — the imaging ion cache is incorrectly reused as a spectrum-display cache.**  
   [cache.ts:238–245](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/cache.ts:238) explicitly says `CompactSpectrum` is not a display structure and carries neither facet provenance nor mobility, but [spectrum.ts:821–830](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/spectrum.ts:821) returns it directly. The cache is populated data-facet-first at [imaging.ts:275–307](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/imaging.ts:275).  
   Concrete sequence: dual-stored imaging pixel declared centroid; warming caches profile arrays, then pixel selection returns those arrays with `representation:"centroid"` and no `sourceUsed`/`altAvailable`. The plot uses the wrong signal semantics and hides the toggle. Mobility imaging similarly loses mobility.  
   **Real data:** Yes. This is distinct from the excluded spectrum-0 LC residual.

9. **P0 correctness — the mean/ROI fix still uses the wrong populations.**  
   [imaging.ts:736–758](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/imaging.ts:736) averages all reader MS1 spectra rather than grid spectra; dispatch does not pass the grid at [dispatch.ts:476–486](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/worker/dispatch.ts:476). ROI at [imaging.ts:773–785](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/imaging.ts:773) never filters MS2.  
   Concrete inputs: two grid pixels of intensity 1 plus a non-grid MS1 lockmass scan of 1000 gives a “whole-image” mean of 334 instead of 1. An ROI containing MS1 intensity 10 and MS2 intensity 100 yields 55 instead of 10.  
   **Real data:** Yes, for MSI with auxiliary scans or mixed levels.

10. **P0 correctness — arbitrary read failures become valid-looking partial science and may be cached permanently.**  
    `harvestDataArraysOrNull` catches every read error at [arrays.ts:88–97](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/reader/arrays.ts:88); imaging leaves a zero and commits a complete cache at [imaging.ts:299–313](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/imaging.ts:299). Wavelength matrix construction similarly catches every row failure at [wavelength.ts:417–425](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/wavelength.ts:417), then dispatch caches it at [dispatch.ts:368–385](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/worker/dispatch.ts:368).  
    Concrete sequences: one centroid-only remote MSI pixel has a transient range failure and becomes a permanent zero; PDA row 37 fails once, producing and caching a 99-row matrix from a 100-row run.  
    **Real data:** Yes, under transient remote failures or damaged pages.

11. **P0 correctness — compact IMS imaging silently renders blank.**  
    [imaging.ts:34–36](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/imaging.ts:34) excludes grid encoding but not `ims_calibration`; its fallback reaches [arrays.ts:55–66](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/reader/arrays.ts:55), which assumes literal centroid `mz`.  
    Concrete input: compact Layout-A points carry TOF, intensity, and 1/K0 but no m/z. `undefined` becomes NaN and every ion-window comparison rejects it. Layout B’s `tof` data array is likewise skipped for lacking `"m/z array"`.  
    **Real data:** Yes for compact timsTOF fleX MSI, though no checked-in compact imaging fixture exists.

12. **P1 user-visible — the final grouped scan/precursor/selected-ion row is omitted.**  
    [utils.ts:73–109](/Users/kohlbach/Claude/mzPeakViewer/vendor/mzpeakts/lib/src/utils.ts:73) returns the last matching index instead of an exclusive end when a group reaches the vector end; callers slice `[lo,hi)` at [metadata.ts:918–962](/Users/kohlbach/Claude/mzPeakViewer/vendor/mzpeakts/lib/src/metadata.ts:918).  
    Concrete repro: `dual.mzpeak` has scan indices `[0,1,2]`; spectra 0 and 1 each expose one scan, while spectrum 2 exposes none. Terminal precursor/selected-ion groups behave the same.  
    **Real data:** Yes, every flat file’s final group; it can become scientific loss when the omitted row is a DIA precursor.

13. **P1 user-visible — terminal worker errors are not sticky.**  
    [EngineClient.ts:237–247](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/client/EngineClient.ts:237) rejects current work but records no failed state; later sends still buffer or post at [EngineClient.ts:270–276](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/client/EngineClient.ts:270).  
    Concrete sequence: module/CSP/WASM error fires before `ready` and before any request; the later `open()` is queued forever. After a mid-session crash, a retry posts to the dead worker and remains pending.  
    **Real data:** Yes, deployment/startup failures and WASM crashes.

14. **P1 user-visible — a superseded open’s settlement clears the newer open tracker.**  
    [EngineClient.ts:317–327](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/client/EngineClient.ts:317).  
    Concrete sequence: call open A, then B; A’s rejection microtask unconditionally sets `openRequestId=0`; after one microtask, call C. C does not supersede B, so slow B remains queued/running ahead of C.  
    **Real data:** Yes, during rapid file switching. App-side stale dropping avoids committing B visually but does not avoid the delay/work.

15. **P1 user-visible — an old-file prefetch can read after the new file is current.**  
    The generation check precedes mutex acquisition at [spectrum.ts:670–675](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/spectrum.ts:670), while the post-acquisition read occurs before the write guard. Imaging has the same gap at [imaging.ts:489–508](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/imaging.ts:489) and [imaging.ts:516–524](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/imaging.ts:516).  
    Concrete sequence: A passes its check and queues behind open B; B opens and bumps generation; A then acquires the mutex and performs one obsolete A row-group read, delaying B’s first foreground read.  
    **Real data:** Yes. Write/commit guards prevent cache pollution, so this is latency/resource contention rather than cross-file science.

16. **P1 user-visible — missing times are emitted as scan indices labelled seconds; NaN sorting is invalid.**  
    [browse.ts:160–174](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/reader/explorer/browse.ts:160) substitutes `Number(index)` for null time, and [chrom.ts:243–249](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/chrom.ts:243) does the same for promoted TIC.  
    Concrete input: wire times `[60,null,120]` on indices `[0,1,2]` become `[60,1,120]` and sort as `[1,60,120]`; RT filtering compares that unitless index to seconds. A `[60,NaN,30]` series is not correctly sorted because `a.time-b.time` returns NaN.  
    **Real data:** Null times are real but uncommon; explicit NaN is theoretical/malformed.

17. **P1 user-visible — large TIC fallback is silently converted to an empty series.**  
    [chrom.ts:269–271](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/chrom.ts:269) returns null above 50,000 rows when any promoted TIC is unavailable, but [chrom.ts:333–336](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/chrom.ts:333) converts null to `[]`.  
    Concrete input: 50,001 MS1 spectra, one null promoted TIC, valid signal facets. The TIC displays as a successful zero-length trace instead of a size-limit result/error.  
    **Real data:** Yes, for large LC runs.

18. **P1 user-visible — `term_marker` support is applied inconsistently.**  
    Generic parameters correctly emit null at [record.ts:97–109](/Users/kohlbach/Claude/mzPeakViewer/vendor/mzpeakts/lib/src/record.ts:97), but ScanBuilder and ChromatogramBuilder bypass it at [record.ts:393–430](/Users/kohlbach/Claude/mzPeakViewer/vendor/mzpeakts/lib/src/record.ts:393) and [record.ts:660–677](/Users/kohlbach/Claude/mzPeakViewer/vendor/mzpeakts/lib/src/record.ts:660).  
    Concrete input: a mapped boolean column with `term_marker:true` and value `true` becomes `Param(null)` on a spectrum but `Param(true)` on a scan/chromatogram.  
    **Real data:** Yes when marker columns occur in those facets. The null itself is safe downstream.

19. **P1 user-visible — manifest entity/data-kind values stringify as `[object Object]`.**  
    [fileMeta.ts:67–74](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/reader/fileMeta.ts:67) calls `String()` on the class objects defined at [store.ts:42–115](/Users/kohlbach/Claude/mzPeakViewer/vendor/mzpeakts/lib/src/store.ts:42); Structure also rejects the object-valued role at [structure.ts:125–133](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/structure.ts:125).  
    Concrete repro: every current `dual.mzpeak` manifest entry reports both getter strings as `[object Object]`; archive roles become null.  
    **Real data:** Yes, every file with the current vendored classes.

20. **P1 user-visible — label-free projections remain fake reporter channels.**  
    [studyMeta.ts:63–75](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/studyMeta.ts:63) creates a channel for any MS:1002602 label; [studyMeta.ts:93–109](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/studyMeta.ts:93) retains it when fallback is empty.  
    Concrete input: label `"label free sample"` with no SDRF, or a label-free SDRF. Output remains `present:true`, `channelsSource:"projected"`, reporter m/z null.  
    **Real data:** Yes, for label-free sample projections.

21. **P1 user-visible — capability probing suppresses genuine signal-reader failures.**  
    [openUrl.ts:29–45](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/reader/openUrl.ts:29) catches every `spectrumData()` error even though an absent/empty facet already returns null.  
    Concrete sequence: metadata opens, but the first remote signal-footer range fails. Open succeeds with guessed layout/encoding capabilities instead of reporting the I/O failure.  
    **Real data:** Yes, with transient HTTP or corrupt signal footers.

22. **P1 user-visible, corpus-theoretical — nullable scans are dereferenced before their null check.**  
    [metadata.ts:918–923](/Users/kohlbach/Claude/mzPeakViewer/vendor/mzpeakts/lib/src/metadata.ts:918) calls `binarySearchAll` on `this.scans?.getChild(...)` before testing `this.scans`.  
    Concrete input: a valid flat archive with spectrum metadata and signal facets but no scans facet; every cold `SpectrumMetadata.get()` throws.  
    **Real data:** The format/model permits it, but I found no current flat no-scans fixture, so this remains theoretical for the examined corpus.

## Numbered attack-question answers

1. **`extractAllLevels`:** No double-count for correctly declared dual-stored rows. Unknown rows follow only the majority facet; minority points for majority-declared indices are discarded, even when the major facet lacks them. Minority exceptions silently return partial data. NaN times are not sorted correctly.

2. **`buildTic` / `pickUseProfileForLevel`:** Yes, one-facet fallback is wrong when MS1 itself mixes profile and centroid. The promoted-TIC shortcut masks this only while every contributing TIC is finite. Above 50,000 rows, one missing TIC becomes an empty trace.

3. **RT units:** For finite raw values, summary, XIC input/output, and stored chromatograms each convert exactly once; I found no double multiplication. The defects are mapped record time collapsing to zero—breaking wavelength paths—and null XIC/TIC times becoming unitless indices labelled seconds.

4. **EngineClient errors:** Existing pending operations are rejected once; startup/crash wording follows the `ready` snapshot, and I found no double rejection. `rejectAllPending` clears all three pending maps, `openRequestId`, and the outbox. The defect is that fatal failure is not remembered, so later calls hang. The independent triple-open tracker race remains.

5. **Spectrum prefetch provenance:** Forced reads are safe: mismatching hits cold-read and never write. Normal completed drains stamp provenance correctly; early stops leave only honest “unknown” stamps, and write-time generation guards prevent next-file cache pollution. Additional holes are standard IMS mobility loss, imaging ion-cache reuse, zero-length profile routing, and the obsolete post-switch read.

6. **`chainRead` / `RemoteBlob`:** No deadlock or unbounded live chain found. Rejection is converted to a resolved predecessor for the next read, and the WeakMap retains only the latest promise per source. All Parquet and metadata paths use `RemoteBlob`; ZIP enumeration runs during initialization, while optical `entry.getData` is a non-Parquet contiguous read under the worker mutex.

7. **Worker dispatch:** `startSpectrumPrefetch` has the mobility false-negative and the post-switch obsolete-read gap. Wavelength-matrix cached arrays are copied before transfer. `archiveMemberBytes` correctly clamps to 256 MiB and transfers a fresh buffer. Commit/write generation guards prevent next-file cache contamination.

8. **`term_marker`:** `Param(null)` does not break reviewed consumers—`Param.value` is nullable and core consumers type-check it. The merge is incomplete because ScanBuilder and ChromatogramBuilder still emit the boolean value.

Fine areas: normal finite RT conversion, correctly declared dual-facet de-duplication, pending-map clearing, forced-read cache behavior, per-source RemoteBlob serialization, matrix transfer copying, archive cap, and cache write/commit generation guards were all sound.

Typecheck passed. Vitest could not create its temporary/cache files under the read-only sandbox, so verification used direct current-build Node probes. I excluded the 11 known legacy-imaging goldens and the documented spectrum-0 toggle residual. The adversarial and branch-boundary passes drove the concrete sequences and real-versus-theoretical classifications above.

Workspace note: HEAD remains `8f697aa` with no tracked diff, but `git status` now reports an untracked [__diaprobe.test.ts](/Users/kohlbach/Claude/mzPeakViewer/packages/core/src/engine/__diaprobe.test.ts). It appeared during the review; the read-only sandbox prevented cleanup. I did not use it as evidence.
