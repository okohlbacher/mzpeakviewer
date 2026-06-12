// Reconstruct one spectrum's signal as plain typed arrays.
//
// Keeps m/z at float64 precision (PITFALLS 9) and intensity at float32. Returns
// `Float64Array`/`Float32Array` only — no Arrow Vectors leak upward.
import type { Reader } from "./openUrl";
import type { SpectrumArrays, SpectrumRepresentation } from "./types";

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
  // throw): a profile-routed spectrum whose data-array source is null or missing
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
 * NAMED error when the routed centroid source has zero rows (Pitfall 7) so a
 * centroid spectrum is never rendered as a silent blank.
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
 * Read + reconstruct spectrum `index` into `{ mz, intensity }`.
 *
 * Legacy try-order variant (callers WITHOUT a representation — the numeric index
 * input on non-imaging files). For profile/point spectra mzpeakts populates
 * `spectrum.dataArrays`; for centroid spectra it populates `spectrum.centroids`.
 * Tries dataArrays first, then falls back to centroids, else throws.
 *
 * Representation-aware routing (DATA-03 / IMAGING-SPEC C6) lives in
 * `getSpectrumArraysFor`; prefer it whenever a representation is known.
 */
export async function getSpectrumArrays(
  reader: Reader,
  index: number,
): Promise<SpectrumArrays> {
  const spectrum = (await reader.getSpectrum(index)) as RawSpectrum | null;
  if (!spectrum) {
    throw new Error(`No spectrum at index ${index}`);
  }

  const da = spectrum.dataArrays;
  if (da && da[MZ_KEY] && da[INTENSITY_KEY]) {
    return fromDataArrays(spectrum, index);
  }

  // Centroid fallback (spectra_peaks).
  const centroids = spectrum.centroids;
  if (centroids && centroids.length > 0) {
    return fromCentroids(spectrum, index);
  }

  // No decodable signal arrays — fail loud rather than render silent zeros.
  throw new Error(
    `Spectrum ${index} has no reconstructable m/z + intensity arrays`,
  );
}

/**
 * Ion-image / mean source read: harvest one spectrum's (mz, intensity) DIRECTLY
 * from the DATA-ARRAY source (spectra_data point intensities), falling back to the
 * centroid source (spectra_peaks) only when the spectrum has no data arrays.
 *
 * This is the SAME source-selection IV's ion-image path uses: IV builds its in-
 * memory ion index from spectra_data (`forEachSpectraRowGroup` / `pointVecs` over
 * spectra_data.parquet, mzPeakWorker.ts), and its legacy `getSpectrumArrays` tries
 * dataArrays first, then centroids — it does NOT route by the file's declared
 * representation. A file declared centroid that ALSO carries data arrays therefore
 * sums the data-array intensities (matching IV), not the spectra_peaks centroids.
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
  // Data-array source FIRST (spectra_data) — the IV ion-image source of truth.
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

/**
 * Read + reconstruct spectrum `index`, routing the source by `representation`
 * (DATA-03 / IMAGING-SPEC C6) rather than incidental try-order:
 *   - `"centroid"` → centroid source (spectra_peaks); empty → named throw.
 *   - `"profile"` or `null` → data-array source (spectra_data); profile-default.
 *
 * This is the deterministic, testable file-routing variant the store uses so a
 * centroid spectrum is never read as profile zeros and vice versa.
 */
export async function getSpectrumArraysFor(
  reader: Reader,
  index: number,
  representation: SpectrumRepresentation,
): Promise<SpectrumArrays> {
  const spectrum = (await reader.getSpectrum(index)) as RawSpectrum | null;
  if (!spectrum) {
    throw new Error(`No spectrum at index ${index}`);
  }
  if (representation === "centroid") {
    return fromCentroids(spectrum, index);
  }
  // Profile or null (unknown MS:1000525) → documented profile/dataArrays default.
  return fromDataArrays(spectrum, index);
}
