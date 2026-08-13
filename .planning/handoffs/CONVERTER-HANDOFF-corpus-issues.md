# Converter handoff — mzPeak corpus conformance issues

**Updated:** 2026-08-12 (re-verified against the re-synced `v09` corpus).
**Converter:** `mzML2mzPeak` (Rust writer).
**Source:** mzpeakviewer corpus validation over HTTP range reads against
`data.mzpeak.org/v09` (= `object.storage.eu01.onstackit.cloud/v09`).

All items below were re-checked on the current (re-synced) files and **still reproduce**.

---

## ⚠️ First — the "Mouse Bladder demo times out" report is NOT convert-side

The bladder file is fine. The 180s timeout was a **viewer bug**, now fixed in **viewer v0.8.0**:
the engine looked up the imaging TIC and pixel-position columns by their *nested-format* names,
missed on the flat corpus, and fell back to an O(pixel-count) per-record read (383s for the
34,840-pixel grid). v0.8.0 resolves both nested and flat names → the same file opens in ~10s.
**Re-uploading the bladder file will not help and can stop** — it was never the problem.

---

## 1. CRITICAL — `data_kind`/`entity_type` written with underscores, not the spec's spaces

Confirmed on the re-synced corpus (every file):
```
mzpeak_index.json → data_kind: "data_arrays"        (spec: "data arrays")
                    entity_type: "wavelength_spectrum" (spec: "wavelength spectrum")
```
The spec (`mzPeak-specification/schema/mzpeak_index.json` + all spec `.md`) and the converter's
own `docs/mzpeak-extension-contract.md` use **spaces** for the multi-word core tokens.

**Impact:** a spec-conforming reader that matches the controlled vocabulary literally can't
resolve the `data arrays` facet → the file opens but shows **zero spectra**. (The viewer now
normalizes `_`↔` ` as a workaround, but the files are non-conformant.)

**Likely cause:** serde `rename_all = "snake_case"` on the `DataKind`/`EntityType` enum turning
`DataArrays` → `"data_arrays"`. **Fix:** emit the spec strings, e.g.
`#[serde(rename = "data arrays")]` / `#[serde(rename = "wavelength spectrum")]`. Single-word
tokens (`peaks`, `metadata`, `scans`, `precursors`, `selected_ions`, …) are already fine.

---

## 2. MAJOR — `number_of_peaks` / `number_of_data_points` left null on some exports

Confirmed: `tof-grid-examples/MSV000095995/…MRM_03.mzpeak` — `number_of_peaks` is **null for
16,799 of 23,646 spectra**, yet those spectra have peaks in `spectra_peaks`.

**Impact:** a reader that gates the per-spectrum facet read on the count returns **zero points**
for those spectra. (The viewer now treats null as "unknown, attempt the read" as a workaround.)

**Fix:** populate `number_of_data_points` / `number_of_peaks` with the real array/peak counts.
If a count is genuinely unknown at write time, omit the column rather than writing `null`/`0`.

---

## 3. MAJOR — Agilent 6560 DTIMS: `ion_mobility_value` written as all-NaN (mobility lost)

Confirmed: `ims-examples/agilent-6560-dtims-imqtof/CEMS_10ppm.mzpeak` — **0 of 982 scans** carry
a non-NaN `ion_mobility_value`, though `ion_mobility_type = MS:1002476` (drift time) is set. No
mobility array in `spectra_data` either.

**Impact:** the file declares ion mobility but carries no usable values, so the IM axis is
silently dropped. (By contrast, the Bruker timsTOF PASEF files DO carry per-peak 1/K0 and the
viewer displays them — so this is specific to the Agilent 6560 DTIMS path.)

**Fix:** populate `ion_mobility_value` (drift time) for DTIMS scans.

---

## 4. NEW — `chromatograms_data` has a ragged/sparse `ms_level` column

`general-ms/MSV000090203/FM_01_Pos.mzpeak` (1.1 GB): extracting chromatograms throws
`Not all arrays are the same length: 452144,452144,452144,26160 for
chromatogram_index,time,intensity,ms_level`. The `ms_level` column resolves to a different
length than its siblings when read, breaking equal-length array assembly.

**Impact:** chromatogram extraction fails for this file (its spectra read fine).

**Needs attribution:** either the writer emits `ms_level` as a sparse/optional column that isn't
present (or is a different length) across all row groups of `chromatograms_data`, or it's a
reader null-handling gap. Please check whether `ms_level` is written for every chromatogram row
(dense, same length as `time`/`intensity`) — a per-row-group schema/length inconsistency would
explain it. If `ms_level` is meant to be optional per-row, it should be a nullable column of the
full length, not a shorter one.

---

## Not a converter issue (for context)
- Chunked `spectra_data` with Numpress-Linear mz (`chunk_encoding = MS:1002312`) decodes fine.
- Empty `precursors`/`selected_ions` facets (0-row Parquet) are legitimate; handled reader-side.
- Metadata exposes top-level `LargeList` columns (`parameters`, `auxiliary_arrays`,
  `mz_delta_model`), which trips `arrow-js-ffi@0.4.3` + `apache-arrow@21`; handled reader-side.
