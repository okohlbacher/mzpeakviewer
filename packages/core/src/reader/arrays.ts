// Reconstruct one spectrum's signal as plain typed arrays.
//
// Keeps m/z at float64 precision and intensity at float32. Returns
// `Float64Array`/`Float32Array` only — no Arrow Vectors leak upward.
//
// The per-row decode goes through the ENGINE's facet readers (`engine/spectrum
// readFacetSignal`): a grid-encoded facet (Shimadzu Int64 `mz-grid` lattice, SciEX `mz-grid`,
// SciEX/Agilent `tof-grid`, ims-compact `tof`) stores its m/z as an integer axis beside a NULL
// `mz` that mzpeakts materialises as 0, so reading `mz` verbatim yields a spectrum of zeros
// (finite, non-descending — nothing downstream would notice). Only the SOURCE ORDER is decided
// here; the codec logic lives in one place.
import type { Reader } from "./openUrl";
import {
  readFacetSignal,
  readImsCalibration,
  resolveFacetGridMz,
  type GridFacet,
  type RawSpectrum,
} from "../engine/spectrum";

// The integer grid axis (SciEX/Agilent/Shimadzu `tof_index`, MS:1000519) as mzpeakts keys it
// in dataArrays; centroid objects carry it as a property (the 1-word name is often mangled to "").
const GRID_AXIS_KEY = "tof_index";
const isIntAxis = (v: unknown): boolean => typeof v === "number" || typeof v === "bigint";

/**
 * Fail loud on a GRID-ENCODED spectrum when NO resolver is available for it — the backstop for a
 * file whose index blocks are missing or malformed (`resolveFacetGridMz` → null on both facets
 * and no `ims_calibration`): a gridded row stores its m/z as an integer `tof_index` beside a NULL
 * `mz` that mzpeakts materialises as 0, so reading `mz` verbatim would yield a spectrum of zeros
 * (finite, non-descending — sanitizePairs keeps it). With a resolver present the raw readers
 * reconstruct through `engine/spectrum readFacetSignal` instead and never call this. A facet
 * whose axis column is entirely null for this spectrum (the f64 fallback rows) is dropped by
 * mzpeakts and passes through; a fallback spectrum whose null Int64 axis reads back as `0n`
 * beside a real `mz` also passes (its `mz` is usable).
 */
export function assertNoGridAxis(spectrum: RawSpectrum, index: number, facet: GridFacet | "both" = "both"): void {
  const da = spectrum.dataArrays as Record<string, unknown> | undefined;
  if (facet !== "centroid" && da && da[GRID_AXIS_KEY] != null) {
    throw new Error(`Spectrum ${index}: grid-encoded data arrays (tof_index) need per-spectrum reconstruction (engine/spectrum)`);
  }
  const c0 = spectrum.centroids?.[0] as Record<string, unknown> | undefined;
  if (facet !== "profile" && c0 && (c0["mz"] == null || c0["mz"] === 0)) {
    for (const k of Object.keys(c0)) {
      if (k !== "mz" && k !== "intensity" && k !== "mean_inverse_reduced_ion_mobility" && isIntAxis(c0[k])) {
        throw new Error(`Spectrum ${index}: grid-encoded centroids (${k || "tof_index"}) need per-spectrum reconstruction (engine/spectrum)`);
      }
    }
  }
}

/**
 * Ion-image / mean source read: read one spectrum's (mz, intensity) DIRECTLY
 * from the DATA-ARRAY source (spectra_data point intensities), falling back to the
 * centroid source (spectra_peaks) only when the spectrum has no data arrays.
 *
 * Source selection does NOT route by the file's declared representation: data
 * arrays are tried first, then centroids. A file declared centroid that ALSO
 * carries data arrays therefore sums the data-array intensities, not the
 * spectra_peaks centroids.
 *
 * Each source is decoded through the engine's per-facet reader (`readFacetSignal`), so a
 * grid-encoded facet reconstructs its m/z from the integer axis (BigInt coerced) exactly as
 * the Spectra view does; a grid axis with no resolver throws (`UnresolvedGridAxisError` /
 * `assertNoGridAxis`), never silent zeros.
 *
 * Returns `null` (never throws) when the spectrum is absent or has neither source,
 * so the ion-image / mean loop can simply skip an undecodable pixel.
 */
export async function harvestDataArraysOrNull(
  reader: Reader,
  index: number,
): Promise<{ mz: Float64Array; intensity: Float32Array } | null> {
  let spectrum: RawSpectrum | null;
  try {
    spectrum = (await reader.getSpectrum(index)) as RawSpectrum | null;
  } catch {
    return null;
  }
  if (!spectrum) return null;
  // Resolve once per spectrum (the resolvers parse the index metadata); a file with NO resolver
  // on either facet (and no ims-compact calibration) cannot read a grid axis at all — fail loud
  // up front (imaging already refuses unresolvable grid files via isGridFile; this is the
  // per-spectrum backstop). readFacetSignal fails loud per facet for the partially-resolvable case.
  const grid = resolveFacetGridMz(reader, index);
  const cal = readImsCalibration(reader);
  if (!grid.profile && !grid.centroid && !cal) assertNoGridAxis(spectrum, index);
  // Data-array source FIRST (spectra_data) — the ion-image source of truth.
  const prof = readFacetSignal(spectrum, index, "profile", grid, cal);
  if (prof) {
    if (prof.mz.length !== prof.intensity.length) {
      throw new Error(`Spectrum ${index}: m/z (${prof.mz.length}) and intensity (${prof.intensity.length}) length mismatch`);
    }
    return { mz: prof.mz, intensity: prof.intensity };
  }
  // Fall back to centroids ONLY when there are genuinely no data arrays.
  const cent = readFacetSignal(spectrum, index, "centroid", grid, cal);
  if (cent) return { mz: cent.mz, intensity: cent.intensity };
  return null; // no decodable signal — caller skips this spectrum
}
