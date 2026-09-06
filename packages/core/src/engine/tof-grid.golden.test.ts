// GOLDEN: TOF-grid archives written by mzPeakConverter ≥ 0.10.1, where the integer `tof_index`
// axis is filed by the source's DECLARED representation (review item M6): a profile spectrum's
// axis lives in `spectra_data` (point layout, `mz` NULL on gridded rows), a centroid spectrum's in
// `spectra_peaks`. Both fixtures are the pwiz ABI examples converted with `--tof-grid on`:
//  - tof-grid-profile.mzpeak  — 7600ZenoTOFMSMS_EAD_TestData-S1.mzML, 21 PROFILE spectra, every
//    one gridded, run-wide `c0,c1` in `tof_calibration` (the "tof-grid-global" resolver shape,
//    which no earlier corpus file exercised on the profile facet).
//  - tof-grid-centroid.mzpeak — swath.api-sample-centroid.mzML, 201 CENTROID spectra, all gridded.
// The expected numbers are the converter's own summary columns (TIC = Σintensity, base peak,
// lowest/highest observed m/z), which the Rust side computed from ITS reconstruction of the same
// axis — so agreement here is a cross-implementation check of `mz = (c0 + c1·tof_index)²`.
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openEngineFile, type EngineFile } from "./open";
import { readEngineSpectrum } from "./spectrum";

const PROFILE = fileURLToPath(new URL("../../test/fixtures/tof-grid-profile.mzpeak", import.meta.url));
const CENTROID = fileURLToPath(new URL("../../test/fixtures/tof-grid-centroid.mzpeak", import.meta.url));

async function open(path: string, name: string): Promise<EngineFile> {
  const b = await readFile(path);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return openEngineFile(ab, name);
}

function summary(mz: Float64Array, intensity: Float32Array) {
  let tic = 0, max = -1, argmax = -1, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < mz.length; i++) {
    tic += intensity[i]!;
    if (intensity[i]! > max) { max = intensity[i]!; argmax = i; }
    if (mz[i]! < lo) lo = mz[i]!;
    if (mz[i]! > hi) hi = mz[i]!;
  }
  return { tic, bpInt: max, bpMz: mz[argmax]!, lo, hi };
}

const close = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= Math.abs(b) * rel;

describe("TOF-grid golden: profile axis in spectra_data, centroid axis in spectra_peaks", () => {
  let prof: EngineFile, cent: EngineFile;
  beforeAll(async () => {
    prof = await open(PROFILE, "tof-grid-profile.mzpeak");
    cent = await open(CENTROID, "tof-grid-centroid.mzpeak");
  }, 60000);

  it("profile fixture: 21 spectra, spectrum 0 read from the profile facet with the run-wide grid", async () => {
    expect(prof.stats.numSpectra).toBe(21);
    const s = await readEngineSpectrum(prof.reader, 0);
    expect(s.representation).toBe("profile");
    expect(s.sourceUsed).toBe("profile");
    // number_of_data_points of spectrum 0 in the converter's metadata row
    expect(s.mz.length).toBe(5625);
    expect(s.intensity.length).toBe(5625);
    for (let i = 1; i < s.mz.length; i++) expect(s.mz[i]! > s.mz[i - 1]!).toBe(true);
    const { tic, bpInt, bpMz, lo, hi } = summary(s.mz, s.intensity);
    expect(tic).toBe(37632);                                   // total_ion_current
    expect(bpInt).toBe(3211);                                  // base_peak_intensity
    expect(close(bpMz, 1546.1502641585234)).toBe(true);        // base_peak_mz (reconstructed by Rust)
    expect(close(lo, 150.01923841536032)).toBe(true);          // lowest_observed_mz
    expect(close(hi, 2999.1224512018057)).toBe(true);          // highest_observed_mz
  });

  it("profile fixture: every spectrum resolves (no spectrum falls back to an empty read)", async () => {
    for (let i = 0; i < 21; i++) {
      const s = await readEngineSpectrum(prof.reader, i);
      expect(s.representation).toBe("profile");
      expect(s.mz.length).toBeGreaterThan(1000);
      expect(Number.isFinite(s.mz[0]!) && s.mz[0]! > 100).toBe(true);
    }
  });

  it("centroid fixture: 201 spectra, spectrum 0 read from the peaks facet", async () => {
    expect(cent.stats.numSpectra).toBe(201);
    const s = await readEngineSpectrum(cent.reader, 0);
    expect(s.representation).toBe("centroid");
    expect(s.sourceUsed).toBe("centroid");
    expect(s.mz.length).toBe(765);                             // number_of_peaks
    const { tic, bpInt, bpMz, lo, hi } = summary(s.mz, s.intensity);
    expect(tic).toBe(272543);
    expect(bpInt).toBe(31249);
    expect(close(bpMz, 609.4664501377301)).toBe(true);
    expect(close(lo, 114.10710421324566)).toBe(true);
    expect(close(hi, 963.7605064461254)).toBe(true);
  });
});
