// XIC over an ims-compact (timsTOF) facet: the peaks facet stores an integer `tof` (MS:1000786)
// and NO `mz` sorting column, so mzpeakts' extractXIC cannot window it ("Could not find … in
// Schema"). `extractChromatogram` must read the facet WITHOUT the reader's window and apply it
// per row on tof → m/z — through the spectrum's own exact `tof_c0/tof_c1` pair when the archive
// carries one (`ims_calibration.per_spectrum`), else the run-wide chord (a + b·tof)² — with the
// Layout A per-scan-delta cumsum (reset on each 1/K0 change) in front of the map, exactly as the
// spectrum reader does. Reader I/O is faked; the routing + decoding + summation are under test.
import { describe, it, expect } from "vitest";
import { extractChromatogram, type XicAxisMap } from "../reader/explorer/browse";
import { gridXicResolver } from "./chrom";
import type { Reader } from "../reader/openUrl";

type Call = { tRange: unknown; mzRange: unknown; useProfile: boolean };
type FakePoint = { index: number; dataArrays: Record<string, unknown> };

const A = 10, B = 0.0001, C0 = 9.5, C1 = 0.00011;
const chord = (t: number) => { const m = A + B * t; return m * m; };
const exact = (t: number) => { const m = C0 + C1 * t; return m * m; };
const imsMeta = (tofEncoding: string, perSpectrum = true) => ({
  ims_calibration: {
    codec: "ims-compact", a: A, b: B, tof_encoding: tofEncoding,
    ...(perSpectrum ? { per_spectrum: "tof_c0,tof_c1", exact_per_spectrum: true } : {}),
  },
});
// Spectrum 0 carries the exact pair; 1 was left on the chord (null cells); 2 has no row at all.
const cells: Record<number, Record<string, number | null>> = {
  0: { opt_MS_4000900_tof_c0: C0, opt_MS_4000901_tof_c1: C1 },
  1: { opt_MS_4000900_tof_c0: null, opt_MS_4000901_tof_c1: null },
};

/** A reader whose extractXIC records its arguments and hands back canned per-spectrum rows in
 *  the bulk-stream shape (dataArrays keyed by array_name: `tof`, `intensity array`, the 1/K0 array). */
function fakeReader(points: FakePoint[], metadata: Record<string, unknown> = {}, withCols = true): { reader: Reader; calls: Call[] } {
  const calls: Call[] = [];
  const reader = {
    store: { fileIndex: { metadata } },
    spectrumMetadata: {
      spectra: {
        getChild: (n: string) => ({ get: (i: number) => (withCols ? cells[i]?.[n] : undefined) }),
        type: { children: (withCols ? ["opt_MS_4000900_tof_c0", "opt_MS_4000901_tof_c1"] : []).map((name) => ({ name })) },
      },
    },
    extractXIC: async (tRange: unknown, mzRange: unknown, useProfile: boolean) => {
      calls.push({ tRange, mzRange, useProfile });
      // Mirror mzpeakts: with a window it keys on `mz` — the ims-compact peaks facet has none → throw.
      if (mzRange != null && points.some((p) => !p.dataArrays["m/z array"])) {
        throw new Error("Could not find [object Object] in Schema<{spectrum_index, intensity array, mean inverse reduced ion mobility array, tof}>");
      }
      return { points: points.map((p) => ({ ...p, time: p.index / 60 })), target: { timeRange: tRange, mzRange } };
    },
  } as unknown as Reader;
  return { reader, calls };
}

// One frame shape, three spectra. Stored tofs 50k, 30k | 60k, 40k with 1/K0 0.8, 0.8 | 0.95, 0.95:
// per-scan-delta → absolute 50k, 80k | 60k, 100k; absolute → taken verbatim.
const tofs = () => new Int32Array([50000, 30000, 60000, 40000]);
const inten = () => new Float32Array([1, 2, 3, 4]);
const mob = () => new Float64Array([0.8, 0.8, 0.95, 0.95]);
const framePoints = (): FakePoint[] => [
  { index: 0, dataArrays: { "intensity array": inten(), "mean inverse reduced ion mobility array": mob(), tof: tofs() } },
  { index: 1, dataArrays: { "intensity array": inten(), "mean inverse reduced ion mobility array": mob(), tof: tofs() } },
  // no 1/K0 array at all → under per-scan-delta there is no scan boundary to find → a GAP (never a
  // raw delta mapped as if absolute); under "absolute" the stored values are taken verbatim.
  { index: 2, dataArrays: { "intensity array": inten(), tof: tofs() } },
];
const win = (center: number, half = 0.5) => ({ mz: center, tolDa: half });

describe("gridXicResolver on an ims-compact file", () => {
  it("returns a per-spectrum axis map: the exact pair for a spectrum that carries it, the chord otherwise", () => {
    const { reader } = fakeReader([], imsMeta("per-scan-delta"));
    const r = gridXicResolver(reader, false)!;
    expect(r).toBeTypeOf("function");
    const m0 = r(0) as XicAxisMap, m1 = r(1) as XicAxisMap;
    expect(m0.mz(100000)).toBe(exact(100000));
    expect(m0.perScanDelta).toBe(true);
    expect(m1.mz(100000)).toBe(chord(100000));
    expect((r(2) as XicAxisMap).mz(100000)).toBe(chord(100000));
    expect((gridXicResolver(fakeReader([], imsMeta("absolute")).reader, false)!(0) as XicAxisMap).perScanDelta).toBe(false);
    // the profile facet of the same file (Layout B `tof` data arrays) maps the same way
    expect((gridXicResolver(reader, true)!(0) as XicAxisMap).mz(100000)).toBe(exact(100000));
  });
  it("stays undefined for a file that is neither grid nor ims-compact", () => {
    expect(gridXicResolver(fakeReader([]).reader, false)).toBeUndefined();
  });
});

describe("extractChromatogram on an ims-compact peaks facet", () => {
  it("per-scan-delta: windows on the cumsum'd tof through the spectrum's own pair; the reader gets a null window", async () => {
    const { reader, calls } = fakeReader(framePoints(), imsMeta("per-scan-delta"));
    const opts = { useProfile: false, gridMz: gridXicResolver(reader, false) };
    // abs tof 100k: spectrum 0 → exact 420.25 (intensity 4); spectrum 1 → chord 400; spectrum 2 has
    // no mobility → unmappable → no point. Window [419.75, 420.75] → only spectrum 0.
    const pts = await extractChromatogram(reader, { ...opts, ...win(exact(100000)) });
    expect(calls).toEqual([{ tRange: null, mzRange: null, useProfile: false }]);
    expect(pts.map((p) => [p.index, p.intensity])).toEqual([[0, 4]]);
    // Window around the CHORD's 100k → spectrum 1 only (spectrum 0 is at 420.25, spectrum 2 unmappable).
    expect((await extractChromatogram(reader, { ...opts, ...win(chord(100000)) })).map((p) => [p.index, p.intensity])).toEqual([[1, 4]]);
    // abs tof 50k is the scan-start of every spectrum: exact 225 = chord 225 → spectra 0 and 1
    // (intensity 1); spectrum 2 stays a gap even though its first stored value IS absolute.
    expect((await extractChromatogram(reader, { ...opts, ...win(225) })).map((p) => [p.index, p.intensity])).toEqual([[0, 1], [1, 1]]);
    // The raw delta 30k must never reach the map: exact(30000) = 12.8² window is empty.
    expect(await extractChromatogram(reader, { ...opts, ...win(exact(30000), 0.05) })).toEqual([]);
    // Spectrum 2 (no 1/K0 array): its raw deltas are NOT read as absolute (40k → chord 196 must be empty).
    expect(await extractChromatogram(reader, { ...opts, ...win(chord(40000)) })).toEqual([]);
    expect(await extractChromatogram(reader, { ...opts, ...win(chord(50000)) })).toEqual([[0, 1], [1, 1]].map(([i, v]) => ({ index: i, time: i, intensity: v })));
  });

  it("absolute encoding: no cumsum, still the per-spectrum pair vs the chord", async () => {
    const { reader } = fakeReader(framePoints(), imsMeta("absolute"));
    const opts = { useProfile: false, gridMz: gridXicResolver(reader, false) };
    // raw 30k: spectrum 0 → exact 12.8² (intensity 2); spectra 1, 2 → chord 13² = 169.
    expect((await extractChromatogram(reader, { ...opts, ...win(exact(30000), 0.05) })).map((p) => [p.index, p.intensity])).toEqual([[0, 2]]);
    expect((await extractChromatogram(reader, { ...opts, ...win(169, 0.05) })).map((p) => [p.index, p.intensity])).toEqual([[1, 2], [2, 2]]);
  });

  it("chord-only archive (no per_spectrum, no tof_c columns): every spectrum maps through (a + b·tof)²", async () => {
    const { reader } = fakeReader(framePoints(), imsMeta("per-scan-delta", false), false);
    const opts = { useProfile: false, gridMz: gridXicResolver(reader, false) };
    // abs 100k → chord 400 on spectra 0 and 1 (spectrum 2: no 1/K0 → gap).
    expect((await extractChromatogram(reader, { ...opts, ...win(400) })).map((p) => [p.index, p.intensity])).toEqual([[0, 4], [1, 4]]);
    expect(await extractChromatogram(reader, { ...opts, ...win(exact(100000)) })).toEqual([]);
  });

  it("the tof_c columns WITHOUT a per_spectrum key still bind the pair (the vendored Rust reader's trigger)", async () => {
    const { reader } = fakeReader(framePoints(), imsMeta("absolute", false));
    const opts = { useProfile: false, gridMz: gridXicResolver(reader, false) };
    // raw 30k: spectrum 0 → exact 12.8² (its columns are finite); spectra 1, 2 → chord 169.
    expect((await extractChromatogram(reader, { ...opts, ...win(exact(30000), 0.05) })).map((p) => [p.index, p.intensity])).toEqual([[0, 2]]);
    expect((await extractChromatogram(reader, { ...opts, ...win(169, 0.05) })).map((p) => [p.index, p.intensity])).toEqual([[1, 2], [2, 2]]);
  });

  it("the same request WITHOUT the resolver reproduces the reader failure it works around", async () => {
    const { reader } = fakeReader(framePoints(), imsMeta("per-scan-delta"));
    await expect(extractChromatogram(reader, { useProfile: false, ...win(400) })).rejects.toThrow(/Could not find/);
  });

  it("TIC (no window) sums every row unchanged and passes a null window", async () => {
    const { reader, calls } = fakeReader(framePoints(), imsMeta("per-scan-delta"));
    const pts = await extractChromatogram(reader, { useProfile: false, gridMz: gridXicResolver(reader, false) });
    expect(calls[0]!.mzRange).toBeNull();
    expect(pts.map((p) => [p.index, p.intensity])).toEqual([[0, 10], [1, 10], [2, 10]]);
  });

  it("a row with a real f64 `mz` beside the axis keeps it (the per-row rule), BigInt tof coerced", async () => {
    const pts: FakePoint[] = [
      { index: 0, dataArrays: { "intensity array": new Float32Array([5, 7]), "m/z array": new Float64Array([0, 777]), tof: new BigInt64Array([100000n, 100000n]) } },
    ];
    const { reader } = fakeReader(pts, imsMeta("absolute"));
    const opts = { useProfile: false, gridMz: gridXicResolver(reader, false) };
    expect((await extractChromatogram(reader, { ...opts, ...win(exact(100000)) })).map((p) => p.intensity)).toEqual([5]);
    expect((await extractChromatogram(reader, { ...opts, ...win(777) })).map((p) => p.intensity)).toEqual([7]);
  });
});
