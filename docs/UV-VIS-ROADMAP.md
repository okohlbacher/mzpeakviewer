# UV/VIS (wavelength_spectra) support — implementation roadmap

## Goal
Render `wavelength_spectra*` (UV/PDA/DAD optical) data in mzPeak Viewer. **Primary requirement:** the
Spectrum tab gains **subtabs (MS · UV/VIS) shown _only_ when more than one spectrum type is present**
(MS-only → no subtabs, as today; UV-only → UV view, no subtabs; both → subtabs).

## Ground truth (from spec + the real Waters PDA file)
- `wavelength_spectra_data.parquet`: long/tidy `point<wavelength_spectrum_index:uint64,
  wavelength:f32 (nm, MS:1000617, UO nanometer), intensity:f32 (MS:1000515)>`. **One wavelength per
  row** → group by `wavelength_spectrum_index`.
- `wavelength_spectra_metadata.parquet`: `spectrum` + `scan` facets. `MS:1000559_spectrum_type` =
  **MS:1000804** (electromagnetic radiation spectrum); `spectrum.time` in **minutes**; `MS:1003812`
  λmax; `MS:1000618/1000619` highest/lowest observed wavelength; scan windows (nm).
- Real file: 8 spectra × 191 pts, **209.95–399.95 nm @ 1 nm**, **intensities are _signed integer
  counts_** (MS:1000131, baseline-subtracted — NOT absorbance AU, can be negative). Native id
  `function=3 process=0 scan=N`. file_description declares both MS:1000579 and MS:1000804.
- The mzpeakts reader **already** exposes `wavelengthMetadata`, `numWavelengthSpectra`,
  `getWavelengthSpectrum(index)`, `wavelengthSpectrumData()`. Engine + UI layers do not use them yet.

## Design decisions
1. **Reuse `SpectrumArrays`** for a wavelength spectrum: map `wavelength → mz` slot, `intensity →
   intensity` slot, plus a `domain: "mz" | "wavelength"` discriminator and unit metadata. Avoids a
   parallel type and lets `SpectrumPlot` render both. (Alternative: a separate `WavelengthSpectrum`
   type — rejected as duplication; the arrays are structurally identical Float arrays.)
2. **Capability detection**: extend the capability model with `wavelength: { present: boolean; count:
   number }` computed at open time from `reader.numWavelengthSpectra`. The MS-present flag is
   `stats.numSpectra > 0`. "More than one type present" ⇔ `msPresent && wavelengthPresent`.
3. **Adaptive spectrum renderer** (research-backed): pick rendering by point count —
   ≥10 points → continuous **line** (UV is smooth/dense); 2–9 → **markers + dimmed connector**;
   1 → single **labeled stem**. Never line-interpolate <10 spectral points. MS keeps its
   profile=line / centroid=stick behavior. Implemented as a `mode` on `SpectrumPlot`.
4. **Axis/units**: UV/VIS view → x = "Wavelength (nm)", y = "Intensity (counts)" (label from the
   array unit CURIE; show "Absorbance (AU)" when the unit is absorbance). MS view unchanged.
5. **Subtab UX**: subtabs render _inside_ the Spectra view (segmented control at top:
   `MS | UV/VIS`), not as new sidebar entries — keeps the sidebar stable and matches "Spectrum tab
   contains subtabs". A `spectraDomain: "ms" | "uv"` store field drives it; default to MS when both
   exist, UV when UV-only.
6. **Independent navigation**: UV/VIS subtab has its own spectrum picker (by index / retention time),
   λmax + observed-range readout, mirroring the MS picker.

## Phased plan
**P0 — data + capability (engine/contracts/store), no UI yet**
- contracts: add `domain`/unit fields to `SpectrumArrays`; add `WavelengthCapability`; add
  `wavelengthBrowse` (index/id/time/λmax) to the browse model.
- core/engine: `readWavelengthSpectrum(index)` wrapping mzpeakts `getWavelengthSpectrum`; wavelength
  browse-index builder; capability probe in `open.ts`; worker dispatch routes
  `selectWavelengthSpectrum`/`wavelengthBrowse`.
- store: `wavelengthBrowse`, `wavelengthSpectrum`, `hasWavelength`, `spectraDomain`,
  `selectWavelengthSpectrum(index)`.

**P1 — Spectrum tab subtabs + UV/VIS view (the explicit requirement)**
- Spectra.tsx: segmented `MS | UV/VIS` control rendered **only when `msPresent &&
  wavelengthPresent`**; UV/VIS panel = SpectrumPlot (adaptive mode) + picker + λmax/range readout +
  per-spectrum metadata.
- SpectrumPlot: add `mode: "auto" | "line" | "stem"` + domain-aware axis labels; auto picks
  line/stem by point count.
- Sidebar label: keep single "Spectra" entry; if UV-only, the lone subtab is UV (no MS tab).

**P2 — PDA richer views (roadmap; implement TIC-analog + extracted-λ if time permits)**
- Max-plot (max intensity across λ per time) + single-wavelength extracted chromatogram (links to
  the existing Chromatograms machinery) + spectrum⇄chromatogram linking.
- 2D heatmap (time × wavelength, viridis, dedicated canvas) — deferred (separate canvas pipeline,
  only meaningful for ≥~4 wavelengths; LTTB for long traces).

## Verification
- Typecheck + build (`npm run typecheck`, `VITE_BASE=/view/ npm run build`).
- Live/preview: open the Waters PDA demo (need a demo entry or `?file=` deep-link to
  `…/waters-pda-uv/QC_LCMS2-2_23_268-1-1.mzpeak`): assert subtabs appear (both MS+UV present),
  UV/VIS renders the 191-pt line spectrum with correct nm axis + λmax, MS subtab still works; assert
  an MS-only file shows **no** subtabs (regression).
- Add a demo dataset entry for the Waters PDA file so it's testable from the start page.

## Risks / open questions (for adversarial review)
- Reusing SpectrumArrays vs separate type — discriminator leakage into MS code paths.
- Signed/zero intensities + baseline (auto-range must include negatives; first scan is all-zero).
- Worker contract additions must stay backward-compatible (don't break MS-only path / caches).
- "More than one type" semantics: is chromatograms-only-with-UV a case? (UV present, MS absent → UV
  only, no subtabs.)
- Picker by retention time when first PDA scan is empty/zero.

---
## v2 — post-adversarial-review decisions (vibe + codex)
- **Separate type** `WavelengthSpectrumArrays` (NOT mz-reuse). MS `SpectrumArrays` untouched. Adapt
  both to a domain-neutral plot input at the SpectrumPlot boundary.
- Subtab semantics formalized: MS-only→MS (no control); UV-only→UV (no control); both→`MS|UV`;
  chromatograms never count; reset `spectraDomain` to a valid value on every file open.
- Worker: ADD `selectWavelengthSpectrum`/`wavelengthBrowse` only; mirror MS error/cancel/bounds;
  MS path byte-for-byte unchanged.
- Signed intensity: y-domain ⊇ {0, min, max}; draw zero baseline; never log; all-zero→"no signal".
- Units: read array unit CURIE; map (MS:1000131→"counts", absorbance CV→"AU", else "Intensity").
- Rendering: sort by wavelength; line when dense+monotonic, markers when sparse/irregular, stem for
  1 pt; break line across gaps > k×median spacing.
- λmax/observed-range optional: prefer metadata, validate vs array min/max, else compute; skip for
  all-zero.
- uint64 indices: select by zero-based array position; treat native ids as opaque strings.
- Lazy browse + LRU cache for selected wavelength spectra (don't materialize all).
- Verify all four gating cases (both / MS-only / UV-only / neither) + a11y radio semantics.
