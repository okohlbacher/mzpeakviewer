# Converter handoff — sdrf-examples shipped WITHOUT their SDRF sample annotations

**Date:** 2026-08-17
**Converter:** `mzML2mzPeak` (which has the SDRF embed feature — `src/sdrf/embed.rs`)
**Found by:** viewer check "do any SDRF TMT examples display reporter channels?" — none do.

## Finding

Every file under `v09/sdrf-examples/` was (re)converted **without** its SDRF sample metadata.
Verified via range reads on all five:

| File | `sample_list` | `sample_metadata.member` | embedded SDRF member |
|---|---|---|---|
| MTBLS1129/menLCCstage2_295 | `[]` | absent | none |
| PXD009465/t04176_EH_Malaria_…_SCX2 | `[]` | absent | none |
| **PXD011799/…TiO2_TMT_fr9** (TMT!) | `[]` | absent | none |
| PXD014145/MFA381 | `[]` | absent | none |
| PXD020187/D2_Nat_2 | `[]` | absent | none |

(Also: `general-ms/thermo-fusion-lumos/01_CPTAC_TMTS1…` — a TMT run — carries only the
vendor-default stub `sample_list: [{id:"1", name:"1", parameters:[]}]`, no labels.)

The archives contain ONLY parquet facets + `mzpeak_index.json` — no `.sdrf.tsv` member,
no `metadata.sample_metadata.member` reference, `metadata.sample_list` empty.

## Impact

The whole point of the sdrf-examples tile is invisible in the viewer:
- **No reporter-channel pills on MS2 spectra** (TMT channels with per-channel intensity).
- No Study panel sample table, no SDRF table.

The viewer's pipeline is intact and now pinned by a canonical test
(`packages/core/src/engine/studyMeta.test.ts`): given a populated `sample_list` whose entries
carry an **MS:1002602 "sample label"** parameter (e.g. `TMT126`), it projects channels,
resolves reporter m/z from its reagent table, honours `run_sample_binding.sample_ids`, and the
Spectra view renders the channel pills on MS2 spectra. It projects **only** what the file
declares — there is deliberately no viewer-side SDRF-TSV parser fallback for channels.

## What the viewer consumes (the contract)

In `mzpeak_index.json → metadata`:

```jsonc
"sample_list": [
  { "id": "s1", "name": "<sample name from SDRF source name>",
    "parameters": [
      { "accession": "MS:1002602", "name": "sample label", "value": "TMT126" }
      // optional: a reporter-m/z param; otherwise the viewer's reagent table supplies it
    ] },
  …one entry per channel…
],
"run_sample_binding": { "sample_ids": ["s1", …] },   // which samples this run carries
"sample_metadata": { "member": "<archive path of the embedded .sdrf.tsv>" }  // for the Study panel table
```

plus the SDRF TSV itself as an archive member (any non-parquet name; the viewer reads it via
`sample_metadata.member`).

## Ask

Re-convert (or post-process) the five `sdrf-examples` **with SDRF embedding enabled**, sourcing
each study's SDRF file (they are PRIDE/MetaboLights studies with published SDRF). Priority:
**PXD011799** (TMT11 — the demo where channel pills actually light up on MS2) and PXD020187 /
PXD014145 if labeled; label-free studies (MTBLS1129, PXD009465?) still benefit from the sample
table + `sample_metadata.member` even without isobaric labels.

Then the usual publish flow to `v09/sdrf-examples/` (owner sign-off per the standing S3 rule).

## Not asked
No viewer changes needed — once the metadata is present, channels display with zero deploys.
