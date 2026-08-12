# Converter handoff — mzPeak corpus conformance issues (found via viewer corpus validation)

**Date:** 2026-08-11
**Source:** mzpeakviewer corpus validation against `data.mzpeak.org/v09` (S3 corpus).
**Converter:** `mzMl2mzPeak` (Rust writer).
**How found:** Ran the viewer's real reader/engine over the reconverted corpus. Three writer-side
defects made files either fail to load or silently show no data. The viewer now works around all
three, but the **files themselves are non-conformant / lossy** and should be fixed at the source so
other spec-conforming readers work without per-quirk shims.

Ranked by severity.

---

## 1. CRITICAL — `data_kind`/`entity_type` emitted with underscores, not the spec's spaces

**Every file in the corpus** writes the multi-word controlled tokens with underscores:

```
mzpeak_index.json → files[].data_kind:  "data_arrays"      (should be "data arrays")
                    files[].entity_type: "wavelength_spectrum" (should be "wavelength spectrum")
```

Verified identical across general-ms, imzml, tof-grid, sciex, etc. (all 16 sampled files).

**This contradicts the spec AND the converter's own docs:**
- Spec `mzPeak-specification/schema/mzpeak_index.json` and every spec `.md`: `"data arrays"`, `"wavelength spectrum"` (spaces).
- `mzMl2mzPeak/docs/mzpeak-extension-contract.md` (lines ~106/114): controlled values are
  `data arrays`, `peaks`, `metadata`, … and entity types `spectrum`, `chromatogram`,
  `wavelength spectrum` (spaces).

**Impact:** A spec-conforming reader that matches the controlled vocabulary literally does **not**
resolve the `data arrays` facet → the file opens but shows **zero spectra** (all data is in
`spectra_data.parquet`, which is registered under the unresolvable `"data_arrays"` key). This is the
single defect that broke the whole corpus for us.

**Likely cause:** a `#[derive(Serialize)]` on the `DataKind`/`EntityType` enum with (or defaulting to)
`#[serde(rename_all = "snake_case")]`, which turns the `DataArrays` variant into `"data_arrays"`.

**Fix:** serialize the exact spec strings. Either drop `rename_all` and put explicit renames, e.g.
```rust
#[serde(rename = "data arrays")]        DataArrays,
#[serde(rename = "wavelength spectrum")] WavelengthSpectrum,
```
or a custom Serialize that emits the spec spelling. Single-word tokens (`peaks`, `metadata`,
`scans`, `precursors`, `selected_ions`, `proprietary`, `other`, `spectrum`, `chromatogram`) are
already fine — only the two multi-word ones are wrong. (Note: `selected_ions` is currently underscore
in both spec-extension usage and output, so leave it; the conformance gap is specifically the
core `data arrays` / `wavelength spectrum` tokens.)

---

## 2. MAJOR — `number_of_data_points` / `number_of_peaks` left unpopulated on some exports

**Example:** `tof-grid-examples/MSV000095995/…MRM_03.mzpeak` (SciEX MRM).
- `spectra_metadata.number_of_peaks` = **null** for spectra that *do* have peaks
  (`spectra_peaks.parquet` holds ~40M points).
- `spectra_metadata.number_of_data_points` = 0 for the same rows.

**Impact:** Readers that gate the per-spectrum facet read on these counts (skip the read when the
count is 0/absent) return **zero points** for every spectrum, even though the peak data is present.

**Fix:** populate `number_of_data_points` and `number_of_peaks` per spectrum with the actual
profile-array / centroid-peak counts. If a count is genuinely unknown at write time, prefer omitting
the column entirely over writing a wrong `0` (a present-but-zero count reads as "known empty").

---

## 3. MAJOR — Agilent 6560 DTIMS: `ion_mobility_value` written as all-NaN (mobility data lost)

**Example:** `ims-examples/agilent-6560-dtims-imqtof/CEMS_10ppm.mzpeak`.
- `spectra_metadata_scans.ion_mobility_value` = **NaN for all 982 scans**, while
  `ion_mobility_type` = `MS:1002476` (drift time) *is* set.
- No mobility array in `spectra_data` either.

**Impact:** The file declares ion mobility but carries no usable mobility values, so the viewer has
nothing to plot on the IM axis — the drift-tube dimension is silently dropped. The MS spectra
themselves are fine.

**Fix:** populate `ion_mobility_value` (drift time, per the declared `ion_mobility_type`) for DTIMS
scans. If Agilent 6560 frames encode mobility per-frame, write the frame's drift time into each
scan's `ion_mobility_value`.

---

## Not a converter issue (for context)
- Chunked `spectra_data` with Numpress-Linear mz (`chunk_encoding = MS:1002312`, mz in
  `mz_numpress_linear_bytes`) is correct and decodes fine once #1 is fixed.
- Empty `precursors`/`selected_ions` facets (0-row parquet) are legitimate and handled reader-side.
- The reader-side LargeList/arrow-js-ffi incompatibility is a *reader* fix, not converter — but note
  the metadata schema exposes top-level `LargeList` columns (`parameters`, `auxiliary_arrays`,
  `mz_delta_model`), which trips `arrow-js-ffi@0.4.3` + `apache-arrow@21`. Nothing to change in the
  converter for this; flagged only so you're aware readers need a shim.
