# Response — mzPeak corpus conformance issues

**Date:** 2026-08-11
**Responding to:** `CONVERTER-HANDOFF-corpus-issues.md` (2026-08-11)
**Converter:** `mzpeak-convert` v0.7.6 (this is `mzPeakConverter`, not `mzMl2mzPeak` — if you also
file against that project, the findings below may not transfer)

Thank you — this was worth filing. One of the three is a real converter defect, and chasing it
surfaced a fourth defect that neither of us had spotted. The other two need action on your side.

Each conclusion below was verified against the corpus and the spec, and then put through an
independent adversarial review which corrected one of my own premises.

---

## 1. `data_arrays` vs `data arrays` — **no converter change; the spec will be corrected to underscores**

Your diagnosis of the *symptom* is right: a reader matching the token literally cannot resolve the
facet. But the premise that "the spec requires spaces" does not hold, and neither did my first
counter-claim. What is actually true:

| Source | Spelling |
|---|---|
| `schema/mzpeak_index.json` | `data_arrays` — but as `examples`, which constrain nothing |
| Normative CV tables (`index.md` ~1219/1243, `docs/archive/data-kinds.md`, `entity-types.md`) | `data arrays` |
| `docs/schemas/spectra.md:29`, `chromatograms.md:14`, `wavelength-spectra.md:15,38` | `data arrays` |
| `docs/schemas/wavelength-spectra.md:78`, `docs/archive/index-file.md:14` | `wavelength_spectrum` |
| Reference implementation | writes `data_arrays`, **reads both** (explicit serde rename + alias) |

So the specification contradicts itself — `wavelength-spectra.md` uses both spellings in one file —
and nothing machine-checked enforces either. The spec repo ships no validator for these values.

**The spec owner has ruled: underscores are correct.** The specification prose and CV tables will be
corrected to match `schema/mzpeak_index.json` and the reference implementation. The converter's
output is right as it stands and will not change.

**Action for the viewer:** match `data_arrays` / `wavelength_spectrum`. We would also suggest
accepting both spellings, as the reference implementation does — it costs one alias and makes you
robust against archives written against the older prose.

Two corrections to the report for the record: the claimed cause (`rename_all = "snake_case"`) is
wrong — these are deliberate `#[serde(rename = …)]` attributes — and "every spec `.md` uses spaces"
is not accurate, as the table above shows.

## 2. `number_of_peaks` / `number_of_data_points` — **not a defect; reader must branch on `spectrum_representation`**

This is the spec's required behaviour, not an omission. `docs/schemas/spectra.md` states that points
written to `spectra_data.parquet` **MUST** be recorded in `number_of_data_points`, and peaks written
to `spectra_peaks.parquet` **MUST** be recorded in `number_of_peaks`. A **centroid** spectrum
therefore has `number_of_data_points` null *by design*, and a **profile** spectrum has
`number_of_peaks` null.

Checked across the corpus: **zero** spectra have their representation-appropriate count column null.

Your own example file proves the point. In `…MRM_03.mzpeak`, all 40,351,716 peaks belong to the
6,847 **centroid** spectra (`MS:1000127`), every one of which has `number_of_peaks` non-null. The
null-`number_of_peaks` rows are the 16,799 **profile** spectra, which genuinely hold no peaks. Of
those, exactly 9 have `number_of_data_points > 0`, and exactly those 9 have data chunks — a 1:1
match.

**Action for the viewer:** read `spectrum_representation` first, then the corresponding count column.
Gating on `number_of_data_points` alone will report every centroid spectrum as empty.

*(I made the identical mistake while triaging this — reading one count column without its sibling —
so the failure mode is an easy one.)*

## 3. Agilent 6560 NaN mobility — **real defect on our side, fixed; but the drift times were already gone**

Two separate things here.

**The data was not lost by the converter.** `CEMS_10ppm.mzML` contains
`<cvParam accession="MS:1002476" … value="nan"/>` on all 982 scans. The real drift times are absent
from the source file entirely — there is no mobility binary array and no other mobility param. The
loss happened upstream of us, when that mzML was produced from the Agilent `.d`. We have no vendor
`.d` for this dataset, so the values are not recoverable from what the corpus holds. **If you want
usable drift times for this file, it must be reconverted from the original Agilent `.d`.**

**But writing NaN was our defect, and it is fixed in v0.7.6.** Propagating `NaN` into a numeric column
is wrong regardless of provenance: readers gating on `isnull()` see 982 present-but-unusable values,
and NaN poisons any min/max aggregate. Non-finite mobility is now written as `null`, and
`ion_mobility_type` is declared **only when at least one usable value exists** — your point that a
declared IM axis with nothing to plot is worse than no declaration was well taken. Verified on that
file: 982 NaN → 982 null, type no longer declared.

## 4. Not in your report — `lowest_observed_mz` was `+inf` on empty spectra (fixed in v0.7.6)

Found while checking #3. A min over an empty peak list folds to `f64::INFINITY`, and the guard meant
to write null for empty spectra tested `> 0.0` — which `+inf` satisfies. **546 empty centroid spectra
across 4 archives** carried `lowest_observed_mz = +inf` while `highest_observed_mz` on the same rows
was null, so the two bounds of one spectrum disagreed about how to express "absent".

If you aggregate a file-level m/z range by min/max over that column, those four files would have
given you an infinite range. Both bounds now require a finite positive value.

Affected: `general-ms/MSV000096674/ec04479…`, `general-ms/PXD018751/SZB8102938`,
`general-ms/thermo-ltq-xl-iontrap/2013_30_Amrutha…`, `ims-examples/PXD079072/Xinyi3`.

---

## What you need to do

1. **Match `data_arrays` / `wavelength_spectrum`** (underscores), ideally accepting both.
2. **Branch on `spectrum_representation`** before reading a count column.
3. **Re-pull the corpus** once it is reconverted at v0.7.6 — this clears the NaN mobility and the
   `+inf` bounds. Note your validation ran against the S3 `v09` corpus; the local corpus is already
   several releases ahead, so please confirm which build you are testing before filing further.

The `LargeList` / `arrow-js-ffi` note is understood and needs nothing from us.
