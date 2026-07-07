// Pure unit tests for the engine reconstruction layer:
//   - sanitizePairs: non-finite-pair drop, ragged-length reconcile, ascending sort.
//   - reconstructSpectrum: representation routing, representation-PRESERVED-on-fallback
//     (the codex MAJOR fix — a fallback read must not rewrite the file's claim), and
//     the both-empty named throw.
import { describe, it, expect } from "vitest";
import {
  sanitizePairs,
  reconstructSpectrum,
  resolveGridMz,
  isGridFile,
  EmptySpectrumError,
  type RawSpectrum,
} from "./spectrum";
import type { Reader } from "../reader/openUrl";

describe("sanitizePairs", () => {
  it("returns the inputs unchanged (no copy) when finite, equal-length, ascending", () => {
    const mz = new Float64Array([100, 200, 300]);
    const intensity = new Float32Array([1, 2, 3]);
    const out = sanitizePairs(mz, intensity);
    expect(out.mz).toBe(mz); // same reference — fast path, no copy
    expect(out.intensity).toBe(intensity);
  });

  it("drops non-finite (mz, intensity) PAIRS", () => {
    const mz = new Float64Array([100, NaN, 200, 300]);
    const intensity = new Float32Array([1, 9, Infinity, 3]);
    const out = sanitizePairs(mz, intensity);
    // index 1 dropped (NaN mz), index 2 dropped (Inf intensity).
    expect(Array.from(out.mz)).toEqual([100, 300]);
    expect(Array.from(out.intensity)).toEqual([1, 3]);
  });

  it("reconciles a ragged mz/intensity length by truncating to the shorter", () => {
    const mz = new Float64Array([100, 200, 300, 400]);
    const intensity = new Float32Array([1, 2]); // shorter
    const out = sanitizePairs(mz, intensity);
    expect(out.mz.length).toBe(2);
    expect(out.intensity.length).toBe(2);
    expect(Array.from(out.mz)).toEqual([100, 200]);
    expect(Array.from(out.intensity)).toEqual([1, 2]);
  });

  it("SORTS by ascending m/z (keeping pair association)", () => {
    const mz = new Float64Array([300, 100, 200]);
    const intensity = new Float32Array([3, 1, 2]);
    const out = sanitizePairs(mz, intensity);
    expect(Array.from(out.mz)).toEqual([100, 200, 300]);
    expect(Array.from(out.intensity)).toEqual([1, 2, 3]); // intensity tracks its m/z
  });

  it("carries a mobility array through the SAME drop+reorder permutation", () => {
    // mobility-major input (NOT mz-sorted) with one non-finite pair to drop.
    const mz = new Float64Array([300, 100, NaN, 200]);
    const intensity = new Float32Array([3, 1, 9, 2]);
    const mobility = [1.5, 0.8, 0.8, 1.2]; // aligned with the input order
    const out = sanitizePairs(mz, intensity, mobility);
    expect(Array.from(out.mz)).toEqual([100, 200, 300]); // NaN pair dropped, sorted
    expect(Array.from(out.intensity)).toEqual([1, 2, 3]);
    expect(out.mobility && Array.from(out.mobility)).toEqual([0.8, 1.2, 1.5]); // tracks its peak
  });

  it("returns mobility on the already-clean fast path too", () => {
    const mz = new Float64Array([100, 200, 300]);
    const intensity = new Float32Array([1, 2, 3]);
    const out = sanitizePairs(mz, intensity, [0.8, 1.2, 1.5]);
    expect(out.mz).toBe(mz); // fast path: mz/intensity uncopied
    expect(out.mobility && Array.from(out.mobility)).toEqual([0.8, 1.2, 1.5]);
  });
});

describe("reconstructSpectrum representation routing + preservation", () => {
  const profileRec: RawSpectrum = {
    id: "scan=1",
    dataArrays: {
      "m/z array": [100, 200, 300],
      "intensity array": [10, 20, 30],
    },
  };
  const centroidRec: RawSpectrum = {
    id: "scan=2",
    centroids: [
      { mz: 150, intensity: 5 },
      { mz: 250, intensity: 7 },
    ],
  };

  it("routes profile → spectra_data and reports representation=profile", () => {
    const r = reconstructSpectrum(profileRec, 0, "profile");
    expect(r.representation).toBe("profile");
    expect(Array.from(r.mz)).toEqual([100, 200, 300]);
    expect(r.mz).toBeInstanceOf(Float64Array);
    expect(r.intensity).toBeInstanceOf(Float32Array);
  });

  it("routes centroid → spectra_peaks and reports representation=centroid", () => {
    const r = reconstructSpectrum(centroidRec, 1, "centroid");
    expect(r.representation).toBe("centroid");
    expect(Array.from(r.mz)).toEqual([150, 250]);
  });

  it("packs ion mobility (IMS) from a mobility-bearing centroid frame, aligned post-sort", () => {
    // A mobility-major TIMS frame: peaks NOT m/z-sorted, mobility repeats across peaks.
    const imsRec: RawSpectrum = {
      id: "merged=0 frame=1",
      centroids: [
        { mz: 300, intensity: 3, mean_inverse_reduced_ion_mobility: 1.50 },
        { mz: 100, intensity: 1, mean_inverse_reduced_ion_mobility: 0.85 },
        { mz: 200, intensity: 2, mean_inverse_reduced_ion_mobility: 0.85 },
      ],
    };
    const r = reconstructSpectrum(imsRec, 0, "centroid");
    expect(Array.from(r.mz)).toEqual([100, 200, 300]); // sorted by m/z
    expect(r.mobility).toBeDefined();
    expect(Array.from(r.mobility!.values)).toEqual([0.85, 1.5]); // distinct bins, ascending
    // mobility tracks each peak through the sort: 100→0.85, 200→0.85, 300→1.50
    expect(r.mobility!.index[0]).toBe(0);
    expect(r.mobility!.index[1]).toBe(0);
    expect(r.mobility!.index[2]).toBe(1);
  });

  it("omits mobility for a non-IMS centroid frame", () => {
    expect(reconstructSpectrum(centroidRec, 1, "centroid").mobility).toBeUndefined();
  });

  it("PRESERVES metadata representation when the routed source is empty and it falls back", () => {
    // File DECLARES centroid (MS:1000525) but only spectra_data has rows. The engine
    // falls back to data-arrays to render, but must NOT relabel it "profile".
    const r = reconstructSpectrum(profileRec, 2, "centroid");
    expect(Array.from(r.mz)).toEqual([100, 200, 300]); // rendered from fallback source
    expect(r.representation).toBe("centroid"); // ...but the file's claim is preserved
  });

  it("PRESERVES profile claim when routed source empty (centroid-only data)", () => {
    const r = reconstructSpectrum(centroidRec, 3, "profile");
    expect(Array.from(r.mz)).toEqual([150, 250]); // rendered from centroid fallback
    expect(r.representation).toBe("profile"); // declared-profile preserved
  });

  it("treats null (unknown) representation as the data-array default, reports null", () => {
    const r = reconstructSpectrum(profileRec, 4, null);
    expect(r.representation).toBeNull();
    expect(Array.from(r.mz)).toEqual([100, 200, 300]);
  });

  it("sanitizes the routed arrays (drops non-finite, sorts)", () => {
    const messy: RawSpectrum = {
      id: "scan=9",
      dataArrays: {
        "m/z array": [300, 100, NaN],
        "intensity array": [3, 1, 9],
      },
    };
    const r = reconstructSpectrum(messy, 5, "profile");
    expect(Array.from(r.mz)).toEqual([100, 300]);
    expect(Array.from(r.intensity)).toEqual([1, 3]);
  });

  it("throws EmptySpectrumError when BOTH sources are empty (never zeros)", () => {
    const empty: RawSpectrum = { id: "scan=0" };
    expect(() => reconstructSpectrum(empty, 6, "profile")).toThrow(EmptySpectrumError);
    expect(() => reconstructSpectrum(empty, 6, "centroid")).toThrow(EmptySpectrumError);
    expect(() => reconstructSpectrum(empty, 6, null)).toThrow(/Spectrum 6/);
  });

  it("renders a genuinely-empty scan (0-length m/z array) as empty, NOT an error", () => {
    // mzpeakts' empty-spectrum signal: a 0-length "m/z array" and nothing else. Common for
    // SciEX/Agilent survey scans interleaved with data scans.
    const emptyScan: RawSpectrum = { id: "scan=7", dataArrays: { "m/z array": [] } };
    const r = reconstructSpectrum(emptyScan, 7, "profile");
    expect(r.mz.length).toBe(0);
    expect(r.intensity.length).toBe(0);
    expect(r.representation).toBe("profile");
  });
});

describe("reconstructSpectrum ims-compact tof→m/z", () => {
  // The real BRFP/mzPeakConverter timsTOF calibration (MANIFEST.md). tof is absolute.
  const cal = { a: 9.74680332211541, b: 7.855554279925029e-05 };
  const mzOf = (tof: number) => (cal.a + cal.b * tof) ** 2;

  it("reconstructs mz=(a+b·tof)² from a tof-bearing centroid frame, mobility aligned", () => {
    // Mobility-major frame (NOT tof-sorted): no `mz` key, integer `tof` instead. mzpeakts
    // can't suffix-strip the 1-word "tof" name — verify the by-elimination column locate.
    const rec = {
      id: "frame=1",
      centroids: [
        { tof: 250000, intensity: 3, mean_inverse_reduced_ion_mobility: 1.5 },
        { tof: 100000, intensity: 1, mean_inverse_reduced_ion_mobility: 0.85 },
        { tof: 180000, intensity: 2, mean_inverse_reduced_ion_mobility: 0.85 },
      ],
    } as unknown as RawSpectrum;
    const r = reconstructSpectrum(rec, 0, "centroid", cal);
    // sorted by reconstructed m/z (tof is monotonic in m/z): 100k < 180k < 250k
    expect(Array.from(r.mz)).toEqual([mzOf(100000), mzOf(180000), mzOf(250000)]);
    expect(r.mz[0]).toBeCloseTo(309.84, 1); // sanity: real m/z magnitude, not a raw tof index
    expect(Array.from(r.intensity)).toEqual([1, 2, 3]);
    // mobility tracks each peak through the m/z sort
    expect(Array.from(r.mobility!.values)).toEqual([0.85, 1.5]);
    expect(Array.from(r.mobility!.index)).toEqual([0, 0, 1]);
  });

  it("handles the empty-string key mzpeakts emits for the 1-word tof array", () => {
    const rec = {
      id: "frame=2",
      centroids: [{ "": 100000, intensity: 5 }],
    } as unknown as RawSpectrum;
    const r = reconstructSpectrum(rec, 1, "centroid", cal);
    expect(r.mz[0]).toBeCloseTo(mzOf(100000), 6);
  });

  it("does NOT touch m/z when a real `mz` key is present (standard archive)", () => {
    const rec: RawSpectrum = { id: "s", centroids: [{ mz: 150, intensity: 5 }] };
    expect(Array.from(reconstructSpectrum(rec, 2, "centroid", cal).mz)).toEqual([150]);
  });
});

describe("reconstructSpectrum ims-compact Layout A (per-scan delta tof)", () => {
  // mz = (a + b·tof)² with a,b chosen so absolute tofs give round m/z. tof is stored as a
  // per-mobility-scan delta: first-of-scan absolute, rest deltas; scan boundary = 1/K0 change.
  const A = 10, B = 0.0001;
  const mzOf = (tof: number) => (A + B * tof) ** 2;
  // Frame: scan 0 (1/K0 0.80) abs tof 50k,80k,120k → deltas 50k,30k,40k; scan 1 (0.95) abs 60k,100k → 60k,40k.
  const frame = {
    id: "frame=0",
    centroids: [
      { tof: 50000, intensity: 1, mean_inverse_reduced_ion_mobility: 0.8 },
      { tof: 30000, intensity: 2, mean_inverse_reduced_ion_mobility: 0.8 },
      { tof: 40000, intensity: 3, mean_inverse_reduced_ion_mobility: 0.8 },
      { tof: 60000, intensity: 4, mean_inverse_reduced_ion_mobility: 0.95 },
      { tof: 40000, intensity: 5, mean_inverse_reduced_ion_mobility: 0.95 },
    ],
  } as unknown as RawSpectrum;
  const deltaCal = { a: A, b: B, tofEncoding: "per-scan-delta" as const };

  it("cumsums tof within a scan and resets on the 1/K0 change", () => {
    const r = reconstructSpectrum(frame, 0, "centroid", deltaCal);
    // absolute tof reconstructs to 50k,80k,120k (scan0) and 60k,100k (scan1) → these m/z, then m/z-sorted:
    // 225(i1,.80) 256(i4,.95) 324(i2,.80) 400(i5,.95) 484(i3,.80)
    expect(Array.from(r.mz)).toEqual([mzOf(50000), mzOf(60000), mzOf(80000), mzOf(100000), mzOf(120000)]);
    expect(Array.from(r.mz)).toEqual([225, 256, 324, 400, 484]);
    expect(Array.from(r.intensity)).toEqual([1, 4, 2, 5, 3]);
    expect(Array.from(r.mobility!.values)).toEqual([0.8, 0.95]);
    expect(Array.from(r.mobility!.index)).toEqual([0, 1, 0, 1, 0]);
  });

  it("differs from the naive no-cumsum read (proves the delta decode fires)", () => {
    // Without cumsum, mzFromTof would be applied to the raw deltas → a WRONG spectrum.
    const wrong = new Set([mzOf(30000), mzOf(40000)].map((x) => Math.round(x))); // 169, 196
    const r = reconstructSpectrum(frame, 0, "centroid", deltaCal);
    for (const m of r.mz) expect(wrong.has(Math.round(m))).toBe(false);
  });

  it("tofEncoding 'absolute' does NOT cumsum (raw tof used directly)", () => {
    const absCal = { a: A, b: B, tofEncoding: "absolute" as const };
    const r = reconstructSpectrum(frame, 0, "centroid", absCal);
    // raw tofs 50k,30k,40k,60k,40k → m/z-sorted set of mzOf(raw)
    expect(new Set(r.mz)).toEqual(new Set([50000, 30000, 40000, 60000, 40000].map(mzOf)));
  });

  it("per-scan-delta WITHOUT mobility falls back to absolute (no crash, no cumsum)", () => {
    const noMob = { id: "f", centroids: [{ tof: 50000, intensity: 1 }, { tof: 30000, intensity: 2 }] } as unknown as RawSpectrum;
    const r = reconstructSpectrum(noMob, 0, "centroid", deltaCal);
    expect(new Set(r.mz)).toEqual(new Set([mzOf(50000), mzOf(30000)]));
  });
});

describe("reconstructSpectrum ims-compact Layout B (m/z-chunked tof — PROVISIONAL)", () => {
  // Layout B lives in the CHUNKED (data-array) facet with a `tof` axis instead of an `m/z array`.
  // PROVISIONAL: the --ims-chunked schema isn't frozen; this asserts the (a+b·tof)² reconstruction
  // in the data-array path, assuming mzpeakts already chunk-decoded the per-chunk tof deltas.
  const A = 10, B = 0.0001;
  const mzOf = (tof: number) => (A + B * tof) ** 2;
  const chunkedCal = { a: A, b: B, tofEncoding: "m/z-chunked" as const };

  it("reconstructs mz=(a+b·tof)² from a chunked-facet `tof` data array (mobility carried)", () => {
    const rec = { id: "frame=0", dataArrays: {
      tof: [50000, 80000, 120000],
      "intensity array": [3, 5, 2],
      "mean inverse reduced ion mobility array": [0.8, 0.9, 1.0],
    } } as unknown as RawSpectrum;
    const r = reconstructSpectrum(rec, 0, "profile", chunkedCal);
    expect(Array.from(r.mz)).toEqual([mzOf(50000), mzOf(80000), mzOf(120000)]);
    expect(Array.from(r.mz)).toEqual([225, 324, 484]);
    expect(Array.from(r.intensity)).toEqual([3, 5, 2]);
    expect(Array.from(r.mobility!.values)).toEqual([0.8, 0.9, 1.0]);
  });

  it("prefers a real `m/z array` even when tofEncoding is m/z-chunked (no hijack)", () => {
    const rec = { id: "x", dataArrays: {
      "m/z array": [111, 222], tof: [1, 2], "intensity array": [4, 5],
    } } as unknown as RawSpectrum;
    const r = reconstructSpectrum(rec, 0, "profile", chunkedCal);
    expect(new Set(r.mz)).toEqual(new Set([111, 222]));
  });

  it("does NOT apply the tof transform for Layout A (per-scan-delta) in the data-array path", () => {
    // Layout A is centroid-facet only; a per-scan-delta cal must not trigger the chunked tof branch.
    const rec = { id: "x", dataArrays: {
      tof: [50000], "intensity array": [9],
    } } as unknown as RawSpectrum;
    const perScan = { a: A, b: B, tofEncoding: "per-scan-delta" as const };
    // tof branch requires tofEncoding==='m/z-chunked'; here it's skipped → no m/z array → fail loud.
    expect(() => reconstructSpectrum(rec, 0, "profile", perScan)).toThrow(EmptySpectrumError);
  });
});

describe("reconstructSpectrum SciEX grid tof_index→m/z (profile)", () => {
  // Profile spectrum carrying integer `tof_index` instead of an `m/z array`.
  const gridRec: RawSpectrum = {
    id: "scan=1",
    dataArrays: { tof_index: [1_000_000, 2_000_000, 3_000_000], "intensity array": [5, 9, 7] },
  };

  it("mz-grid (uniform): mz = tof_index / scale", () => {
    const mzScale = (i: number) => i / 10_000; // sciex_uniform_mz, scale=10000
    const r = reconstructSpectrum(gridRec, 0, "profile", null, mzScale);
    expect(Array.from(r.mz)).toEqual([100, 200, 300]);
    expect(Array.from(r.intensity)).toEqual([5, 9, 7]);
    expect(r.representation).toBe("profile");
  });

  it("tof-grid (sqrt): mz = (c0 + c1·tof_index)²", () => {
    const c0 = 0.05, c1 = 0.0003;
    const r = reconstructSpectrum(gridRec, 0, "profile", null, (i) => (c0 + c1 * i) ** 2);
    expect(r.mz[0]).toBeCloseTo((c0 + c1 * 1_000_000) ** 2, 6);
    expect(r.mz[2]).toBeCloseTo((c0 + c1 * 3_000_000) ** 2, 6);
  });

  it("without a grid resolver, a tof_index-only profile spectrum fails loud (no silent zeros)", () => {
    expect(() => reconstructSpectrum(gridRec, 0, "profile")).toThrow(EmptySpectrumError);
  });

  it("CENTROID tof_index axis but NO resolver fails loud (not silent empty)", () => {
    const rec = { id: "x", centroids: [{ intensity: 5, tof_index: 1000 }, { intensity: 9, tof_index: 2000 }] } as unknown as RawSpectrum;
    expect(() => reconstructSpectrum(rec, 0, "centroid")).toThrow(EmptySpectrumError);
  });

  it("reconstructs grid m/z from a CENTROID tof_index spectrum (SciEX SWATH stores grid in peaks)", () => {
    const gridMz = (i: number) => (0.05 + 0.0003 * i) ** 2;
    // real mzpeakts mangles the 1-word "tof_index" to "" — test both the "" and named key.
    for (const axisKey of ["tof_index", ""]) {
      const rec = { id: "s", centroids: [{ intensity: 5, [axisKey]: 1_000_000 }, { intensity: 9, [axisKey]: 2_000_000 }] } as unknown as RawSpectrum;
      const r = reconstructSpectrum(rec, 0, "centroid", null, gridMz);
      expect(Array.from(r.mz)).toEqual([gridMz(1_000_000), gridMz(2_000_000)]);
      expect(Array.from(r.intensity)).toEqual([5, 9]);
    }
  });

  it("renders a no-signal scan (empty dataArrays, no centroids) as empty, not an error", () => {
    const r = reconstructSpectrum({ id: "survey", dataArrays: {} } as unknown as RawSpectrum, 0, "profile");
    expect(r.mz.length).toBe(0);
  });
});

describe("resolveGridMz — calibration-shape gating", () => {
  // coeffs are keyed by their full metadata field name (e.g. "MZP_1000003_tof_c0" or
  // "MS_4000900_tof_c0"); the reader exposes them via getChild AND lists them in type.children
  // so the suffix-based lookup (fieldBySuffix) can find them.
  const mkReader = (metadata: Record<string, unknown>, coeffs?: Record<string, number>): Reader =>
    ({
      store: { fileIndex: { metadata } },
      spectrumMetadata: coeffs ? {
        spectra: {
          getChild: (n: string) => ({ get: () => coeffs[n] }),
          type: { children: Object.keys(coeffs).map((name) => ({ name })) },
        },
      } : undefined,
    }) as unknown as Reader;

  it("mz-grid → idx/scale", () => {
    const f = resolveGridMz(mkReader({ mz_calibration: { codec: "mz-grid", scale: 10_000 } }), 0)!;
    expect(f).toBeTypeOf("function");
    expect(f(1_000_000)).toBe(100);
  });

  const tofGridMeta = { tof_calibration: { codec: "tof-grid", model: "sciex_sqrt", per_spectrum_columns: ["tof_c0", "tof_c1"], tof_to_mz: "mz = (tof_c0 + tof_c1*tof_index)^2" } };

  it("tof-grid sqrt with per-spectrum (c0,c1) → (c0+c1·idx)²", () => {
    const f = resolveGridMz(mkReader(tofGridMeta, { MZP_1000003_tof_c0: 0.05, MZP_1000004_tof_c1: 0.0003 }), 0)!;
    expect(f(1_000_000)).toBeCloseTo((0.05 + 0.0003 * 1_000_000) ** 2, 6);
  });

  it("accepts the CURRENT model name sciex_sqrt_per_spectrum", () => {
    const meta = { tof_calibration: { codec: "tof-grid", model: "sciex_sqrt_per_spectrum", per_spectrum_columns: ["tof_c0", "tof_c1"] } };
    expect(isGridFile(mkReader(meta))).toBe(true);
    const f = resolveGridMz(mkReader(meta, { MZP_1000003_tof_c0: 0.05, MZP_1000004_tof_c1: 0.0003 }), 0)!;
    expect(f(1_000_000)).toBeCloseTo((0.05 + 0.0003 * 1_000_000) ** 2, 6);
  });

  it("resolves per-spectrum coeffs by SUFFIX, surviving the MZP→MS accession drift", () => {
    const meta = { tof_calibration: { codec: "tof-grid", model: "sciex_sqrt_per_spectrum", per_spectrum_columns: ["tof_c0", "tof_c1"] } };
    // current corpus uses MS_4000900_tof_c0 / MS_4000901_tof_c1 (not MZP_1000003/4)
    const f = resolveGridMz(mkReader(meta, { MS_4000900_tof_c0: 0.05, MS_4000901_tof_c1: 0.0003 }), 0)!;
    expect(f(1_000_000)).toBeCloseTo((0.05 + 0.0003 * 1_000_000) ** 2, 6);
  });

  it("global sciex_sqrt (no per_spectrum_columns) → run-wide c0/c1 from the block", () => {
    const meta = { tof_calibration: { codec: "tof-grid", model: "sciex_sqrt", c0: 0.05, c1: 0.0003 } };
    expect(isGridFile(mkReader(meta))).toBe(true);
    const f = resolveGridMz(mkReader(meta), 0)!; // no per-spectrum coeffs needed
    expect(f(1_000_000)).toBeCloseTo((0.05 + 0.0003 * 1_000_000) ** 2, 6);
  });

  it("sciex_sqrt is gated on model+columns ONLY — not the tof_to_mz formula string", () => {
    // A reformatted/absent formula must NOT break SciEX (we gate on `model` + per_spectrum_columns).
    for (const tof_to_mz of [undefined, "", "m/z = (tof_c0+tof_c1*tof_index)**2 /* reformatted */"]) {
      const meta = { tof_calibration: { codec: "tof-grid", model: "sciex_sqrt", per_spectrum_columns: ["tof_c0", "tof_c1"], ...(tof_to_mz === undefined ? {} : { tof_to_mz }) } };
      expect(isGridFile(mkReader(meta))).toBe(true);
      expect(resolveGridMz(mkReader(meta, { MZP_1000003_tof_c0: 1, MZP_1000004_tof_c1: 2 }), 0)!(3)).toBe((1 + 2 * 3) ** 2);
    }
  });

  it("tof-grid resolver is null for a spectrum whose c0/c1 are null (empty survey scan)", () => {
    expect(resolveGridMz(mkReader(tofGridMeta, { MZP_1000003_tof_c0: null as unknown as number, MZP_1000004_tof_c1: null as unknown as number }), 0)).toBeNull();
    // ...but isGridFile is coeff-INDEPENDENT, so the file is still recognised as a grid file.
    expect(isGridFile(mkReader(tofGridMeta))).toBe(true);
  });

  it("accepts a JSON-STRING calibration value (not just an inlined object)", () => {
    const f = resolveGridMz(mkReader({ mz_calibration: JSON.stringify({ codec: "mz-grid", scale: 5 }) }), 0)!;
    expect(f(50)).toBe(10);
  });

  it("UNRECOGNISED tof-grid model → resolveGridMz null (fail loud per-select); isGridFile still gates", () => {
    const meta = { tof_calibration: { codec: "tof-grid", model: "some_future_model", calibrations: { "1": {} }, tof_to_mz: "mz = f(t)" } };
    expect(resolveGridMz(mkReader(meta), 0)).toBeNull();
    expect(isGridFile(mkReader(meta))).toBe(true); // grid-encoded → still skip prefetch / imaging cache
  });

  it("rejects a sciex_sqrt tof-grid that carries calibrations[] (wrong shape)", () => {
    const meta = { tof_calibration: { codec: "tof-grid", model: "sciex_sqrt", calibrations: [{}], per_spectrum_columns: ["tof_c0", "tof_c1"], tof_to_mz: "mz = (tof_c0 + tof_c1*tof_index)^2" } };
    expect(resolveGridMz(mkReader(meta), 0)).toBeNull();
  });

  // Golden values from the Rust `calibrated_mz` reference applied to the REAL Agilent
  // calibration (LMVCS24HC.mzpeak, cal id 1, use_flags 2784 → poly orders [5,6,7,9,11]).
  const agilentMeta = {
    tof_calibration: {
      codec: "tof-grid", model: "agilent_sqrt_poly",
      per_spectrum_columns: ["tof_c0", "tof_c1", "tof_calibration_id"],
      calibrations: {
        "1": {
          base: 1009.2061455961, coeff: 0.000347598319421502,
          left: 32271.5762139714, right: 151101.329002531, use_flags: 2784,
          poly_coeffs: [-3.04810336539477e-27, 1.02446004110928e-31, -9.11947533177548e-37, 2.31622840884782e-47, -3.11029623231747e-58, 0.0],
        },
      },
    },
  };
  const agilentCoeffs = { MZP_1000003_tof_c0: 9.999289198935587, MZP_1000004_tof_c1: 0.000173799159710751, MZP_1000005_tof_calibration_id: 1 };

  it("agilent-grid sqrt+poly: matches the Rust calibrated_mz golden values (incl. left-clamp)", () => {
    const f = resolveGridMz(mkReader(agilentMeta, agilentCoeffs), 0)!;
    expect(f).toBeTypeOf("function");
    // k=0: t (29776) < left (32271) → poly clamps to `left`. Golden from agilent_profile.rs.
    expect(f(0)).toBeCloseTo(99.9858078304, 8);
    expect(f(1_000)).toBeCloseTo(103.4917500992, 8);
    expect(f(50_000)).toBeCloseTo(349.2879468214, 8);
    expect(f(150_000)).toBeCloseTo(1300.9838444574, 7);
    expect(f(300_000)).toBeCloseTo(3861.2612960494, 6);
    expect(f(400_000)).toBeCloseTo(6323.2652622768, 6);
  });

  it("agilent-grid: use_flags=0 → pure quadratic (no poly correction)", () => {
    const meta = { tof_calibration: { ...agilentMeta.tof_calibration, calibrations: { "1": { ...agilentMeta.tof_calibration.calibrations["1"], use_flags: 0 } } } };
    const f = resolveGridMz(mkReader(meta, agilentCoeffs), 0)!;
    const lin = agilentCoeffs.MZP_1000003_tof_c0 + agilentCoeffs.MZP_1000004_tof_c1 * 50_000;
    expect(f(50_000)).toBeCloseTo(lin * lin, 10);
  });

  it("agilent-grid: null when the per-spectrum calibration_id has no calibration row", () => {
    expect(resolveGridMz(mkReader(agilentMeta, { ...agilentCoeffs, MZP_1000005_tof_calibration_id: 99 }), 0)).toBeNull();
  });

  it("agilent-grid: resolves when calibration_id arrives as a BigInt (int64 Arrow column)", () => {
    // Arrow-JS returns int64 cells as BigInt; the id must still map to the "1" calibration key.
    const coeffs = { ...agilentCoeffs, MZP_1000005_tof_calibration_id: 1n as unknown as number };
    const f = resolveGridMz(mkReader(agilentMeta, coeffs), 0)!;
    expect(f).toBeTypeOf("function");
    expect(f(50_000)).toBeCloseTo(349.2879468214, 8);
  });

  it("agilent-grid: malformed calibration metadata fails loud (null), never throws", () => {
    const withCal = (cal: unknown) => ({ tof_calibration: { ...agilentMeta.tof_calibration, calibrations: { "1": cal } } });
    const good = agilentMeta.tof_calibration.calibrations["1"];
    // null row, non-finite/zero coeff, inverted window, bad use_flags, non-numeric poly → all reject.
    for (const bad of [
      null,
      { ...good, coeff: 0 },
      { ...good, coeff: "x" },
      { ...good, base: NaN },
      { ...good, left: 200000, right: 100000 }, // left > right
      { ...good, use_flags: 2.5 },
      { ...good, use_flags: -1 },
      { ...good, poly_coeffs: "nope" },
      { ...good, poly_coeffs: [1, "two", 3] },
    ]) {
      const r = mkReader(withCal(bad), agilentCoeffs);
      expect(() => resolveGridMz(r, 0)).not.toThrow();
      expect(resolveGridMz(r, 0)).toBeNull();       // unresolvable → fail loud per-select
      expect(isGridFile(r)).toBe(true);             // ...but still grid-encoded → gates fire
    }
  });

  it("isGridFile is true for an UNRESOLVABLE grid codec (gates fire), but resolveGridMz is null", () => {
    const meta = { tof_calibration: { codec: "tof-grid", model: "future_unknown_model" } };
    expect(isGridFile(mkReader(meta))).toBe(true);          // gate: skip prefetch / imaging ion cache
    expect(resolveGridMz(mkReader(meta), 0)).toBeNull();    // resolver: can't reconstruct → fail loud per-select
  });

  it("isGridFile: true for mz-grid + tof-grid + agilent-grid, false otherwise", () => {
    expect(isGridFile(mkReader({ mz_calibration: { codec: "mz-grid", scale: 10_000 } }))).toBe(true);
    expect(isGridFile(mkReader(tofGridMeta))).toBe(true);
    expect(isGridFile(mkReader(agilentMeta))).toBe(true);
    expect(isGridFile(mkReader({}))).toBe(false);
    expect(isGridFile(mkReader({ ims_calibration: { a: 1, b: 2 } }))).toBe(false);
  });

  it("returns null when there is no grid calibration", () => {
    expect(resolveGridMz(mkReader({}), 0)).toBeNull();
  });
});
