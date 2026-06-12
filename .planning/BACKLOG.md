# mzpeak-viewer — Consolidated Backlog

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
Multi-channel (`ch=`, repeatable), ROI (`roi=x0,y0,x1,y1`), and pixel-by-coord
(`px=x,y`) deep links — designed in MERGE-ROADMAP.md §3 but optional for v1
(roadmap "Phase 7"). Fold into Phase 5 or defer. **Effort:** S–M.

### MG-02 · Live address-bar URL sync (toggle)
Auto-write the share URL to the address bar as the user navigates (default off;
opt-in toggle). Carried from Explorer (EX-URL-01). Belongs after Phase 5.
**Effort:** S.

### MG-03 · Adaptive preload + re-centering
Derive `PRELOAD_COOLDOWN_MS` from observed read-latency percentiles; re-center
preload on the live selection when resuming after a jump. Carried from Explorer
(EX-ENG-03/04). Best done once the engine is in the worker (Phase 3+). **Effort:** S.

### MG-04 · Imaging feature-parity validation
The IV imaging features (Part B, BL-01…BL-09) are implemented in mzPeakIV and must
reach **parity** in the merged shell (Phase 4 wires them behind the MSI accordion +
lazy chunk). This item tracks an explicit parity checklist + e2e per feature, so no
imaging capability silently regresses in the merge. **Effort:** M (validation).

### MG-05 · SDRF study-metadata long tail
Long-tail characteristics matrix + study protocols + ontology-source registry,
deferred to expanders in Explorer (EX-SDRF-01/02). Lives in Summary ▸ Study.
**Effort:** M.

### MG-06 · Read-only minimal parquet-wasm build (bundle cut)
Once a real mzPeak confirms no internal Parquet compression codecs are needed,
investigate the read-only minimal parquet-wasm build (~456 KB brotli vs ~6.5 MB) for
a large bundle-size win. Carried from mzPeakIV "Stack Patterns". **Effort:** M; risk:
needs codec audit against real files.

---

## Part B — Inherited from mzPeakIV (imaging features)

Source (verbatim, with full implementation notes):
`research/source-backlogs/mzPeakIV-BACKLOG.md`. **Status:** BL-01…BL-09 are
**implemented in mzPeakIV** — for the merged app they are a **parity list** (see
MG-04), not pending work. Listed here so nothing is lost and parity is auditable.

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
