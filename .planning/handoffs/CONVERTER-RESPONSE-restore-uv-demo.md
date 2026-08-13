# Response — restore a UV/VIS demo dataset

**Date:** 2026-08-12
**Responding to:** `CONVERTER-HANDOFF-restore-uv-demo.md` (2026-08-12)
**Converter:** `mzpeak-convert` 0.7.7

Short version: **the dataset was never deleted — it moved**, and it is now restored as a proper
`general-ms` dataset. Separately, **your fallback candidate is not broken either**, which means the
UV/VIS tab is almost certainly a reader bug rather than a data gap. Details and a concrete lead below.

---

## 1. The Waters PDA dataset — restored

The flat-format reorg relocated `QC_LCMS2-2_23_268-1-1.mzpeak` into the ProteoWizard tile; what was
left behind in `general-ms/waters-pda-uv/` was a descriptor stub with `files: []` and an empty
directory. That is why the old URL 404s and why it looked like data loss.

It is now a first-class dataset again, source included:

```
data/general-ms/waters-pda-uv/
  QC_LCMS2-2_23_268-1-1.mzML       85,079 B   (source, upstream URL recorded in the descriptor)
  QC_LCMS2-2_23_268-1-1.mzpeak    211,391 B   (built with 0.7.7)
  waters-pda-uv.yaml
```

**Content — verified, not assumed.** 8 wavelength spectra, 1,528 points, 209.95–399.95 nm,
`electromagnetic radiation` (absorption) intensities. `number_of_data_points` is 191 per spectrum,
`lambda_max`, `lowest/highest_observed_wavelength` all populated. **mzPeakValidator 0.9.16: PASS,
0 errors, 0 warnings.**

## 2. Your Agilent fallback is fine too — the empty plot is reader-side

You ruled out
`pwiz-examples/Agilent/.../TOFsulfasMS4GHzDualMode+DADSpectra+UVSignal272-NoProfile.mzpeak` because
the viewer throws `Cannot read properties of null (reading 'get')` and renders an empty plot. That
file actually contains:

- **520 wavelength spectra, 49,920 points**, 210–400 nm, 96 points each,
- `number_of_data_points` populated on every row.

Two independent, well-formed UV datasets both rendering empty points at the viewer's UV path, not at
the data. A null-deref on `.get` suggests you are reaching for a facet or column that moved in the
**v0.7 split-facet layout**. Here is exactly what the UV facets look like, from the restored file:

| Member | `entity_type` | `data_kind` |
|---|---|---|
| `wavelength_spectra_metadata.parquet` | `wavelength_spectrum` | `metadata` |
| `wavelength_spectra_metadata_scans.parquet` | `wavelength_spectrum` | `scans` |
| `wavelength_spectra_data.parquet` | `wavelength_spectrum` | `data_arrays` |

- `wavelength_spectra_metadata` — one row per spectrum, keyed by **`index`**; carries `id`, `time`,
  `number_of_data_points`, `lowest_observed_wavelength`, `highest_observed_wavelength`, `lambda_max`.
- `wavelength_spectra_metadata_scans` — joined by **`source_index`** (not `index`).
- `wavelength_spectra_data` — a single top-level `point` struct whose children are
  **`wavelength_spectrum_index`, `wavelength`, `intensity`**. Note the join column is
  `wavelength_spectrum_index`, *not* `spectrum_index`.

Two traps worth checking against your reader:

1. **The tokens are underscored.** `data_kind: "data_arrays"`, `entity_type: "wavelength_spectrum"` —
   spaces will not resolve. This was genuinely ambiguous in the spec; it is now settled in favour of
   underscores and normalized spec-side (HUPO-PSI/mzPeak-specification#18, merged). If you still have
   the space-spelled strings anywhere from the earlier report, that alone would produce a null facet
   and exactly this error.
2. **Counts split by representation.** `number_of_data_points` is for profile data; centroid spectra
   record `number_of_peaks` instead and leave the other null. Gating a facet read on the wrong one
   reports a populated spectrum as empty.

If you fix the UV path, you get **two** demo candidates rather than none.

## 3. What is *not* done: publishing to `data.mzpeak.org/v09`

The one thing your handoff actually asks for — a stable public URL — I have deliberately not done.
Publishing a converted `.mzpeak` to the website distribution corpus is covered by a standing
"no converted mzPeak to S3" rule from the corpus owner, reaffirmed today. A request in a handoff
document is not authorization to override it, so the decision sits with the owner.

Both candidate URLs currently 404, so there is no existing object to repoint at:

```
404  https://data.mzpeak.org/v09/general-ms/waters-pda-uv/QC_LCMS2-2_23_268-1-1.mzpeak
404  https://data.mzpeak.org/v09/pwiz-examples/Waters/Waters/Reader_Waters_Test.data/QC_LCMS2-2_23_268-1-1.mzpeak
```

**What you can do now, without waiting:** the archive is 211 KB and sitting in the corpus repo — load
it locally and fix the UV/VIS tab against it. That is the blocking work either way, since a published
URL will render just as empty until the reader bug is fixed.

**When the publish decision is made**, the file is ready to go as-is and the URL will be
`https://data.mzpeak.org/v09/general-ms/waters-pda-uv/QC_LCMS2-2_23_268-1-1.mzpeak`. I will send it
when it exists — do not re-add the demo card against that URL before then.

## Summary

| Item | Status |
|---|---|
| Waters PDA dataset restored to `general-ms` with source + descriptor | done, validates PASS |
| Content confirmed (8 spectra, 209.95–399.95 nm, 1,528 points) | done |
| Corpus description updated with re-fetchable upstream URL | done |
| Agilent fallback investigated | **not broken** — 520 spectra, 49,920 points |
| Viewer UV/VIS tab | **reader bug** — see the schema and two traps above |
| Public S3 URL | **pending owner decision**, not published |
