# Converter handoff — exact timsTOF TOF→m/z calibration now in the archive (`vendor_mz_calibration`)

**Date:** 2026-09-02
**Converter:** `mzPeakConverter` (Rust, `mzpeak-convert`), unreleased after v0.9.2
**Scope:** Bruker timsTOF (TDF) ims-compact archives — native (timsrust) and `--bruker-sdk` lanes.
**Nature:** ADDITIVE. `ims_calibration` (`codec`, `mz_from_tof`, `tof_encoding`, `a`, `b`) is
unchanged and remains the reconstruction contract; the pinned strings did not move.

## Why

`ims_calibration.a/b` is timsrust's two-point chord through (`MzAcqRangeLower`, tof 0) and
(`MzAcqRangeUpper`, `DigitizerNumSamples`). speXtract measured it at **−5…−11 ppm** (m/z
dependent) against Bruker's timsdata SDK. The vendor's exact ModelType-1 model was only reachable
through the embedded `vendor/analysis.tdf.gz`, and `--no-vendor` archives lost it entirely. Now the
archive is self-sufficient.

## New keys

### 1. Index block `metadata.vendor_mz_calibration`

```json
{
  "source": "analysis.tdf",
  "mz_calibration": [ { "Id": 1, "ModelType": 1, "DigitizerTimebase": 0.125, "DigitizerDelay": 26464.125,
                        "T1": 25.6148127740566, "T2": 25.1594285616696, "dC1": 20.0, "dC2": 0.0,
                        "C0": 1008.59723408404, "C1": 154314.98518964, "C2": 0.0, "C3": 0.0, "C4": 0.0 } ],
  "global_metadata": { "DigitizerNumSamples": 636031, "MzAcqRangeLower": 99.993933, "MzAcqRangeUpper": 1700.0 },
  "per_frame_columns": [ "<prefix>_tdf_t1", "<prefix>_tdf_t2", "<prefix>_tdf_mz_calibration_id" ],
  "per_frame_columns_note": "...",
  "model_type_1": "t_ns = tof*DigitizerTimebase + DigitizerDelay; C1_eff = C1*(1 + dC1*(T1 - tdf_t1)/1e6); t_ns = C0 + (1e6/sqrt(C1_eff))*sqrt(mz) + C2*mz, solve for sqrt(mz) (C2 = 0: mz = ((t_ns - C0)*sqrt(C1_eff)/1e6)^2)",
  "model_type_1_verified": "2.5e-5 ppm vs Bruker timsdata SDK (speXtract v0.2.0); dC2 = 0 on every file seen, T2 role unverified"
}
```

`mz_calibration` holds **every** `MzCalibration` row, all columns verbatim (a run can reference
more than one row; future schema columns ride along). Values above are PXD059079
`…_2485.d`. Like `ims_calibration`, the value may arrive as an inlined object or a JSON string.

### 2. Three per-spectrum `spectra_metadata` columns

| suffix | source | type | role |
|---|---|---|---|
| `_tdf_t1` | `Frames.T1` | Float64 | per-frame digitizer temperature → `C1_eff` (drifts within a run: 3 mK ≈ 0.06 ppm on 2485.d, ~30 mK ≈ 0.7 ppm on speXtract's runs) |
| `_tdf_t2` | `Frames.T2` | Float64 | carried verbatim; enters via `dC2`, which is 0 on every file seen |
| `_tdf_mz_calibration_id` | `Frames.MzCalibration` | Int64 | selects the `mz_calibration` row by `Id` |

Match by **suffix**, as `spectrum.ts` already does for `_tof_c0`/`_tof_c1` — the prefix is the
same local-CURIE convention (`opt_MS_4000903_…`); `per_frame_columns` carries the exact names.
Columns are null on a TDF whose `Frames` table lacks them.

## Reader recipe (optional; ModelType 1 only)

```ts
const row = cal.mz_calibration.find(r => r.Id === tdf_mz_calibration_id);   // fall back to ims_calibration if !row || row.ModelType !== 1
const t  = tof * row.DigitizerTimebase + row.DigitizerDelay;
const c1 = row.C1 * (1 + row.dC1 * (row.T1 - tdf_t1) / 1e6);
const b  = 1e6 / Math.sqrt(c1);
let u: number;
if (row.C2 === 0) u = (t - row.C0) / b;
else { const disc = b * b - 4 * row.C2 * (row.C0 - t); u = (-b + Math.sqrt(Math.max(disc, 0))) / (2 * row.C2); }
const mz = u * u;
```

Dropping `C2·mz` costs −11…−40 ppm where `C2 ≠ 0`; dropping the temperature term up to ~0.7 ppm.
Measured on PXD059079 2485.d (`C2 = 0`): chord − exact runs from +3.2 ppm at tof 0 to −4.2 ppm at the
top of the range; per-frame values in the archive are bit-identical to `analysis.tdf`.
Nothing breaks if you ignore all of this — `ims_calibration` reconstructs exactly as before.

## Where

- Converter: `src/bruker_native.rs` (`vendor_mz_calibration`, `add_frame_calibration_params`),
  `src/main.rs` (`write_ims_compact_archive_impl`), CHANGELOG `[Unreleased]`,
  `docs/mzpeakviewer-compliance-reply.md` addendum.
- Formula provenance: speXtract v0.2.0 `tests/test_calibration.py` (60 SDK golden points).
