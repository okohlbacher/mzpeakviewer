// The NON-engine raw readers (`harvestDataArraysOrNull` for the ion image / mean / ROI paths and
// the Browse tab's `getSpectrumArrays`) must decode a grid-encoded facet through the SAME per-facet
// resolver the engine uses — never read the null-filled `mz` (0) verbatim. Synthetic readers only
// (no WASM): the index metadata carries the calibration blocks, `getSpectrum` returns the record
// shape mzpeakts materialises (bigint Int64 axes, `mz: 0` on gridded rows, `0n` for a NULL Int64).
import { describe, it, expect } from "vitest";
import { assertNoGridAxis, harvestDataArraysOrNull } from "./arrays";
import { getSpectrumArrays } from "./explorer/browse";
import { readEngineSpectrum, UnresolvedGridAxisError, type RawSpectrum } from "../engine/spectrum";
import type { Reader } from "./openUrl";

const REPR_CENTROID = "MS:1000127";
const REPR_PROFILE = "MS:1000128";

type Rec = RawSpectrum & { meta?: Record<string, unknown> };

const mkReader = (metadata: Record<string, unknown>, rec: Rec, coeffs?: Record<string, number | null>): Reader =>
  ({
    store: { fileIndex: { metadata } },
    getSpectrum: async (_i: number) => rec,
    spectrumMetadata: coeffs
      ? {
          length: 1,
          spectra: {
            getChild: (n: string) => ({ get: () => coeffs[n] }),
            type: { children: Object.keys(coeffs).map((name) => ({ name })) },
          },
        }
      : undefined,
  }) as unknown as Reader;

const withRepr = (rec: RawSpectrum, repr: string): Rec => ({ ...rec, meta: { MS_1000525_spectrum_representation: repr } });

// Shimadzu lattice archive: the centroid facet is an exact Int64 lattice (mz_calibration,
// scale 1e9) and the profile facet a per-spectrum sqrt grid (tof_calibration).
const mzBlock = { codec: "mz-grid", scale: 1e9, vendor: "shimadzu", lossless: "tof_index", applies_to: "spectra_peaks" };
const tofBlock = { codec: "tof-grid", model: "sciex_sqrt_per_spectrum", per_spectrum_columns: ["tof_c0", "tof_c1"], vendor: "shimadzu" };
const lattice = { mz_calibration: mzBlock };
const both = { tof_calibration: tofBlock, mz_calibration: mzBlock };
const c0 = 8.0, c1 = 9.16e-5;
const coeffs = { MS_4000900_tof_c0: c0, MS_4000901_tof_c1: c1 };
const sqrt = (k: number) => { const r = c0 + c1 * k; return r * r; };

const ascending = (a: ArrayLike<number>): boolean => {
  for (let i = 1; i < a.length; i++) if (a[i]! < a[i - 1]!) return false;
  return true;
};

describe("V1 — raw readers reconstruct a lattice centroid facet (bigint tof_index, mz 0)", () => {
  // The exact record shape mzpeakts materialises for blind.lat/hek.lat: `mz` is the null-filled
  // f64 fallback column (0), the Int64 axis is a bigint under `tof_index` (or the mangled "" key).
  const rec: RawSpectrum = {
    id: "scan=7",
    centroids: [
      { mz: 0, intensity: 5, tof_index: 100_000_123_456n },
      { mz: 0, intensity: 7, tof_index: 200_000_000_001n },
      { mz: 0, intensity: 9, tof_index: 1_250_123_456_789n },
    ],
  };
  // The Parquet transform's multiplier (`transform_params [1e-9]`): k·1e-9, bit-identical to the
  // reference reader's `s * k`. NOT k/1e9 — the first two differ from it by 1 ulp
  // (100.00012345600001 vs 100.000123456).
  const want = [100_000_123_456, 200_000_000_001, 1_250_123_456_789].map((k) => k * 1e-9);

  it("harvestDataArraysOrNull → idx·(1/scale), not zeros", async () => {
    const out = await harvestDataArraysOrNull(mkReader(lattice, rec), 7);
    expect(out).not.toBeNull();
    expect(Array.from(out!.mz)).toEqual(want);
    expect(Array.from(out!.intensity)).toEqual([5, 7, 9]);
    expect(out!.mz).toBeInstanceOf(Float64Array);
  });

  it("getSpectrumArrays (browse) → idx·(1/scale), ascending, same values as the engine", async () => {
    const r = mkReader(lattice, withRepr(rec, REPR_CENTROID));
    const out = await getSpectrumArrays(r, 7);
    expect(Array.from(out.mz)).toEqual(want);
    expect(ascending(out.mz)).toBe(true);
    expect(out.representation).toBe("centroid");
    const eng = await readEngineSpectrum(r, 7);
    expect(Array.from(eng.mz)).toEqual(Array.from(out.mz));
  });

  it("the mangled \"\" axis key mzpeakts emits for the 1-word name is found too", async () => {
    const mangled: RawSpectrum = { id: "s", centroids: [{ mz: 0, intensity: 1, "": 500_000_000_000n }, { mz: null, intensity: 2, "": 500_000_000_001n }] };
    // k·1e-9 (the reference reader's value): 500.00000000000006, not the 500 that k/1e9 would give.
    const wantM = [500_000_000_000 * 1e-9, 500_000_000_001 * 1e-9];
    expect(Array.from((await harvestDataArraysOrNull(mkReader(lattice, mangled), 0))!.mz)).toEqual(wantM);
    expect(Array.from((await getSpectrumArrays(mkReader(lattice, mangled), 0)).mz)).toEqual(wantM);
  });

  it("a gridded PROFILE facet (BigInt64Array tof_index beside a zero-filled m/z array) resolves per facet", async () => {
    // Both blocks: dataArrays go through the sqrt grid (tof_calibration), centroids through the lattice.
    const dual: RawSpectrum = {
      id: "s",
      dataArrays: { "m/z array": new Float64Array([0, 0, 0]), tof_index: new BigInt64Array([10n, 20n, 30n]), "intensity array": new Float32Array([1, 2, 3]) },
      centroids: [{ mz: 0, intensity: 4, tof_index: 70_000_000_000n }],
    };
    const r = mkReader(both, dual, coeffs);
    // harvest: data arrays FIRST (the ion-image source of truth) — sqrt grid, not zeros.
    const h = await harvestDataArraysOrNull(r, 0);
    expect(Array.from(h!.mz)).toEqual([sqrt(10), sqrt(20), sqrt(30)]);
    // browse, profile-declared → data arrays through the sqrt grid.
    const b = await getSpectrumArrays(mkReader(both, withRepr(dual, REPR_PROFILE), coeffs), 0);
    expect(Array.from(b.mz)).toEqual([sqrt(10), sqrt(20), sqrt(30)]);
    // browse, centroid-declared → centroids through the lattice.
    const bc = await getSpectrumArrays(mkReader(both, withRepr(dual, REPR_CENTROID), coeffs), 0);
    expect(Array.from(bc.mz)).toEqual([70]);
  });

  it("grid axis with NO resolver still fails loud (never silent zeros)", async () => {
    // No index blocks at all → assertNoGridAxis backstop.
    await expect(harvestDataArraysOrNull(mkReader({}, rec), 3)).rejects.toThrow(/grid-encoded centroids/);
    await expect(getSpectrumArrays(mkReader({}, rec), 3)).rejects.toThrow(/grid-encoded centroids/);
    // Both blocks present but THIS spectrum lacks its sqrt coefficients → the profile facet is
    // unresolvable while the centroid one is not → the per-facet reader fails loud.
    const prof: RawSpectrum = { id: "s", dataArrays: { "m/z array": new Float64Array([0, 0]), tof_index: new Int32Array([1, 2]), "intensity array": new Float32Array([1, 2]) } };
    const r = mkReader(both, prof, { MS_4000900_tof_c0: null, MS_4000901_tof_c1: null });
    await expect(harvestDataArraysOrNull(r, 4)).rejects.toThrow(UnresolvedGridAxisError);
    await expect(getSpectrumArrays(r, 4)).rejects.toThrow(UnresolvedGridAxisError);
    // A malformed lattice block (string scale) beside no tof block: unresolvable on both facets.
    const bad = mkReader({ mz_calibration: { codec: "mz-grid", scale: "1e9" } }, rec);
    await expect(harvestDataArraysOrNull(bad, 5)).rejects.toThrow(/grid-encoded centroids/);
  });

  it("assertNoGridAxis is facet-aware", () => {
    const dual: RawSpectrum = { id: "s", dataArrays: { tof_index: new Int32Array([1]), "intensity array": new Float32Array([1]) }, centroids: [{ mz: 0, intensity: 1, tof_index: 5n }] };
    expect(() => assertNoGridAxis(dual, 0, "profile")).toThrow(/data arrays/);
    expect(() => assertNoGridAxis(dual, 0, "centroid")).toThrow(/centroids/);
    expect(() => assertNoGridAxis({ id: "s", centroids: [{ mz: 100.5, intensity: 1, tof_index: 0n }] }, 0)).not.toThrow();
  });
});

describe("V2 — a fallback f64 spectrum inside a lattice facet (NULL Int64 axis → 0n, real mz) reads mz", () => {
  it("centroids: tof_index 0n beside a finite mz > 0 → mz, never 0n/scale", async () => {
    const rec: RawSpectrum = { id: "s", centroids: [{ mz: 100.5, intensity: 1, tof_index: 0n }, { mz: 200.25, intensity: 2, tof_index: 0n }] };
    expect(Array.from((await harvestDataArraysOrNull(mkReader(lattice, rec), 0))!.mz)).toEqual([100.5, 200.25]);
    expect(Array.from((await getSpectrumArrays(mkReader(lattice, rec), 0)).mz)).toEqual([100.5, 200.25]);
    expect(Array.from((await readEngineSpectrum(mkReader(lattice, rec), 0)).mz)).toEqual([100.5, 200.25]);
  });

  it("data arrays: a 0n-filled BigInt64Array axis beside a real m/z array → the m/z array", async () => {
    const rec: RawSpectrum = { id: "s", dataArrays: { "m/z array": new Float64Array([70, 70.000626327]), tof_index: new BigInt64Array([0n, 0n]), "intensity array": new Float32Array([1, 2]) } };
    expect(Array.from((await harvestDataArraysOrNull(mkReader(both, rec, coeffs), 0))!.mz)).toEqual([70, 70.000626327]);
    expect(Array.from((await getSpectrumArrays(mkReader(both, rec, coeffs), 0)).mz)).toEqual([70, 70.000626327]);
    expect(Array.from((await readEngineSpectrum(mkReader(both, rec, coeffs), 0)).mz)).toEqual([70, 70.000626327]);
  });

  it("the rule is per row: a gridded row (mz 0) next to a fallback row (real mz) in one spectrum", async () => {
    const rec: RawSpectrum = { id: "s", centroids: [{ mz: 0, intensity: 1, tof_index: 50_000_100_000n }, { mz: 60.5, intensity: 2, tof_index: 0n }] };
    expect(Array.from((await harvestDataArraysOrNull(mkReader(lattice, rec), 0))!.mz)).toEqual([50.0001, 60.5]);
    expect(Array.from((await getSpectrumArrays(mkReader(lattice, rec), 0)).mz)).toEqual([50.0001, 60.5]);
    expect(Array.from((await readEngineSpectrum(mkReader(lattice, rec), 0)).mz)).toEqual([50.0001, 60.5]);
  });

  it("…and independent of row order: fallback row FIRST, gridded row second (the axis is found from the first gridded row)", async () => {
    // Row 0 carries a usable mz; if the axis key were located from row 0 only, row 1's null-fill 0
    // would be read verbatim as m/z 0 (harvest [60.5, 0]; browse/engine [0, 60.5] after sorting).
    const rec: RawSpectrum = { id: "s", centroids: [{ mz: 60.5, intensity: 2, tof_index: 0n }, { mz: 0, intensity: 1, tof_index: 50_000_100_000n }] };
    expect(Array.from((await harvestDataArraysOrNull(mkReader(lattice, rec), 0))!.mz)).toEqual([60.5, 50.0001]); // harvest keeps stored order
    expect(Array.from((await getSpectrumArrays(mkReader(lattice, rec), 0)).mz)).toEqual([50.0001, 60.5]);
    expect(Array.from((await readEngineSpectrum(mkReader(lattice, rec), 0)).mz)).toEqual([50.0001, 60.5]);
    // The mangled "" axis key, same order.
    const mangled = { id: "s", centroids: [{ mz: 60.5, intensity: 2, "": 0n }, { mz: 0, intensity: 1, "": 50_000_100_000n }] } as unknown as RawSpectrum;
    expect(Array.from((await harvestDataArraysOrNull(mkReader(lattice, mangled), 0))!.mz)).toEqual([60.5, 50.0001]);
    // The absent-axis shape a whole-spectrum fallback most likely materialises as (mzpeakts drops
    // an all-null column): no key at all → verbatim.
    const noAxis: RawSpectrum = { id: "s", centroids: [{ mz: 100.5, intensity: 1 }, { mz: 200.25, intensity: 2 }] };
    expect(Array.from((await harvestDataArraysOrNull(mkReader(lattice, noAxis), 0))!.mz)).toEqual([100.5, 200.25]);
    expect(Array.from((await readEngineSpectrum(mkReader(lattice, noAxis), 0)).mz)).toEqual([100.5, 200.25]);
  });
});

describe("V3 — pre-lattice Shimadzu archives (tof_calibration only, f64 centroids) keep reading mz", () => {
  const preLattice = { tof_calibration: tofBlock };

  it("f64 centroids with no axis → verbatim, on every entry point", async () => {
    const rec: RawSpectrum = { id: "s", centroids: [{ mz: 74.059351852, intensity: 7543 }, { mz: 74.0605, intensity: 12 }] };
    expect(Array.from((await harvestDataArraysOrNull(mkReader(preLattice, rec, coeffs), 0))!.mz)).toEqual([74.059351852, 74.0605]);
    expect(Array.from((await getSpectrumArrays(mkReader(preLattice, rec, coeffs), 0)).mz)).toEqual([74.059351852, 74.0605]);
    expect(Array.from((await readEngineSpectrum(mkReader(preLattice, rec, coeffs), 0)).mz)).toEqual([74.059351852, 74.0605]);
    // …also for a spectrum whose coefficient columns are null (the profile facet is unresolvable,
    // but nothing here needs resolving).
    const noCoeff = mkReader(preLattice, rec, { MS_4000900_tof_c0: null, MS_4000901_tof_c1: null });
    expect(Array.from((await harvestDataArraysOrNull(noCoeff, 0))!.mz)).toEqual([74.059351852, 74.0605]);
    expect(Array.from((await getSpectrumArrays(noCoeff, 0)).mz)).toEqual([74.059351852, 74.0605]);
  });

  it("the profile facet's gridded rows (Int32 tof_index, zero-filled mz) → sqrt grid; its f64 fallback rows → verbatim", async () => {
    const gridded: RawSpectrum = { id: "s", dataArrays: { "m/z array": new Float64Array([0, 0]), tof_index: new Int32Array([100, 200]), "intensity array": new Float32Array([1, 2]) } };
    expect(Array.from((await harvestDataArraysOrNull(mkReader(preLattice, gridded, coeffs), 0))!.mz)).toEqual([sqrt(100), sqrt(200)]);
    expect(Array.from((await getSpectrumArrays(mkReader(preLattice, gridded, coeffs), 0)).mz)).toEqual([sqrt(100), sqrt(200)]);
    // mzpeakts drops an all-null Int32 axis column: the fallback record has only m/z + intensity.
    const fallback: RawSpectrum = { id: "s", dataArrays: { "m/z array": new Float64Array([70, 70.000626327]), "intensity array": new Float32Array([1, 2]) } };
    expect(Array.from((await harvestDataArraysOrNull(mkReader(preLattice, fallback, coeffs), 0))!.mz)).toEqual([70, 70.000626327]);
    expect(Array.from((await getSpectrumArrays(mkReader(preLattice, fallback, coeffs), 0)).mz)).toEqual([70, 70.000626327]);
  });

  it("a plain (non-grid) file is untouched: no blocks, f64 everywhere", async () => {
    const rec: RawSpectrum = { id: "s", dataArrays: { "m/z array": new Float64Array([100, 200]), "intensity array": new Float32Array([1, 2]) }, centroids: [{ mz: 150, intensity: 3 }] };
    expect(Array.from((await harvestDataArraysOrNull(mkReader({}, rec), 0))!.mz)).toEqual([100, 200]);
    expect(Array.from((await getSpectrumArrays(mkReader({}, withRepr(rec, REPR_CENTROID)), 0)).mz)).toEqual([150]);
    expect(Array.from((await getSpectrumArrays(mkReader({}, withRepr(rec, REPR_PROFILE)), 0)).mz)).toEqual([100, 200]);
  });
});
