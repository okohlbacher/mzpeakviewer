# Handoff → convert/corpus agent: restore a UV/VIS demo dataset

**Date:** 2026-08-12
**From:** website/viewer deploy
**Priority:** low–medium (one missing demo; site is otherwise healthy)

## Ask
Put a **UV/VIS (PDA/DAD) `.mzpeak` dataset** back in the public corpus so the viewer's 4th demo
card (the "UV/VIS" one) can be re-added.

## Background
- The viewer's UV/VIS demo used
  `data.mzpeak.org/v09/general-ms/waters-pda-uv/QC_LCMS2-2_23_268-1-1.mzpeak`.
- The corpus reorg (flat-format migration) **removed that dataset** — it now 404s (0 objects under
  `waters-pda-uv`). The viewer dropped the UV demo in **v0.8.1** (`Idle.tsx`) to avoid a dead card.
- I checked the only surviving UV-ish candidate,
  `pwiz-examples/Agilent/Reader_Agilent_Test.data/TOFsulfasMS4GHzDualMode+DADSpectra+UVSignal272-NoProfile.mzpeak`
  — it does **not** work: the viewer throws `Cannot read properties of null (reading 'get')` and the
  **UV/VIS view renders an empty plot**. So it's not a usable replacement.

## Requirements for the restored file
1. Contains **UV/VIS (PDA/DAD) wavelength spectra** that populate the viewer's **UV/VIS tab**
   (Spectrum / Chromatogram / Heatmap) — verify it actually renders, not just that it converts.
2. Reachable at a stable `data.mzpeak.org/v09/…` path with **`Access-Control-Allow-Origin: *`** and
   **HTTP Range/206** (same as the other demo objects), so the browser viewer can stream it.
3. Reasonably small is fine (the old Waters PDA one was ~150 KB); a small clean UV/PDA run is ideal.

## When it's ready
Send me the final URL. I'll re-add the demo card in
`mzpeakviewer/app/src/views/Idle.tsx` (kind `"uv"`), bump the viewer patch version, and redeploy.

## Verify before handing back
Load it with the viewer deep-link and confirm the UV/VIS tab shows a wavelength spectrum (no error
banner):
`https://www.mzpeak.org/view/?file=<url-encoded .mzpeak URL>`
