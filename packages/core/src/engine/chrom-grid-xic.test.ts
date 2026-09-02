// XIC over a GRID-ENCODED facet (review 2026-09-02, finding 1): mzpeakts' extractXIC keys its
// m/z window on the facet's sorting column `mz`, which a grid facet (SciEX/Agilent/Shimadzu
// `tof_index`) either lacks or null-fills — the reader then throws "Could not find … in Schema"
// (or slices nothing). `extractChromatogram` must therefore read such a facet WITHOUT the
// reader's window and apply it per row on the reconstructed axis, with the per-facet resolver
// `gridXicResolver` supplies (profile → sqrt `tof_calibration`, centroids → `mz_calibration`
// lattice). Reader I/O is faked; the routing + summation are under test.
import { describe, it, expect } from "vitest";
import { extractChromatogram } from "../reader/explorer/browse";
import { gridXicResolver } from "./chrom";
import type { Reader } from "../reader/openUrl";

type Call = { tRange: unknown; mzRange: unknown; useProfile: boolean };
type FakePoint = { index: number; dataArrays: Record<string, unknown> };

/** A reader whose extractXIC records its arguments and hands back canned per-spectrum rows
 *  (the bulk-stream shape: dataArrays keyed like getSpectrum's, Int64 axis as BigInt64Array). */
function fakeReader(points: FakePoint[], metadata: Record<string, unknown> = {}, coeffs?: Record<string, number>): { reader: Reader; calls: Call[] } {
  const calls: Call[] = [];
  const reader = {
    store: { fileIndex: { metadata } },
    spectrumMetadata: coeffs
      ? { spectra: { getChild: (n: string) => ({ get: () => coeffs[n] }), type: { children: Object.keys(coeffs).map((name) => ({ name })) } } }
      : undefined,
    extractXIC: async (tRange: unknown, mzRange: unknown, useProfile: boolean) => {
      calls.push({ tRange, mzRange, useProfile });
      // Mirror mzpeakts: with a window it would key on `mz` — the grid facet has none → throw.
      if (mzRange != null && points.some((p) => !p.dataArrays["m/z array"])) {
        throw new Error("Could not find [object Object] in Schema<{spectrum_index, intensity array, tof_index}>");
      }
      return { points: points.map((p) => ({ ...p, time: p.index / 60 })), target: { timeRange: tRange, mzRange } };
    },
  } as unknown as Reader;
  return { reader, calls };
}

const tofBlock = { codec: "tof-grid", model: "sciex_sqrt_per_spectrum", per_spectrum_columns: ["tof_c0", "tof_c1"] };
const mzBlock = { codec: "mz-grid", scale: 1e9 };
const both = { tof_calibration: tofBlock, mz_calibration: mzBlock };
const c0 = 8.0, c1 = 9.16e-5;
const coeffs = { MS_4000900_tof_c0: c0, MS_4000901_tof_c1: c1 };
const sqrt = (k: number) => { const r = c0 + c1 * k; return r * r; };

describe("gridXicResolver", () => {
  it("is undefined for a non-grid file (the reader's own m/z slice runs unchanged)", () => {
    expect(gridXicResolver(fakeReader([]).reader, true)).toBeUndefined();
    expect(gridXicResolver(fakeReader([]).reader, false)).toBeUndefined();
  });
  it("picks the facet's index block: profile → sqrt tof_calibration, centroids → mz_calibration lattice", () => {
    const { reader } = fakeReader([], both, coeffs);
    expect(gridXicResolver(reader, true)!(0)!(1000)).toBe(sqrt(1000));
    expect(gridXicResolver(reader, false)!(0)!(500_000_000_000)).toBe(500_000_000_000 * 1e-9); // the transform multiplier (= the reference reader), not k/1e9
  });
});

describe("extractChromatogram on a grid facet", () => {
  // Centroid (peaks) facet of a Shimadzu lattice archive: Int64 tof_index (BigInt64Array), `mz`
  // dropped (all-null) on lattice spectra, real f64 `mz` + no axis on the off-lattice fallback.
  const latticePoints: FakePoint[] = [
    { index: 0, dataArrays: { "intensity array": new Float32Array([5, 7, 9]), tof_index: new BigInt64Array([100_000_123_456n, 200_000_000_001n, 1_250_123_456_789n]) } },
    { index: 1, dataArrays: { "intensity array": new Float32Array([1, 2, 3]), tof_index: new BigInt64Array([50_000_100_000n, 50_000_200_000n, 1_234_567_800_000n]) } },
    { index: 2, dataArrays: { "intensity array": new Float32Array([4, 6]), "m/z array": new Float64Array([100.0001234563, 200.5]) } },
    // Both columns materialised (the `mz` null-fill read back as 0): the axis wins per row.
    { index: 3, dataArrays: { "intensity array": new Float32Array([11, 13]), "m/z array": new Float64Array([0, 0]), tof_index: new BigInt64Array([100_000_500_000n, 300_000_000_000n]) } },
  ];

  it("windows on the lattice axis per row (BigInt coerced), keeps f64 fallback rows, omits spectra with nothing in the window", async () => {
    const { reader, calls } = fakeReader(latticePoints, both, coeffs);
    const pts = await extractChromatogram(reader, { mz: 100.0001, tolDa: 0.001, useProfile: false, gridMz: gridXicResolver(reader, false) });
    // The reader was asked for EVERY row (null window) on the peaks facet …
    expect(calls).toEqual([{ tRange: null, mzRange: null, useProfile: false }]);
    // … and the window [99.9991, 100.0011] was applied here: 0 → 5 (100.000123456), 2 → 4 (f64
    // 100.0001234563), 3 → 11 (100.0005); spectrum 1 (50.0001…) has no point, like the reader's slice.
    expect(pts.map((p) => [p.index, p.intensity])).toEqual([[0, 5], [2, 4], [3, 11]]);
  });

  it("the same request WITHOUT the resolver reproduces the reader failure it works around", async () => {
    const { reader } = fakeReader(latticePoints, both, coeffs);
    await expect(extractChromatogram(reader, { mz: 100.0001, tolDa: 0.001, useProfile: false })).rejects.toThrow(/Could not find/);
  });

  it("profile facet: Int32 tof_index through the per-spectrum sqrt grid; a coefficient-less spectrum is omitted, not zeroed", async () => {
    const profilePoints: FakePoint[] = [
      { index: 0, dataArrays: { "intensity array": new Float32Array([1, 5, 9, 2]), tof_index: new Int32Array([10, 11, 12, 13]), "m/z array": new Float64Array([0, 0, 0, 0]) } },
      { index: 1, dataArrays: { "intensity array": new Float32Array([1, 2]), tof_index: new Int32Array([10, 11]) } }, // no coefficients → unmappable
      { index: 2, dataArrays: { "intensity array": new Float32Array([3, 4]), "m/z array": new Float64Array([sqrt(10), sqrt(12)]) } }, // f64 fallback spectrum
    ];
    const perSpectrum: Record<number, Record<string, number> | undefined> = { 0: coeffs, 2: coeffs };
    const { reader, calls } = fakeReader(profilePoints, both);
    // Per-spectrum coefficient lookup keyed by index (spectrum 1 has none).
    (reader as unknown as { spectrumMetadata: unknown }).spectrumMetadata = {
      spectra: { getChild: (n: string) => ({ get: (i: number) => perSpectrum[i]?.[n] }), type: { children: Object.keys(coeffs).map((name) => ({ name })) } },
    };
    const lo = sqrt(11), hi = sqrt(12);
    const pts = await extractChromatogram(reader, { mz: (lo + hi) / 2, tolDa: (hi - lo) / 2, useProfile: true, gridMz: gridXicResolver(reader, true) });
    expect(calls[0]!.mzRange).toBeNull();
    // 0: k=11,12 → 5+9; 1: axis but no resolver → no point (a gap, never a false zero); 2: f64 sqrt(12) → 4.
    expect(pts.map((p) => [p.index, p.intensity])).toEqual([[0, 14], [2, 4]]);
  });

  it("non-grid file: the window is passed to the reader unchanged (no behaviour change)", async () => {
    const { reader, calls } = fakeReader([{ index: 0, dataArrays: { "intensity array": new Float32Array([2, 3]), "m/z array": new Float64Array([100, 100.001]) } }]);
    const pts = await extractChromatogram(reader, { mz: 100, tolDa: 0.01, useProfile: true, gridMz: gridXicResolver(reader, true) });
    expect(calls).toEqual([{ tRange: null, mzRange: { start: 99.99, end: 100.01 }, useProfile: true }]);
    expect(pts.map((p) => p.intensity)).toEqual([5]); // the reader already sliced; sum everything it returned
  });

  it("TIC (no window) on a grid facet sums every row and passes a null window either way", async () => {
    const { reader, calls } = fakeReader(latticePoints, both, coeffs);
    const pts = await extractChromatogram(reader, { useProfile: false, gridMz: gridXicResolver(reader, false) });
    expect(calls[0]!.mzRange).toBeNull();
    expect(pts.map((p) => [p.index, p.intensity])).toEqual([[0, 21], [1, 6], [2, 10], [3, 24]]);
  });

  it("time window still converts s→min going in and filters inclusively coming out", async () => {
    const { reader, calls } = fakeReader(latticePoints, both, coeffs);
    const pts = await extractChromatogram(reader, { mz: 100.0001, tolDa: 0.001, timeRange: [0, 2], useProfile: false, gridMz: gridXicResolver(reader, false) });
    expect(calls[0]!.tRange).toEqual({ start: 0, end: 2 / 60 });
    expect(pts.map((p) => p.index)).toEqual([0, 2]); // spectrum 3 (t = 3 s) is outside [0, 2]
  });
});
