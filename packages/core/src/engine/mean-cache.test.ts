// Unit test for G: engineMeanSpectrum / engineRoiSpectrum reuse the warm ion cache and do
// NOT random-access getSpectrum per sample (the project's "never random-access per pixel"
// rule). A fake reader whose getSpectrum throws proves the cache path is taken.
import { describe, it, expect } from "vitest";
import { engineMeanSpectrum, engineRoiSpectrum, type SpectraArrayCache } from "./imaging";
import type { Reader } from "../reader/openUrl";

/** Reader that reports a spectrum count but throws if any per-spectrum read is attempted. */
function fakeReader(numSpectra: number): Reader {
  return {
    numSpectra,
    getSpectrum: () => {
      throw new Error("getSpectrum must not be called when the ion cache is warm");
    },
    // harvestDataArraysOrNull reads these; throwing here also proves the cache path.
    spectrumMetadata: null,
  } as unknown as Reader;
}

function cacheOf(entries: Record<number, { mz: number[]; intensity: number[] }>): SpectraArrayCache {
  const byIndex = new Map<number, { mz: Float32Array; intensity: Float32Array }>();
  let bytes = 0;
  for (const [k, v] of Object.entries(entries)) {
    const mz = Float32Array.from(v.mz); // compact cache stores f32 m/z
    const intensity = Float32Array.from(v.intensity);
    byIndex.set(Number(k), { mz, intensity });
    bytes += mz.byteLength + intensity.byteLength;
  }
  return { byIndex, complete: true, bytes, sorted: true };
}

describe("G — mean/ROI reuse the warm ion cache (no random-access getSpectrum)", () => {
  it("global mean is computed from the cache (getSpectrum never called)", async () => {
    const cache = cacheOf({
      0: { mz: [100, 200], intensity: [2, 4] },
      1: { mz: [100, 200], intensity: [4, 8] },
      2: { mz: [100, 200], intensity: [6, 12] },
    });
    const mean = await engineMeanSpectrum(fakeReader(3), cache);
    expect(Array.from(mean.mz)).toEqual([100, 200]);
    // per-bin mean: (2+4+6)/3 = 4, (4+8+12)/3 = 8
    expect(Array.from(mean.intensity)).toEqual([4, 8]);
  });

  it("warm mean's reference m/z axis is f32-precision (consistent with the cold path)", async () => {
    // Non-integer m/z so f32 vs f64 differ: the axis must come out f32-rounded.
    const cache = cacheOf({ 0: { mz: [100.123, 200.456], intensity: [1, 2] } });
    const mean = await engineMeanSpectrum(fakeReader(1), cache);
    for (let i = 0; i < mean.mz.length; i++) expect(mean.mz[i]).toBe(Math.fround(mean.mz[i]!));
  });

  it("ROI mean is computed from the cache (getSpectrum never called)", async () => {
    const cache = cacheOf({
      5: { mz: [100, 200], intensity: [10, 20] },
      9: { mz: [100, 200], intensity: [20, 40] },
    });
    const mean = await engineRoiSpectrum(fakeReader(100), [5, 9], cache);
    expect(Array.from(mean.mz)).toEqual([100, 200]);
    expect(Array.from(mean.intensity)).toEqual([15, 30]);
  });

  it("without a cache it falls back to the per-spectrum read (empty here, proving the cache was the difference)", async () => {
    // No cache → readSpectrumArrays → harvestDataArraysOrNull, which catches the fake
    // reader's throw and returns null → an empty (but valid) mean. The cached cases above
    // produced real output from the SAME reader, so the cache is what supplied the data.
    const mean = await engineRoiSpectrum(fakeReader(10), [0], null);
    expect(mean.mz.length).toBe(0);
    expect(mean.intensity.length).toBe(0);
  });
});
