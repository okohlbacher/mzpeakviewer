# mzpeakviewer — Consolidated Backlog

Backlog for the merged app, consolidating both source projects. **Phase work
(Phases 0–6 in ROADMAP.md) is NOT repeated here** — this is the post-parity /
deferred / inherited backlog. Verbatim source backlogs are preserved under
`research/source-backlogs/` for provenance.

Scope guardrail (inherited from mzPeakIV): this is a **format-exploration and
orientation tool**, not a full analysis suite. Statistical/analytical features
(segmentation, classification, co-localization, pre-processing pipelines) are
**out of scope**.

---

## Part A — Merge-specific backlog (new)

### MG-01 · Deep-link extras beyond parity (`ch=` / `roi=` / `px=`)
**Partially DONE (2026-06-16): `ion=` + `ch=` round-trip.** Wired the Ion-image m/z+tol
and RGB channel list through `store.ionRequest` / `store.rgbChannels` ↔ `urlSync`
(`currentShareUrl`/`applyViewState`) ↔ `Imaging.tsx`. The grammar already serialized/
resolved these; this closed a real bug (a rendered ion image was previously NOT
shareable — `ion=` was consumed on load but never emitted). **Still deferred:** `roi=`
and `px=` — they have **no producer UI** in the merged Imaging view (no ROI-draw, no
persistent pixel-pick); those land with the ROI/pixel features under **MG-04**, then the
already-complete grammar parse makes the deep link a one-line wire-up. **Effort:** S (remainder).

### MG-02 · Live address-bar URL sync (toggle) — **DONE (2026-06-16)**
Opt-in "Sync URL" checkbox (default off, persisted in `localStorage` `mzpeak.urlSync`)
next to Share. A single debounced (~400 ms) zustand subscription in `App.tsx` mirrors
`currentShareUrl()` into `history.replaceState` on store changes; compare-before-write
avoids churn; hidden + no-op in Tauri (no meaningful address bar) and for local files.
Carried from Explorer (EX-URL-01).

### MG-03 · Adaptive preload + re-centering — **part (a) DONE (2026-06-16)**
(a) **Done:** the fixed `PREFETCH_COOLDOWN_MS = 350` is now derived from a rolling p75 of
observed user-read latencies (bounded 50-sample ring in `EngineContext`), clamped to
[150, 1000] ms, with the 350 ms default until ≥5 samples. `PrefetchControl.cooldownMs`
became a live getter. (b) **re-centering DEFERRED** — re-centering preload around a moving
cursor requires *random-access* reads, which directly fight the measured bulk-sequential-
stream fast path (see cold-read / ion-image bulk-read findings). Low value too: the
jumped-to spectrum is read on-demand and cached regardless. Revisit only with a measured
need. Carried from Explorer (EX-ENG-03/04).

### MG-04 · Imaging feature-parity validation — **AUDIT DONE (2026-06-16)**
Audit + e2e written: `.planning/MG-04-imaging-parity-audit.md` + `app/e2e/imaging-parity.spec.ts`
(4 cases on wired paths). **Finding: only 2 of 10 IV imaging features are actually wired in
the merged shell** (BL-02 RGB overlay, BL-S3 URL load). The other 8 are NOT-WIRED — the
Part B "implemented" table describes mzPeakIV, not the merge. Migration is split into:

- **MG-04b · wire-up — DONE (2026-06-16):** BL-01 TIC-norm toggle (threads `ticColumn`+`ticNorm`
  into the ion rasterizer), BL-03 "Mean spectrum" button (`engine.meanSpectrum()` → aux panel),
  BL-06 ROI rectangle-drag → `engine.roiSpectrum()` → aux panel, BL-08 centroid peak table
  (top-200-by-intensity, collapsible), BL-09 peak-click → `SpectrumPlot` `onPeakClick` →
  `setIonRequest` + navigate to ion view (auto-render deferred). All UI-only wire-up onto the
  existing engine ops. Verified: peak table + mean-spectrum round-trip headless. **Now also
  unblocks MG-01 `roi=`** (the ROI-draw producer exists).
- **MG-04c · port IV compute/export modules (new code):** BL-04 Gaussian smoothing
  (`smooth.ts`), BL-07 histogram contrast (`histogram.ts`), BL-05 ion-image TIFF export
  (`tiff.ts`) — none ported into the merged repo. Main-thread on cached `store.ionImage`. **Effort:** M.

### MG-05 · SDRF study-metadata long tail
Long-tail characteristics matrix + study protocols + ontology-source registry,
deferred to expanders in Explorer (EX-SDRF-01/02). Lives in Summary ▸ Study.
**Effort:** M.

### MG-06 · Read-only minimal parquet-wasm build (bundle cut)
Once a real mzPeak confirms no internal Parquet compression codecs are needed,
investigate the read-only minimal parquet-wasm build (~456 KB brotli vs ~6.5 MB) for
a large bundle-size win. Carried from mzPeakIV "Stack Patterns". **Effort:** M; risk:
needs codec audit against real files.

### MG-07 · Surface spectrum representation (profile / centroid) more prominently — **DONE (2026-06-16)**
(a) The Spectra header now renders representation as a distinct profile/centroid **pill**
(`data-testid="spectrum-representation"`), removed from the trailing `·`-token line.
(b) Added a per-MS-level "MS levels" panel to Summary (`data-testid="summary-ms-levels"`):
one row per level with spectra count + a representation-mode badge (profile / centroid /
mixed at a 90 % dominance threshold). Required a new **engine aggregate** —
`FileStats.representationPerLevel` (optional, backward-compatible) computed in
`scanByColumns` (the global `representationCounts` loop now also buckets per MS level) and
threaded through `scanBreakdown`. Older/IV data lacking the field falls back to count-only
rows.

### MG-08 · Align deep-link URLs / API with USI — **EMIT DONE (2026-06-16); input deferred**
Done: (1) **native-scan→index resolver** (`app/src/scan.ts`) backing both the picker and a
correct `?scan=N` deep link; (2) the pure **`usi.ts` parse/build grammar** in `@mzpeak/contracts`
(+ 5 unit tests) — `mzspec:<collection>:<msRun>:<scan|index|nativeId>:<value>`; (3) a **"Copy USI"**
affordance (`currentUsi()` in urlSync + button by Share) emitting a citeable USI: collection
derived from the source URL's PXD/MSV accession when present (else the PSI `USI000000`
placeholder for local/unsubmitted data), msRun from the filename, and the scan number (via the
resolver) or absolute index. Verified: `mzspec:PXD011799:…fr8:scan:121` for the TMT demo.

**Deferred — USI as *input* (locate the file from a USI).** Resolving `collection`/`msRun` → a
dataset URL needs an online ProteomeXchange/PRIDE lookup, which breaks the client-side-only
invariant and doesn't work for local files; `mzpeak_index.json` carries no accession to source
it offline. Selector resolution (`:scan:`/`:index:`/`:nativeId:` → spectrum) is ready via the
resolver once a file is open, but file *discovery* from a USI is the blocked part — revisit if/when
an online resolver is acceptable. **Effort (remainder):** M.

### MG-09 · About button with version / build info — **DONE (2026-06-16)**
Top-bar About button (`data-testid="about-btn"`) → dismissible popover showing version
(from `tauri.conf.json`, `0.5.3`), git SHA, build date, and platform (web/desktop), plus a
releases link. Build info injected via Vite `define` (`__APP_VERSION__`/`__BUILD_SHA__`/
`__BUILD_DATE__`); SHA falls back to `"dev"` when git is unavailable. ~~Original ask:~~
Add an "About" affordance (e.g. a button in the top bar or a footer item) surfacing the
app **version** and **build** — at minimum the app version (Tauri `tauri.conf.json` /
package version), ideally the git **commit SHA** + **build date**, and the platform (web
vs desktop). Today nothing in the UI reports which build the user is running, which made
the "stale `mzpeak.org/view`" confusion hard to diagnose — an About box would have shown
the running version at a glance. Wire the version/SHA/date in at build time (Vite
`define` / `import.meta.env` for the web build; Tauri exposes its own version for the
desktop app). Small modal or popover; include a link to the repo / releases. **Effort:** S.

---

## Part B — Inherited from mzPeakIV (imaging features)

Source (verbatim, with full implementation notes):
`research/source-backlogs/mzPeakIV-BACKLOG.md`. **Status:** BL-01…BL-09 are
**implemented in mzPeakIV**. ⚠️ The table below is the **mzPeakIV** status, NOT the merged
shell — the MG-04 audit (2026-06-16) found **only BL-02 + BL-S3 are wired in the merge**;
the other 8 are unported (tracked as **MG-04b** wire-up / **MG-04c** module-port). Treat the
"implemented" column as "exists in mzPeakIV source", not "available in the viewer".

| ID | Feature | Status in mzPeakIV |
|---|---|---|
| BL-01 | TIC normalization (default render mode) | implemented (`compute`/rasteriser) |
| BL-02 | Multi-ion channel overlay (1/2/3 ch, RGB) | implemented (`renderMultiChannel`) |
| BL-03 | Mean / reference spectrum | implemented (`meanSpectrum`) |
| BL-04 | Gaussian 2D image smoothing | implemented (`src/compute/smooth.ts`) |
| BL-05 | Ion image export as TIFF | implemented (`src/export/tiff.ts`) |
| BL-06 | ROI rectangle → mean spectrum | implemented (`roiSpectrum`) |
| BL-07 | Contrast enhancement (histogram-based) | implemented (`src/compute/histogram.ts`) |
| BL-08 | Peak table panel (centroid spectra) | implemented (`src/ui/App.tsx`) |
| BL-09 | Spectrum-peak click → ion image | implemented (`src/ui/SpectrumPanel.tsx`) |
| BL-S3 | Load datasets from `s3://` URLs | implemented (now via `data.mzpeak.org` CDN) |
| BL-CORS | Demo-bucket CORS / public-read | ops, not app code — carry the requirement |

**Cross-project note (carried):** the `imzML2mzPeak` converter should pre-compute a
per-pixel TIC column for future datasets where multiple spectra share a pixel
coordinate (separate project's backlog).

**Explicitly out of scope (from mzPeakIV):** segmentation, classification,
co-localization, statistical pipelines, pre-processing — not added to this viewer.

---

## Part C — Inherited from mzPeakExplorer (future-work)

Source (extracted): `research/source-backlogs/mzPeakExplorer-future-work.md`.

| ID | Item | Disposition in the merge |
|---|---|---|
| EX-ENG-01 | No in-flight abort | **resolved** by ENG-04 (per-message cancellation in `@mzpeak/core`) |
| EX-ENG-02 | Scheduler gates signal reads only | Phase 3 makes all reads message-mediated (uniform gating) |
| EX-ENG-03 | Preload order captured once | → MG-03 |
| EX-ENG-04 | Fixed preload cooldown | → MG-03 |
| EX-URL-01 | Live address-bar sync deferred | → MG-02 |
| EX-URL-02 | On-the-fly chromatograms (history) | superseded by unified grammar (Phase 1/5) |
| EX-SDRF-01 | Long-tail characteristics matrix | → MG-05 |
| EX-SDRF-02 | Study protocols / ontology registry | → MG-05 |

---

## Provenance
- Full mzPeakIV backlog (Tier 1/2 + infra + out-of-scope): `research/source-backlogs/mzPeakIV-BACKLOG.md`
- Extracted mzPeakExplorer future-work: `research/source-backlogs/mzPeakExplorer-future-work.md`
