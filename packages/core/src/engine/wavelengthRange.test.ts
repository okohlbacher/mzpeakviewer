// Unit tests for wavelengthRange (MG-11) — the dataset-level observed wavelength range
// that drives the Summary UV/VIS band pill. Computed from the FIRST wavelength spectrum
// only (PDA/DAD scans share one wavelength grid), via readWavelengthSpectrum.
import { describe, it, expect } from "vitest";
import { wavelengthRange } from "./wavelength";
import type { Reader } from "../reader/openUrl";

/** Fake reader: getWavelengthSpectrum(0) yields a spectrum whose wavelength-array bounds
 *  are the dataset range (no observed-range CV terms → falls back to the array). `null`
 *  → a file with no wavelength spectra. */
function fakeReader(wavelengths: number[] | null): Reader {
  if (wavelengths === null) {
    return { numWavelengthSpectra: 0, wavelengthMetadata: null } as unknown as Reader;
  }
  const n = wavelengths.length;
  return {
    numWavelengthSpectra: 1,
    wavelengthMetadata: { length: 1 },
    getWavelengthSpectrum: async () => ({
      id: "function=3 process=0 scan=1",
      time: 0.1,
      dataArrays: {
        "wavelength array": Float32Array.from(wavelengths),
        "intensity array": new Float32Array(n),
      },
      meta: {},
      getParamByAccession: () => undefined,
    }),
  } as unknown as Reader;
}

describe("wavelengthRange", () => {
  it("returns the first spectrum's wavelength bounds (the Waters PDA range)", async () => {
    const r = await wavelengthRange(fakeReader([209.95, 250, 399.95]));
    expect(r).not.toBeNull();
    expect(r![0]).toBeCloseTo(209.95, 2);
    expect(r![1]).toBeCloseTo(399.95, 2);
  });

  it("returns null when the file has no wavelength spectra", async () => {
    expect(await wavelengthRange(fakeReader(null))).toBeNull();
  });

  it("rejects a non-positive lower bound (review fix #2)", async () => {
    expect(await wavelengthRange(fakeReader([-5, 100, 400]))).toBeNull();
  });
});
