// Pure unit tests for the engine reconstruction layer:
//   - sanitizePairs: non-finite-pair drop, ragged-length reconcile, ascending sort.
//   - reconstructSpectrum: representation routing, representation-PRESERVED-on-fallback
//     (the codex MAJOR fix — a fallback read must not rewrite the file's claim), and
//     the both-empty named throw.
import { describe, it, expect } from "vitest";
import {
  sanitizePairs,
  reconstructSpectrum,
  EmptySpectrumError,
  type RawSpectrum,
} from "./spectrum";

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
});
