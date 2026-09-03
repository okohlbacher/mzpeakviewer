# Changelog

All notable changes to mzPeakViewer are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/).

## [0.9.4] — 2026-09-03

### Added

- **Spectra view: export the displayed spectrum as a SEQUEST `.dta` file.** A `⭳ .dta`
  action in the points footer saves the spectrum EXACTLY as displayed — on a dual-stored
  file the Signal toggle decides which facet is written, and the filename records it
  (`<stem>.spec<N>.<facet>.dta`). Header follows the SEQUEST convention:
  `MH+ = mz·z − (z−1)·1.00727646688` from the selected-ion m/z + charge when the file
  records them, the isolation-window target with the standard `z = 1` assumption for DIA,
  and the conventional `0 1` placeholder for precursor-less spectra (MS1); an empty
  spectrum refuses with a message rather than writing an empty file. Desktop saves through
  the native dialog + `fs` plugin (anchor downloads are inert in WKWebView; new scoped
  `fs:allow-write-file` capability — the USER names the path), web uses a blob download.
  `spectrumMetaTree` now also carries `selectedIons`: mzpeakts materialises selected ions
  at RECORD level (not inside `precursors`) and the tree omitted them despite its wire doc
  always promising "precursor / selected-ion" — the metadata panel gains them too, and the
  export reads its precursor from there. New `app/src/dta.ts` + 9 tests pinning the header
  math, precursor extraction across nested/flat spellings, formatting and filenames;
  verified in-browser on the Shimadzu corpus (blank-centroid MS2 → `452.5 1` + 12,299
  pairs; HEK dual spectrum 1050 exports both facets, 3,145-pair profile / 391-pair
  centroid, with a real selected-ion header).

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

### Fixed

- **Grid (lattice) facets: resolved per facet, with the grid axis authoritative.** A
  Shimadzu archive can carry two grids at once — the profile facet's sqrt
  `tof_calibration` and the centroid facet's `mz_calibration` lattice — so block
  precedence is now per facet (centroids prefer `mz_calibration`, profile prefers
  `tof_calibration`), falling back to the other block only when the preferred one is
  absent; a present-but-malformed block resolves to null instead of silently
  reconstructing through the wrong grid, and readers that cannot resolve a grid throw
  rather than reporting zeros. Two bugs this exposed: mzpeakts materialises a gridded
  row's null-filled m/z column as a Float64Array of ZEROS, so gating the grid branch on
  the m/z array being absent returned all-zero spectra; and XIC over a grid facet found
  no m/z column at all, returning zero intensity for every gridded spectrum. Integer axes
  arrive as BigInt and are coerced before arithmetic. The non-engine readers
  (`harvestDataArraysOrNull` for imaging, the explorer browse path) read `centroids[i].mz`
  verbatim and saw 0/null on a lattice-centroid archive — both now decode through the
  engine's per-facet resolver, and the 0n-vs-real-mz decision is per ROW on both facets so
  a fallback f64 spectrum inside a lattice facet reads from `mz` while a gridded row reads
  from the axis, regardless of which came first.
- **mz-grid codec: divide by the scale, the exact form.** `k/1e9` and `k*1e-9` disagree on
  ~40 % of lattice values, and division is the correct one: 1e9 is representable in
  IEEE-754 but 1e-9 is not, so `k/scale` is correctly rounded while `k*(1/scale)` inherits
  the reciprocal's error. Measured on a real lattice archive (216,742 Shimadzu centroids),
  dividing reproduces every source m/z bit-for-bit while multiplying is off by up to
  1.1e-13 Da on 85,706 of them. This reverses the direction taken mid-cycle, which had
  aligned the viewer with a reference reader that multiplied; that reader now divides, and
  the archive documents `mz = tof_index / scale`.
