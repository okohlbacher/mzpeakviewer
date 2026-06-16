# XIC acceleration via hyparquet-style Parquet queries — feasibility, mechanism, cost

**Date:** 2026-06-16
**Author:** research agent (codebase + web)
**Question:** Can XIC (Extracted Ion Chromatogram) extraction in mzPeakViewer be accelerated using hyparquet-style Parquet queries — predicate pushdown, column projection, row-group/page-index skipping via column statistics — and if so, how, and at what cost?

---

## Executive summary (verdict up front)

**No — not for the m/z dimension, given mzPeak's current layout. Predicate pushdown on m/z cannot accelerate an XIC here, regardless of reader, because every row group's m/z range spans (nearly) the full acquisition m/z range.** The XIC m/z window therefore intersects *every* row group and *every* page, so there is nothing to skip. This is a layout problem, not a reader-capability problem, and the project already reached this conclusion empirically (memory note `cold-read-bandwidth-bound`).

What *is* available without a format change is modest and dimension-specific:

- **(a) No-format-change wins (small):** column **projection** (read only m/z + intensity, skip any unused per-point columns), **skipping spectra_data entirely for centroid files** (already done via `useProfile`), and **row-group/page skipping along the RT/index axis** when the user requests a *time-windowed* XIC — which the vendored reader **already does today** (`extractRangeFor` → `findPageForRange`, keyed on the spectrum-index column). These are real but they only help when the query is RT-narrow; a full-run XIC still touches everything.
- **(b) Format-change wins (large, but out of viewer scope):** an m/z-sorted/binned secondary table (the mzDB / "long tidy table" / DuckDB-over-Parquet approach) is the *only* thing that makes m/z predicate pushdown genuinely effective. That is a converter (mzML2mzPeak) + mzPeak-spec change, with real write-time and on-disk-size cost.

**On hyparquet specifically:** modern hyparquet (current `master`) is genuinely more capable than the README implies — it *does* support a value-based `filter` predicate, **row-group skipping by column statistics** (`canSkipRowGroup`), bloom-filter row-group skipping (`useBloomFilters`), the **page index** (`readColumnIndex`/`readOffsetIndex`), column projection, and async HTTP range reads. But none of that changes the verdict: those mechanisms can only skip what the *statistics* let them skip, and mzPeak's per-spectrum-row m/z statistics are non-selective for an XIC. Adopting hyparquet would buy a cleaner pushdown API and a smaller bundle — **not a faster XIC on today's files.**

**Recommendation:** Do **not** adopt hyparquet or build m/z predicate pushdown into the reader as an XIC accelerator. The honest accelerators are (1) confirm/strengthen RT-range pushdown (already present), (2) a cheap column-projection check, and (3) push the real win — an m/z-partitioned secondary index — to the converter as a *separate, measured* spike. Given the project's measured culture (parallel reads rejected as a dud), gate any work behind a benchmark.

---

## 1. Current XIC implementation (how an XIC is computed today)

### 1.1 Dispatch and engine

- The worker routes `extractChrom` to `engineExtractChrom` with the cached scan context (`packages/core/src/worker/dispatch.ts:330`).
- `engineExtractChrom` (`packages/core/src/engine/chrom.ts:153`) dispatches on mode:
  - `xic` / `xicRange` → `extractChromatogram(reader, { mz, tolDa, timeRange, useProfile })` (`chrom.ts:192`).
  - `tic` → prefers the promoted per-spectrum TIC column (`cheapTic`, `chrom.ts:85`), no signal I/O; falls back to a whole-file summed read only if no promoted TIC, refusing past `AUTO_SCAN_LIMIT = 50_000` (`chrom.ts:46`, `:120`).
- **Source pick (`pickUseProfile`, `chrom.ts:67`):** majority representation — `profile >= centroid` → `spectra_data`, else `spectra_peaks`. Default `true` (profile) when counts are unknown. This already means **a centroid-only file never touches `spectra_data`** for its XIC.

### 1.2 The actual read path

`extractChromatogram` (`packages/core/src/reader/explorer/browse.ts:128`) calls `reader.extractXIC(tRange, mzRange, useProfile)` and then, **per returned spectrum, sums the intensity array** within the window (`browse.ts:148–163`). It re-applies the RT window locally with inclusive bounds (`browse.ts:169–171`) because the reader's time→index mapping can over-include.

The vendored reader's `extractXIC` (`vendor/mzpeakts/lib/src/reader.ts:252`):
- maps `timeRange` → an **index range** via `spectrumMetadata.timeRangeToIndices` (`reader.ts:260`),
- picks `spectrumData()` (profile) or `spectrumPeaks()` (centroid) (`reader.ts:264`),
- calls `reader.extractRangeFor(indexRange, mzRange)` (`reader.ts:266`).

`DataArraysReader.extractRangeFor` (`vendor/mzpeakts/lib/src/data.ts:1207`) is the crux:

```
1216  iter = await this._getRangeIter(start, end);   // RT/index range → row-group + page subset
...
1224  if (coordinateRange) iter.setQueryCoordinateRange(coordinateRange);
...
1232  for await (const [index, entry] of iter) {
1235    const coordinatesOf = (entry as Arrow.Table).getChild(sortArr.arrayName);  // the m/z column
1240    const idxRange = betweenSorted(coordinatesOf, coordinateRange.start, coordinateRange.end);  // binary search WITHIN the decoded spectrum
1247    if (idxRange) entries.push({ index, dataArrays: packTableIntoDataArrays(entry.slice(idxRange[0], idxRange[1])) });
```

**What is read vs decoded vs discarded:**

- **RT/index dimension — genuinely skipped at the Parquet level.** `_getRangeIter` (`data.ts:1275`) resolves the index range to a **subset of row groups** (`rowGroupIndex.keysFor`, `data.ts:1276–1288`) and a **page byte-offset window** (`findPageForRange`, `data.ts:1290` → `data.ts:575`). So a time-windowed XIC reads only the row groups/pages whose spectrum-index range overlaps the requested RT window. This is real row-group + page-index pushdown — **on the index axis**.
- **m/z dimension — NOT skipped at the Parquet level.** Every spectrum in the (index-)selected range is **fully decoded**, and the m/z window is applied as a **post-decode binary search** (`betweenSorted`, `data.ts:1240`; `vendor/mzpeakts/lib/src/utils.ts:142`) inside each spectrum's already-materialized Arrow table. The bytes for the out-of-window m/z are read and decompressed; only the final Arrow `slice` discards them. For the chunked profile layout there is a per-chunk coordinate prefilter (`data.ts:917` `queryRange`, chunk start values) — but those chunks are still within a decoded row, decoded after the row group is read.

So today: **an XIC over the full run streams and decodes every contributing spectrum's full (m/z, intensity) arrays and filters to the window per spectrum.** A time-windowed XIC additionally skips row groups/pages outside the index range — the only Parquet-level skipping in play.

### 1.3 Files involved

- Profile XIC → `spectra_data.parquet` (chunked m/z, POINT or CHUNK layout).
- Centroid XIC → `spectra_peaks.parquet`.
- The bulk-stream fast path used for ion images (`streamPointArrays`, `data.ts:1372`; `streamSpectraDataArrays`, `packages/core/src/reader/openUrl.ts:129`) is *not* what XIC uses — XIC uses the `extractRangeFor` path, which already does index-range pushdown.

---

## 2. mzPeak layout & predicate-pushdown feasibility (the crux)

### 2.1 Do statistics / a page index even exist in the corpus?

**Statistics: yes, on the index column. Page index: depends on the file, and often absent on profile data.**

- The reader builds row-group bounds from `rowGroup(i).column(0).statistics()` — **column 0 is the entry/spectrum-index column**, not m/z (`data.ts:522–538`). It builds the page key index from `columnIndexFor(0)` — **again column 0, the index column** (`data.ts:503–520`). These power `findPageFor`/`findPageForRange` (`data.ts:550`, `:575`) and `RangeIndex.keysFor`.
- **Critically, the project measured that populated profile `spectra_data` files often land in ONE giant row group with NO page offset index** (memory `profile-rowgroup-chunking`: "all per-spectrum chunks land in ONE Parquet row group (177,338 chunks / 942 MB), and there is no page offset index"). Root cause: the converter's `row_group_size` is a *row count* (`TUNED_ROW_GROUP = 2_000_000`) which is correct for peaks (1 row = 1 peak) but never reached for the chunked data facet (1 row = a whole-spectrum chunk). The handoff to fix this lives in `mzML2mzPeak/docs/handoff-mzpeak-profile-rowgroup-chunking-2026-06-15.md`.
- So even the **index-axis** RT pushdown is degraded on exactly the slow (profile) files: one row group, no page index → `findPageForRange` returns null → the whole column is read. Fixing the row-group chunking (converter work, already scoped elsewhere) would restore index-axis pushdown; it does **nothing** for m/z.

### 2.2 Why a per-spectrum row layout defeats m/z pushdown for an XIC

mzPeak stores **one spectrum per row (or per chunk-row)**. A row group therefore spans many *whole* spectra. Each of those spectra individually covers the **full acquisition m/z range** (e.g. 100–1000 Da). Consequently the per-column min/max **m/z statistics of any row group are ≈ [global m/z min, global m/z max]** — they are identical and non-selective across every row group.

An XIC predicate is `mz ∈ [target−tol, target+tol]` (a narrow window). Because that window lies **inside every row group's m/z range**, statistics-based skipping (`canSkipRowGroup`-style) can never eliminate a row group: the predicate "might match" everywhere. The same holds at page granularity if pages were keyed on m/z (they aren't — they're keyed on index). The project states this exactly:

> "no m/z predicate pushdown today because every row group's m/z range spans the full acquisition range" — memory `cold-read-bandwidth-bound`.

This is the textbook failure mode of predicate pushdown: it only helps when the predicate is **selective across the storage partitions**, which requires the data to be **clustered/sorted by the predicate column**. mzPeak is clustered by spectrum index (≈ RT), not by m/z. RT predicates push down; m/z predicates do not.

### 2.3 What's read vs skipped, quantified

For a full-run XIC over profile data: ~**0% of bytes skippable** by any pushdown (every row group qualifies; m/z is post-decode). Column **projection** could skip whatever non-(m/z, intensity) per-point columns exist, but in mzPeak's POINT/CHUNK data facet those are essentially the only large columns, so projection savings are small (single-digit %, dominated by the intensity column which you need anyway). The previously measured cold ion render (a similar full-stream workload) was ~19 s network/decompress + ~16 s decode (now fixed) + ~3 s assembly — i.e. **the cost is reading+decompressing the intensity column, which an m/z predicate cannot avoid on this layout.**

For a **time-windowed** XIC: bytes skippable ≈ the fraction of the run *outside* the RT window — **but only if the file is well-chunked with a page index**. On the monolithic single-row-group profile files, ~0% is skippable until the converter row-group fix lands.

---

## 3. hyparquet capabilities (cited)

hyparquet (github.com/hyparam/hyparquet) is a pure-JS (no-WASM) Parquet reader, ~10 KB gzipped core, designed to "minimize data fetching using HTTP range requests" ([README](https://github.com/hyparam/hyparquet/blob/master/README.md); [blog](https://blog.hyperparam.app/quest-for-instant-data/)). **The README undersells it; the current `master` source is materially more capable:**

- **Column projection** — `columns: string[]` (README; `src/read.js`).
- **Row-range reads** — `rowStart` (inclusive) / `rowEnd` (exclusive) (README; `src/types.d.ts:33–34`).
- **Value-based predicate filter** — `filter?: ParquetQueryFilter` with Mongo-style operators (`$gt`, `$lt`, `$gte`, `$lte`, `$and`, `$or`, `$nor`, `$eq`, `$in`) (`src/types.d.ts:31`, `:56–63`; `src/read.js:27,105`; `src/filter.js`). Requires `rowFormat: 'object'`.
- **Row-group skipping by column statistics** — `canSkipRowGroup({ rowGroup, ..., filter, ... })` reads `rowGroup.columns[i].meta_data.statistics` (`min_value`/`max_value`) and prunes groups the predicate cannot match (`src/filter.js:74–122`; wired into the read plan at `src/plan.js:20,38`).
- **Bloom-filter row-group skipping** — `useBloomFilters?: boolean` (default false) "fetch bloom filters to enable row-group skipping on `$eq`/`$in` predicates" (`src/types.d.ts:42`; `src/bloom.js`; `src/plan.js:1`).
- **Page index (ColumnIndex + OffsetIndex)** — `readColumnIndex` parses per-page `min_values`/`max_values`/`null_pages`/`boundary_order`; `readOffsetIndex` parses `page_locations` (`src/indexes.js:16–35`). `useOffsetIndex` lets the plan read only the page-byte-range covering `[rowStart,rowEnd]` within a group (`src/plan.js:58`; `src/rowgroup.js:8,55–59`).
- **Async byte-range reads** — `AsyncBuffer` (`slice()` → `Promise<ArrayBuffer>`, optional `byteLength`); `asyncBufferFromUrl` uses HTTP range requests (README; `src/types.d.ts:99`).
- **Compression** — uncompressed + Snappy built in; GZip/Brotli/ZSTD/LZ4 via the separate `hyparquet-compressors` package ([npm](https://www.npmjs.com/package/hyparquet-compressors)).
- **Metadata-only reads** — `parquetMetadataAsync` (schema + statistics without reading data) (README).

**Limits / caveats for our use case:**
- Row-group statistic skipping and the page **ColumnIndex** value-pruning only help if statistics are **selective**. On mzPeak's per-spectrum rows, m/z statistics are non-selective (§2.2), so `filter: { mz: { $gte: lo, $lte: hi } }` would prune **zero** row groups and read everything anyway — same outcome as today.
- The `filter` is applied **per row** after the candidate pages are read (`src/read.js:105–108`), so even where it can't skip, it still materializes the rows. For mzPeak's nested-list-per-spectrum schema, an m/z `filter` on the list column is not even the right shape (the predicate is intra-row, over a list, not a scalar column).
- ZSTD (mzPeak's codec) requires the extra `hyparquet-compressors` dependency.

Sources: [hyparquet README](https://github.com/hyparam/hyparquet/blob/master/README.md), [hyparquet repo](https://github.com/hyparam/hyparquet), [hyparquet npm](https://www.npmjs.com/package/hyparquet), [Hyperparam blog](https://blog.hyperparam.app/quest-for-instant-data/), [Parquet PageIndex spec](https://github.com/apache/parquet-format/blob/master/PageIndex.md).

---

## 4. Comparison with parquet-wasm (the current reader via mzpeakts)

The vendored reader is parquet-wasm (Rust→WASM bindings, kylebarron/parquet-wasm) wrapped by mzpeakts.

- **Already supported today by parquet-wasm's `ParquetFile.read`:** `rowGroups` (read only listed row groups), `columns` (projection), `limit`, `offset`, `batchSize` ([ParquetFile API docs v0.7.1](https://kylebarron.dev/parquet-wasm/classes/node_parquet_wasm.ParquetFile.html); [readParquet docs](https://kylebarron.dev/parquet-wasm/functions/node_parquet_wasm.readParquet.html)). **mzpeakts already uses selective `rowGroups` + offset/limit** (`data.ts:92,1175,1294–1305`) — i.e. the index-axis pushdown in §1.2 is built on these.
- **Not supported by parquet-wasm:** value-based **predicate pushdown** (filter by column value to skip pages/row groups) is listed as *future work* in the README ("Example of pushdown predicate filtering, to download only chunks that match a specific condition") — [parquet-wasm README](https://github.com/kylebarron/parquet-wasm/blob/main/README.md). It also does not surface a JS-level page-index value-pruning API.
- **Exposes statistics + column index:** mzpeakts reaches row-group statistics (`column(i).statistics()`) and the column index (`columnIndexFor(...)`) through parquet-wasm's metadata (`data.ts:503,526`), which is how it builds the index-axis page/row-group index. So the *machinery* for statistics-driven skipping is present; it's just keyed on the index column.

**Net:** hyparquet's advantage over parquet-wasm is a real *predicate-pushdown + bloom + page-ColumnIndex* implementation and a tiny pure-JS bundle (no WASM). parquet-wasm's advantage is mature ZSTD/Arrow, the existing mzpeakts integration, and the streaming fast path the project already tuned (`streamPointArrays`). **For XIC, neither advantage matters, because the limiting factor is layout selectivity, not reader features.** Swapping readers to "get pushdown" would be cargo-culting a capability the data can't use.

---

## 5. Format-change options & converter cost (the only path to real m/z pushdown)

To make m/z predicate pushdown effective, the data must be **clustered by m/z** so that row-group/page statistics become selective. Prior art:

- **mzDB** — stores data in small **2-D (m/z × RT) blocks** spanning several consecutive spectra, "enabling quick reading of XICs"; ~2× faster access and ~25% smaller than XML ([mzDB, PMC4349994](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4349994)).
- **MzTree** — Sort-Tile-Recursive (STR) spatial partitioning of (m/z, RT) by data volume for fewer nodes per query ([axis-agnostic storage, PMC5687738](https://pmc.ncbi.nlm.nih.gov/articles/PMC5687738/)).
- **Toffee / mzMLb** — HDF5 random-I/O layouts enabling new access patterns ([Toffee, Nature SR](https://www.nature.com/articles/s41598-020-65015-y); [mzMLb, PMC7871438](https://pmc.ncbi.nlm.nih.gov/articles/PMC7871438/)).
- **"Simple databases" (JPR 2025)** — a **long/tidy table** `(filename, scan, rt, mz, intensity)` for MS1 in SQLite/DuckDB/**Parquet**; the six common extractions (single scan, XIC, RT range, fragment search) run in **<1 s even on >1 GB files**, with DuckDB ~10× SQLite ([JPR](https://pubs.acs.org/doi/10.1021/acs.jproteome.5c00721); [ChemRxiv](https://chemrxiv.org/doi/10.26434/chemrxiv-2025-3kzff)).
- **arcMS** — Waters→**Parquet** long-format `(scan, rt, mz, intensity[, bin, dt])`; opens as a DataFrame in 1–3 s vs 15–20 min for mzML, relying on columnar predicate pushdown via Arrow/DuckDB ([arcMS, PMC11873790](https://pmc.ncbi.nlm.nih.gov/articles/PMC11873790/)).

**What would make Parquet pushdown genuinely work for mzPeak XIC:** a **secondary "long/tidy" table** of points `(spectrum_index, rt, mz, intensity)` **sorted (or range-partitioned/binned) by m/z**, written by the converter alongside the existing spectrum-major facets. Then:
- m/z statistics per row group become **tight and selective** → an XIC predicate skips all row groups outside `[lo,hi]`.
- An XIC reads only the few row groups covering the m/z window across all RTs — orders-of-magnitude less I/O for narrow windows.
- This is exactly the workload hyparquet's `filter` + `canSkipRowGroup` (or parquet-wasm + `rowGroups` chosen from statistics) would exploit.

**Converter cost (mzML2mzPeak):**
- **Write time / memory:** a full m/z-sort of all points is an out-of-core sort over the entire dataset (often 10⁷–10⁹ points) — expensive in CPU and peak memory; m/z **binning** (coarse partition then local order) is cheaper and usually enough for statistics selectivity.
- **On-disk size:** a duplicate point table roughly **doubles** the point payload unless the spectrum-major facet is dropped (it can't be — spectrum display needs it). m/z-sorted data also **compresses differently**: delta/RLE on a globally m/z-sorted column is excellent, but you lose the per-spectrum locality that helps the intensity column; net size impact must be measured. Expect **+30–100% on the point payload** for the secondary table.
- **Spec impact:** this is a **mzPeak format change** (a new optional facet + array-index entry), not a viewer change — explicitly out of viewer scope per the project's own notes, and it touches the unstable mzPeak spec (HUPO-PSI). It would need to be optional/version-detected.

---

## 6. Ranked recommendations (effort / payoff)

1. **Do nothing reader-side for m/z pushdown; do not adopt hyparquet for XIC. (effort: 0; payoff: avoids a measured-zero-gain rewrite.)** The layout, not the reader, is the bottleneck. This matches the project's "reject speculative optimizations" culture (parallel reads rejected at 1.10–1.39×; memory `cold-read-bandwidth-bound`).

2. **Confirm RT-range XIC pushdown actually fires, and land the converter row-group fix.** (effort: low–medium; payoff: real for time-windowed XIC on profile files.) The index-axis pushdown exists (`extractRangeFor`→`findPageForRange`) but is **defeated by the single-giant-row-group profile layout** (no page index). The already-scoped converter fix (`mzML2mzPeak` row-group-by-bytes, handoff doc dated 2026-06-15) would restore it. **Add a benchmark:** time-windowed XIC bytes-read before/after the converter fix. This is the highest-payoff *available* win and it's mostly already on the roadmap.

3. **Add column projection to the XIC read if any non-(m/z,intensity) per-point columns exist.** (effort: low; payoff: small, single-digit %.) Verify the data facet's column set; if there are unused per-point columns, project them out. Likely negligible because intensity dominates and is unavoidable.

4. **Spike (don't build) an m/z-binned secondary point table in the converter.** (effort: high, in mzML2mzPeak + mzPeak spec; payoff: potentially large — the only path to true m/z pushdown / sub-second narrow XIC.) Before any commitment, run a **measured spike** on one representative profile file: (a) write a m/z-sorted/binned `(index, rt, mz, intensity)` Parquet, (b) measure XIC query time + bytes-read with statistics-driven row-group selection vs today, (c) measure write-time and size delta. Decision gate: only proceed if narrow-XIC I/O drops ≥5× and size delta is acceptable. Cite mzDB / JPR-2025 / arcMS as design priors.

5. **If (4) proves out and a pure-JS pushdown reader is wanted for that secondary table, *then* re-evaluate hyparquet.** (effort: medium; payoff: conditional.) Only at that point does hyparquet's `filter` + `canSkipRowGroup` + bloom/page-index become load-bearing — and even then parquet-wasm + statistics-driven `rowGroups` selection (machinery already in mzpeakts) may suffice without a second reader.

**A small benchmark IS warranted — for #2 and #4 — before any adoption.** No reader swap is warranted at all on current evidence.

---

## 7. Open questions

- **Exact m/z statistics in the corpus:** confirm empirically that `spectra_data`/`spectra_peaks` row groups carry per-row-group m/z min/max ≈ global range (the §2.2 assumption). Quick check: read `rowGroup(i).column(<mz col>).statistics()` across a real file. If a file happened to be m/z-sorted, the verdict flips — but mzPeak's spectrum-major layout makes that essentially impossible.
- **Does the profile data facet have non-essential per-point columns** that projection could drop (affects rec #3)?
- **Centroid XIC:** `spectra_peaks` is well-chunked (~25 MB / 2 M-row groups, memory note). Does its **index-axis** pushdown already make time-windowed centroid XICs fast? Likely yes — measure to confirm rec #2 mainly targets profile.
- **Converter sort cost at scale:** is m/z **binning** (cheap partition) selective enough to skip row groups, avoiding a full out-of-core m/z sort? (affects rec #4 cost.)
- **Spec acceptance:** would the HUPO-PSI mzPeak spec accept an optional m/z-partitioned secondary facet, given the format is "explicitly unstable"?
- **Bloom filters are the wrong tool here** (they answer `$eq`/`$in`, not range `$gte/$lte`) — noted to forestall a tempting-but-useless avenue.

---

## Appendix — key code anchors

- XIC engine dispatch: `packages/core/src/engine/chrom.ts:153`, source pick `:67`, TIC cheap path `:85`.
- Worker route: `packages/core/src/worker/dispatch.ts:330`.
- XIC read + per-spectrum sum: `packages/core/src/reader/explorer/browse.ts:128` (sum loop `:148–163`, local RT refilter `:169`).
- Reader `extractXIC`: `vendor/mzpeakts/lib/src/reader.ts:252` (RT→index `:260`).
- **m/z post-decode binary search (the crux):** `vendor/mzpeakts/lib/src/data.ts:1207` `extractRangeFor`, `betweenSorted` at `:1240`; helper `vendor/mzpeakts/lib/src/utils.ts:142`.
- Index-axis row-group/page pushdown: `vendor/mzpeakts/lib/src/data.ts:1275` `_getRangeIter`, `:575` `findPageForRange`; statistics/page index built from **column 0 (index)** at `:503` and `:522–538`.
- Bulk stream fast path (used by ion images, not XIC): `vendor/mzpeakts/lib/src/data.ts:1372` `streamPointArrays`; `packages/core/src/reader/openUrl.ts:129`.
- Project findings: memory `cold-read-bandwidth-bound` (no m/z pushdown; layout-bound), `profile-rowgroup-chunking` (single-row-group / no page index; converter fix), `reader-findpagefor-rowgroup-bug`.
