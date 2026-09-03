# Changelog

All notable changes to mzPeakViewer are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **Viewer (mzPeakViewer `packages/core`): ims-compact m/z from the per-spectrum exact linear pair.**
  When `ims_calibration` declares `per_spectrum: "tof_c0,tof_c1"` (the converter's C2 = 0 TDF
  ModelType-1 lane) and a spectrum's `*_tof_c0` / `*_tof_c1` metadata cells are finite (c1 ≠ 0 —
  the 0 mzpeakts materialises for a NULL f64 cell is a chord row), the engine reconstructs
  `m/z = (tof_c0 + tof_c1·tof)²` for that spectrum instead of the run-wide chord `(a + b·tof)²`;
  every other spectrum, and every archive without `per_spectrum`, stays on the chord exactly as
  before. `engine/spectrum.ts`: `ImsCalibration` gains `perSpectrum` / `exactPerSpectrum` /
  `spectrumCoeffs`; new `resolveImsCalibration(reader, index)` (suffix lookup shared with the
  SciEX sqrt grid via `spectrumNumBySuffix`), `imsTofToMz`, `imsMzExact`; `mzFromTof` prefers the
  bound pair. Applied on every ims-compact tof → m/z path: `readCentroids` (Layout A, the
  per-scan-delta cumsum guard kept in front of the map), `readDataArrays` (Layout B
  `m/z-chunked`), `readSpectrumFacet` / `reader/arrays.ts` / `reader/explorer/browse.ts`
  (`getSpectrumArrays`), and the XIC: `engine/chrom.ts gridXicResolver` now also returns a
  per-spectrum axis map for an ims-compact file (`browse.ts XicAxisMap`), so `extractChromatogram`
  windows the `tof` axis per row (per-scan deltas cumsum'd, reset on each 1/K0 change) instead of
  handing mzpeakts an m/z window it cannot apply to a facet with no `mz` column. No UI reads
  `ims_calibration.exact` today; `imsMzExact(cal)` is exported for one that does. Tests:
  `engine/spectrum.test.ts` ("ims-compact per-spectrum exact linear calibration", BigInt-safe
  tof, null / 0 / NaN cells → chord, per-scan-delta + chunked + facet reader) and
  `engine/chrom-ims-xic.test.ts` (XIC window on the decoded tof, exact vs chord per spectrum,
  TIC unchanged); `engine/ims-corpus-smoke.test.ts` (gated on `MZPEAK_IMS_ARCHIVE`) on the
  per-spectrum PXD059079 2485 archive: 3,994 spectra, every probed spectrum binds its pair
  (all-or-nothing asserted), each pair re-derived from `vendor_mz_calibration` + `_tdf_t1` to
  2.2e-16 relative, max |pair/chord − 1| = 4.1e-6, spectrum 0 (572,322 peaks) at m/z
  100.0211–1699.9991 matching an independent pyarrow reconstruction digit for digit (the chord
  would put its base peak at 524.3010 instead of 524.3022, −2.3 ppm), XIC window sum = the
  spectrum's own in-window sum.
- **Viewer, review follow-ups (2026-09-03).** (1) The pair's trigger now matches the vendored
  Rust reader's: without a valid `ims_calibration.per_spectrum` key the engine still binds the
  pair when BOTH default `*_tof_c0` / `*_tof_c1` spectra-metadata columns exist
  (`readImsCalibration`, `perSpectrumSource: "per_spectrum" | "columns"`), so a hand-edited or
  stamp-only archive (columns present, key gone — e.g. a `per_spectrum`-stripped index JSON)
  reconstructs the same m/z in the viewer as through `mzpeak-convert ARCHIVE -o x.mzML`; a
  `per_spectrum` key naming other columns still wins, and one column alone never binds a half
  pair. A genuinely chord-only archive (no key, no columns — every `C2 ≠ 0` run and every archive
  from a pre-change converter) is unchanged. (2) An `exact_per_spectrum` archive that leaves a
  spectrum on the chord (null / NaN / 0 cell — a half-written or truncated metadata facet; the
  converter's lane is all-or-nothing) is no longer silent: `resolveImsCalibration` warns once per
  reader on the console and counts it (`imsPairUnboundCount(reader)`, for a UI badge; the corpus
  smoke asserts 0). (3) ims-compact XIC on a legacy `per-scan-delta` archive whose bulk stream
  carries no 1/K0 array now yields a GAP for that spectrum (`browse.ts sumGridWindow` returns
  null) instead of mapping raw deltas as if absolute — the summer's "never a false value" rule;
  `absolute` and `m/z-chunked` encodings are untouched. Tests updated/added in
  `engine/spectrum.test.ts` (columns-only trigger, half pair, foreign key names, warn-once +
  count) and `engine/chrom-ims-xic.test.ts` (no-1/K0 gap, columns-without-key lane, a chord-only
  fixture with NO columns); the corpus smoke re-run on the per-spectrum 2485 archive (flat and
  `--ims-chunked`), on the key-stripped copy (now binds all 200 probed pairs via the columns, none
  claimed exact) and on a genuine chord-only archive (a `C2 ≠ 0` copy of 2485.d: no key, no
  columns, 0 bound, chord path). Not done (follow-ups): a whole-run m/z-windowed XIC on an
  ims-compact archive streams the entire peaks facet (mzpeakts has no tof-range pushdown for a
  facet without an `mz` column; ~6.6 s / 1.5 GB on 2485.mzpeak in node) — bound the read by a tof
  range or the `--ims-chunked` chunk index; no UI surfaces `imsMzExact` / `imsPairUnboundCount`.
