// Reconstruct one spectrum's signal as plain typed arrays.
//
// Keeps m/z at float64 precision and intensity at float32. Returns
// `Float64Array`/`Float32Array` only — no Arrow Vectors leak upward.
import type { Reader } from "./openUrl";
import type { SpectrumArrays } from "./types";

// mzpeakts names the reconstructed columns by their human-readable CV name.
const MZ_KEY = "m/z array";
const INTENSITY_KEY = "intensity array";

// The spectrum record shape mzpeakts returns from getSpectrum(index). Only the
// two signal sources matter here; both are populated conditionally by row count.
type RawSpectrum = {
  id: unknown;
  dataArrays?: Record<string, ArrayLike<number>> | undefined;
  centroids?: { mz: number; intensity: number }[] | undefined;
};

/**
 * Reconstruct from the data-array source (spectra_data → profile). Preserves the
 * length-mismatch guard and f64/f32 dtype copies. Throws a named error when the
 * dataArrays source is absent — never returns silent zeros.
 */
function fromDataArrays(spectrum: RawSpectrum, index: number): SpectrumArrays {
  const id = String(spectrum.id);
  const da = spectrum.dataArrays;
  // Explicit profile-path fail-loud guard (mirror of the centroid "no rows"
  // throw). A profile-routed spectrum whose data-array source is null or missing
  // the m/z / intensity arrays must throw a named error, never fall through to a
  // silent blank spectrum. This distinguishes "spectra_data has no arrays" from
  // a length mismatch below.
  if (!da || !da[MZ_KEY] || !da[INTENSITY_KEY]) {
    throw new Error(`spectra_data has no arrays for spectrum ${index}`);
  }
  const rawMz = da[MZ_KEY];
  const rawIntensity = da[INTENSITY_KEY];
  // Copy into the canonical dtypes (preserve f64 m/z precision).
  const mz = Float64Array.from(rawMz);
  const intensity = Float32Array.from(rawIntensity);
  if (mz.length !== intensity.length) {
    throw new Error(
      `Spectrum ${index}: m/z (${mz.length}) and intensity ` +
        `(${intensity.length}) length mismatch`,
    );
  }
  return { index, id, mz, intensity };
}

/**
 * Reconstruct from the centroid source (spectra_peaks → centroid). Throws a
 * NAMED error when the routed centroid source has zero rows so a centroid
 * spectrum is never rendered as a silent blank.
 */
function fromCentroids(spectrum: RawSpectrum, index: number): SpectrumArrays {
  const id = String(spectrum.id);
  const centroids = spectrum.centroids;
  if (centroids && centroids.length > 0) {
    const n = centroids.length;
    const mz = new Float64Array(n);
    const intensity = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      mz[i] = centroids[i]!.mz;
      intensity[i] = centroids[i]!.intensity;
    }
    return { index, id, mz, intensity };
  }
  // Routed to centroid but spectra_peaks has no rows — fail loud, distinct from
  // "no spectrum at index". Never emit silent zeros for a centroid spectrum.
  throw new Error(
    `Spectrum ${index}: centroid representation but spectra_peaks has no rows`,
  );
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
  // Data-array source FIRST (spectra_data) — the ion-image source of truth.
  const da = spectrum.dataArrays;
  if (da && da[MZ_KEY] && da[INTENSITY_KEY]) {
    const arr = fromDataArrays(spectrum, index);
    return { mz: arr.mz, intensity: arr.intensity };
  }
  // Fall back to centroids ONLY when there are genuinely no data arrays.
  const centroids = spectrum.centroids;
  if (centroids && centroids.length > 0) {
    const arr = fromCentroids(spectrum, index);
    return { mz: arr.mz, intensity: arr.intensity };
  }
  return null; // no decodable signal — caller skips this spectrum
}
