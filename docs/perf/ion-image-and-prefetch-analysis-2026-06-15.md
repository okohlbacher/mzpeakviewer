# MSI ion-image rendering & spectrum prefetch — performance analysis

**Date:** 2026-06-15 · **Author:** engine deep-dive (adversarial) · **Repo HEAD:** post-`d60fcde`
**Demo files (live, data.mzpeak.org CDN):**
- Imaging: `HR2MSImouseurinarybladderS096.mzpeak` — 310 MB, 34,840 spectra (260×134), **all MS1**, 40.6 M points (~1,164 pts/spectrum).
- LC/DDA: `…TiO2_TMT_fr8.mzpeak` — 90 MB, 31,398 spectra, **MS1 10,305 (33%) / MS2 21,093 (67%)**.

---

## Implementation status (updated 2026-06-15)

- **Stage 1 — shipped (`f62c28b`):** memory-sized shared cache budget
  (`clamp(deviceMemory×96, 192, 768) MB`) + a spectrum LRU read-through storing
  m/z + intensity + msLevel only. Repeat `selectSpectrum` 448 ms → 13 ms.
- **Stage 2 — shipped (`c133e2f`):** a FIFO reader mutex (replaces the per-dispatch
  serialization) + an interruptible, time-sliced **background ion-cache prefetch on
  open**. First ion render after open is now an instant cache hit (0.1 s vs 33 s cold,
  verified in-browser); user reads preempt the prefetch (soft-preempt ≤ one 30 ms slice
  + 350 ms cooldown). The cold-render wait is eliminated.
- **Stage 3 — deferred (operator decision, 2026-06-15):** parallel HTTP/2 range reads +
  `AbortSignal` true-interrupt require modifying the pinned `mzpeakts` submodule
  (separate repo/policy) for now-modest gain (the latency is already hidden by Stage 2).
  Kept as the §7 follow-up; revisit when there's appetite to touch the reader.

## 0. TL;DR

1. **Rendering an ion image is ~100% I/O + decode, ~0% compute.** Measured: 35.4 s total, of which the window-sum over all 40.6 M points is **47 ms**. Do **not** optimize the math.
2. **The spectra_data columns are already minimal** (`spectrum_index`, `m/z array`, `intensity array`). Column projection — the obvious "read only what you need" — **buys nothing for these files**.
3. **The bottleneck is sequential, latency-bound range reads.** The CDN delivers **27 MB/s** sustained and supports **HTTP/2** (ALPN `h2`), but every parquet row group is fetched with a **separate awaited range request** (~46 ms TTFB each). The payload would transfer in ~10 s at full bandwidth; it takes ~35 s. **~25 s is round-trip latency + Numpress decode, not bandwidth.** → **Parallel range reads** (multiplexed over the existing HTTP/2 connection) is the single biggest lever.
4. **The spectrum prefetch cache is NOT active.** mzPeakExplorer's scheduler + LRU were never ported to `@mzpeak/core`. The only cache today is the ion-image `SpectraArrayCache` added in `d60fcde`. Explorer's design (memory-sized LRU, two-lane scheduler, generation counters) is a ready blueprint — with two important caveats below.
5. **HTTP/2: yes. Chunking: the data is chunked (parquet row groups/pages) but the reader doesn't parallelize across chunks.** Responses are range-based `206`, not chunked transfer-encoding (correct for range reads).

---

## 1. Where the time goes (measured)

Instrumented `engineRenderIonImage`'s data path against the live 310 MB imaging file:

| Stage | Time | Note |
|---|---|---|
| `openEngineUrl` (metadata, footers) | 0.66 s | cheap |
| `reader.spectrumData()` init | ~0 s | array index already loaded at open |
| **`enumerate()` full pass — network + parquet/Numpress decode** | **35.37 s** | the whole cost |
| pure window-sum over 40.6 M points (no I/O) | **0.047 s** | negligible |

The cache-hit path (re-sum from the in-memory `SpectraArrayCache`) renders any new m/z in **~0.05 s** (already shipped). So the entire user-visible cost of a *cold* ion image is **getting the bytes off the network and decoding them**.

**CDN characteristics (measured):**
- Sustained throughput: **27.4 MB/s** (50 MB range in 1.91 s, single connection).
- Per-range round-trip: **~46 ms TTFB** (consistent across small reads).
- ALPN: server negotiates **`h2`** (HTTP/2 available). TLS 1.3. Server: BunnyCDN.
- Range support: `206 Partial Content` with correct `Content-Range`; `Accept-Ranges` header omitted (the reader already forces range mode — see `openUrl.ts` `forceRangeRequests: true`).

**The gap:** spectra_data is the bulk of the 310 MB. At 27 MB/s that's ~10 s of pure transfer. Observed 35 s ⇒ **~25 s overhead** from (a) serially awaiting one row-group range request at a time (each paying ~46 ms latency) and (b) Numpress-Linear decode of 40.6 M points on the worker thread. Bandwidth is **not** saturated.

---

## 2. Is the ion-image *computation* inefficient? No.

The window-sum is `O(total points)` = 40.6 M iterations = **47 ms**. There is no algorithmic win worth pursuing here:

- A per-spectrum binary search to the `[mz−tol, mz+tol]` window (skipping out-of-window points) would cut the inner loop, but 47 ms → maybe 5 ms saves nothing a user can perceive, and it complicates the centroid-fallback path.
- **Adversarial:** the one *allocation* inefficiency is real but secondary — the build pass materializes 40.6 M points into `Float64Array`/`Float32Array` (~487 MB of allocations + GC churn) purely to (a) sum them and (b) cache them. If we were **not** caching, we could **stream-reduce** during decode (accumulate the window-sum without ever materializing full arrays), avoiding the allocation. But we *do* cache (so repeat renders are 0.05 s), and the cache needs the arrays. So materialize-and-cache is the right call **when caching**; stream-reduce is only better for a one-shot, no-cache render.

**Conclusion:** ion-image compute is already optimal. Effort belongs in I/O and caching, not the kernel.

---

## 3. How to accelerate the cold render (adversarial)

Ranked by expected payoff for the cold-cache case (the only slow case):

### 3.1 Parallel range reads — **biggest lever, ~2–3× potential**
The reader streams row groups **sequentially** (`await tabStream.next()` one at a time — confirmed in `vendor/mzpeakts/lib/src/data.ts`). Each awaited read eats a full ~46 ms round trip before bytes flow. With **N concurrent row-group fetches** multiplexed over the **already-available HTTP/2 connection**, latency hides behind transfer and we approach the 27 MB/s ceiling → ~10–15 s instead of 35 s.
- *Where:* a prefetch/scheduler layer in `@mzpeak/core` that issues several `DataArraysReader.get(rowGroup)` / range reads in flight at once, bounded by a concurrency cap (e.g. 4–8).
- *Risk/adversarial:* mzpeakts' `DataArraysReader.enumerate()` is a single sequential generator; true parallelism likely needs either (a) issuing multiple `getRange()` calls over disjoint index spans concurrently and merging, or (b) a small change in mzpeakts to parallelize `streamArrowBatches`. The HTTP layer (`@zip.js` `HttpReader`) must tolerate concurrent `readUint8Array` calls — verify it doesn't serialize internally.

### 3.2 Background prefetch on open — **hides the 35 s entirely (perceived)**
Start streaming spectra_data into the `SpectraArrayCache` **immediately on open**, in the background, so by the time the user types an m/z the data is resident and the render is 0.05 s.
- *Adversarial caveat (important):* **mzPeakExplorer deliberately disabled background preload for remote/HTTP files** — comment verbatim: *"every cold spectrum read is a large row-group range request, so eagerly fetching all spectra saturates the connection and starves foreground navigation."* So naive "prefetch everything on open" can make the **first pixel-spectrum click or the Summary TIC feel sluggish** while the pipe is busy. Mitigation: the prefetch must be **interruptible and de-prioritized** (see §5) — exactly the stated design requirement.

### 3.3 Don't fetch what you won't sum — MS-level scoping
For an **imaging** file this is moot (all 34,840 spectra are MS1 and all are grid cells). For **LC/DDA** (TMT: 67% MS2) an ion image / TIC over MS1 should **never fetch MS2 spectra** — a 3× bandwidth cut on those files. The ion image already only visits grid cells; the win is in the *prefetch* path (§5/§6).

### 3.4 Decode cost — secondary
Numpress-Linear decode of 40.6 M points is CPU on the worker. It's already off the main thread (good). A WASM/SIMD numpress path would help but it's not the dominant term (network latency is). Defer.

### 3.5 Column projection — **not applicable here**
`streamArrowBatches` *supports* a `columns` projection but callers pass `undefined`. However spectra_data already has only `[spectrum_index, m/z array, intensity array]`, so projecting changes ~nothing. Keep in the back pocket for files that carry extra per-point arrays (S/N, resolution); not worth wiring for the demo corpus.

### 3.6 Format-level (out of scope, noted) 
The truly large win is structural: a server-side **pre-binned ion index** or a downsampled m/z grid so the client downloads kilobytes per channel instead of the full point cloud. That's an mzPeak-format / producer concern, not a client change. Flag for upstream.

---

## 4. Spectrum prefetch cache — status

**It is not active in this app.** `@mzpeak/core` has no scheduler, no background preload, and no per-spectrum LRU. `selectSpectrum` reads on demand (`dispatch.ts` → `readEngineSpectrum`), and `setCacheConfig` was a no-op until `d60fcde` wired it *only* to the new ion-image cache. The previously-stubbed prefetch is **absent**, not merely disabled.

**mzPeakExplorer blueprint (read-only source `~/Claude/mzPeakExplorer`, to port):**

| Piece | File | Behavior |
|---|---|---|
| Two-lane serial scheduler | `src/state/readScheduler.ts` | High lane (user reads) drained before low lane (prefetch); single-flight (reader not reentrant). |
| Background preload | `store.ts` `preloadInBackground()` | Distance-from-selection order; **disabled for remote files**; `350 ms` cooldown after user activity; `setTimeout(0)` yields. |
| LRU cache | `store.ts` `specCache` | `Map<index, SpectrumArrays>`, insertion-order LRU, **stores only `mz`+`intensity`** (+ tiny `id`/`msLevel`/`time`); byte-budget eviction; cache-hit re-inserts (LRU touch). |
| **Memory-based sizing** | `store.ts` `defaultCacheMB()` | `clamp(round(navigator.deviceMemory × 96), 192, 768)` MB. User-overridable via settings / `?cacheMB=`. |
| Interruption | `readScheduler.ts` | **Soft preempt only** — no `AbortSignal` in the vendored reader, so a user read waits for ≤1 in-flight background row-group fetch; generation counter drops stale results. |
| MS-level in prefetch | — | **None** — Explorer preloaded all spectra regardless of MS level. |

---

## 5. Design for the stated requirements

### R1 — "user fetches always override (and interrupt) ongoing spectrum prefetches"
- **Override (queue priority): straightforward** — port Explorer's two-lane scheduler; user `selectSpectrum`/`renderIonImage` jump ahead of prefetch work.
- **Interrupt (hard abort of an in-flight fetch): not currently possible** and this is the adversarial crux. `@zip.js` `HttpReader` → `fetch()` is issued deep in mzpeakts with **no `AbortSignal` threaded through**. Options:
  1. **Bounded soft preempt (Explorer's pragmatic choice):** a user read waits at most *one* in-flight row-group fetch (~46 ms–hundreds of ms). Cheap, no reader change. Usually indistinguishable from true interrupt.
  2. **True interrupt:** thread an `AbortController` from the scheduler into a custom range-reader (replace/extend `HttpReader` so each `readUint8Array` accepts a signal). Real work in the reader boundary; gives instant preemption and lets us *cancel* a half-done prefetch row group. Recommended if we also do parallel prefetch (§3.1/§3.2), because more in-flight requests = more to cancel.
  3. **Chunk the reads:** issue prefetch in smaller byte ranges so the "≤1 in-flight" bound is small by construction.
- **Recommendation:** ship (1) first (low risk, matches Explorer), design toward (2) alongside parallel reads.

### R2 — "cache size based on available memory"
- Port `defaultCacheMB()` (`deviceMemory × 96`, clamp [192, 768] MB). Refine: on Chrome, `performance.memory.jsHeapSizeLimit` is a tighter signal than the coarse `deviceMemory` (which caps at 8 and rounds). 
- **Unify the budget.** Today the ion-image `SpectraArrayCache` uses a *fixed* 768 MB default. The spectrum prefetch cache and the ion cache **hold overlapping data** (both are decoded `mz`+`intensity` keyed by spectrum index). They should be **one shared, memory-sized budget**, not two — otherwise a 310 MB file could hold ~464 MB twice. Concretely: make the ion render populate the *same* per-index store the prefetch/spectrum cache uses, and size that store from memory. This also means the **first ion render warms the spectrum cache and vice-versa**.

### R3 — "store/prefetch m/z + intensity only; no metadata besides MS level; don't prefetch MS2, only MS0/1"
- **Store:** `{ mz: Float64Array, intensity: Float32Array, msLevel: number }` per index — drop `id`/`time`/`representation` from the cached value (metadata table stays in memory and is cheap to read on demand). Matches the requirement and shrinks per-entry overhead.
- **Prefetch scope:** only spectra with `msLevel ∈ {0, 1}`. Read the promoted `MS_1000511_ms_level` column once (already in memory) to build the prefetch worklist. 
  - Imaging: all MS1 → prefetch = all grid spectra (no change, but now it warms both caches).
  - LC/DDA (TMT): skips 67% of spectra → ~3× less prefetch traffic, leaving MS2 to be fetched on demand only when the user actually opens an MS2 scan.
- **Adversarial nuance:** the *ion image itself* still needs every grid spectrum it sums; MS-scoping reduces the *speculative prefetch*, not the ion render's own working set. For imaging these coincide; keep them conceptually separate so an LC ion-image (if ever MS2-targeted) isn't starved by an MS1-only prefetch policy.
- **⚠ Correction after measuring the TMT file (2026-06-15):** the earlier "skips 67% → ~3× less traffic" assumed MS1 profile + MS2 elsewhere. In reality the TMT/DDA demo is **entirely centroided** — *both* MS1 (10,305) and MS2 (21,093) live in **`spectra_peaks`**, with **zero `spectra_data`**. Consequences for an LC prefetch:
  1. The Stage-1/2 bulk path (`streamSpectraDataArrays`, which reads `spectra_data`) yields **nothing** for such files — it's an imaging/profile path. An LC prefetch needs a **separate `spectra_peaks` bulk stream** (`reader.spectrumPeaks().enumerate()`), not yet built.
  2. MS1/MS2 centroids are **interleaved** in `spectra_peaks` row groups (acquisition order), so an MS1-only filter saves **cache memory, not bandwidth** (you still stream the row groups that also hold MS2). A true bandwidth cut would need slow per-spectrum MS1 reads — the anti-pattern.
  3. Net: the LC/DDA prefetch is a larger, lower-certainty piece than the imaging one (and LC files are smaller, so the cold-read pain is milder). **Recommend deferring** unless LC spectrum-navigation latency is a measured pain point; the spectrum LRU read-through (Stage 1) already makes *repeat* LC navigation instant.

### R4 — "ion image computed more efficiently"
Covered in §2/§3: compute is already 47 ms; efficiency = I/O (parallel reads + warm cache), not the kernel.

---

## 6. HTTP/2 & chunking — explicit answers

- **HTTP/2: activated on the CDN.** openssl ALPN negotiates `h2` for `data.mzpeak.org`. Browsers (which offer h2/h3) will use HTTP/2 automatically. **But the app doesn't benefit yet** because reads are serialized in code — HTTP/2's multiplexing only pays off with *concurrent* requests (§3.1). *Action item:* confirm in DevTools (Network → Protocol column = `h2`) in a real session, then add request concurrency.
- **Chunking — three senses:**
  - *HTTP chunked transfer-encoding:* not used, and shouldn't be — range reads return `206` with `Content-Length`. Correct.
  - *Parquet chunking:* the data **is** chunked into row groups + data pages; the reader maps spectrum index → row group/page and range-reads it. Working as intended.
  - *Read-level chunking/parallelism:* **not done** — a large row group is one serial read; multiple row groups aren't fetched in parallel. This is the gap (§3.1).
- *Adversarial check to run in-browser:* verify the CDN/pull-zone actually serves `h2` to the browser for this hostname (custom domains sometimes fall back to http/1.1 if the TLS/SNI config differs). If it's http/1.1 in practice, enabling HTTP/2 on the pull zone is a free prerequisite for the parallel-reads work.

---

## 7. Recommended sequence

1. ✅ **Spectrum prefetch cache** — done (`f62c28b`): memory-sized, shared with the ion cache (R2), stores `mz`+`intensity`+`msLevel` only (R3).
2. ✅ **User reads override prefetch** — done (`c133e2f`): the reader mutex bounds preemption to one in-flight 30 ms slice; activity stamp + 350 ms cooldown back the prefetch off (R1, soft preempt).
3. ◻ **MS0/1-only prefetch worklist** (R3) — partial: the ion-cache prefetch covers all grid cells (imaging = all MS1). An LC/DDA spectrum-LRU prefetch is **not wired and recommended-deferred** — measuring the TMT file showed it's *all centroid in `spectra_peaks`* (no `spectra_data`), so it needs a separate peaks bulk-stream and the MS2-skip is a memory (not bandwidth) saving (see §5 R3 correction). The LRU already stores `msLevel` if/when it's built.
4. ✅ **Background prefetch on open** — done (`c133e2f`): interruptible, time-sliced, warms the ion cache; can't starve foreground (mutex + cooldown).
5. ◻ **Parallel range reads** over HTTP/2 + signal-aware reader for true interrupt (R1 option 2) — **deferred** (Stage 3, operator decision): needs `mzpeakts` submodule changes for modest gain now that Stage 2 hides the latency.
6. ◻ **Confirm HTTP/2 in-browser** (§6) — DevTools Protocol column; the CDN supports `h2` (ALPN) but verify the custom hostname doesn't fall back to http/1.1.
7. ◻ *(Upstream/format)* pre-binned ion index for the worst-case cold render (§3.6).

**Net effect of what shipped (Stages 1–2):** the cold ion-render wait is eliminated (background warm + instant cache hit), repeat spectrum navigation is instant, and memory is bounded by one device-sized budget. The remaining items (3, 5–7) are incremental and can wait.
