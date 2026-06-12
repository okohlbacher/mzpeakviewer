# Test Data Fixtures

Fixtures used by the reader/store unit tests. Committed so tests run offline and
reproducibly without network access.

## Fixture Inventory

| File | Source | Layout | Imaging | Coverage |
|------|--------|--------|---------|----------|
| `example.mzpeak` | imzML spec **Example_Continuous** (converted by `imzml2mzpeak`) | Point | Yes (3×3 px, 9 spectra) | DATA-01 point reconstruction (m/z Float64Array, intensity Float32Array, ascending m/z, nonzero signal); imaging capability/stats; the small bundled demo (`public/static/example.mzpeak`). |

mzPeakIV is an imaging viewer, so all fixtures are imaging files. The imaging
mzPeak files in this repo use lossless **point** layout (verified: `example.mzpeak`
and a `--no-numpress` re-conversion both read back `layout="point"`). The chunked/
delta Parquet encoding is the vendored `mzpeakts` reader.s concern (tested in the
submodule), so it is not re-tested here.

## DATA-02 Coverage

No binary Numpress fixtures exist here. `src/reader/capability.test.ts` uses
synthetic mock readers to simulate Numpress (`MS:1002312`), auxiliary arrays, and
directory storage — exercising the detection + fail-loud path with precise control
without shipping encoded binaries.

## Adding New Fixtures

1. Record its source (URL or converter command) here.
2. State which requirement it covers.
3. Keep file sizes small (< 1 MB if possible) to keep CI fast.
