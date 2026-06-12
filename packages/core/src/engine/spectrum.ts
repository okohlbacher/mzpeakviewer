// Engine spectrum read: reconstruct one spectrum's signal, then adapt to the wire
// `SpectrumArrays`. The reconstruction (choosing the profile vs centroid source and
// resolving the representation) is a PURE, separately-testable function operating on
// the already-fetched raw mzpeakts spectrum record — this is the M4 reconstruction
// helper codex asked for. The live reader call is the only I/O; everything else is
// pure so it can be unit-tested without WASM.
//
// Routing (DATA-03 / IMAGING-SPEC C6), mirrors mzPeakIV src/reader/arrays.ts +
// Explorer's cv.ts:
//   - representation "centroid" → centroid source (spectra_peaks).
//   - representation "profile" / null → data-array source (spectra_data), the
//     documented profile default.
//   - when the routed source is empty we fall through to the OTHER source rather
//     than emitting silent zeros (incidental try-order is the last resort, matching
//     IV's getSpectrumArrays).

import type { SpectrumArrays as WireSpectrumArrays } from "@mzpeak/contracts";
import { adaptSpectrum } from "../adapt/spectrum";
import { spectrumMeta } from "../reader/fileMeta";
import type { Reader } from "../reader/openUrl";
import type { SpectrumRepresentation } from "../reader/types";

// mzpeakts names the reconstructed data-array columns by their human-readable CV name.
const MZ_KEY = "m/z array";
const INTENSITY_KEY = "intensity array";

/** The raw spectrum record shape mzpeakts returns from getSpectrum(index). */
export type RawSpectrum = {
  id: unknown;
  dataArrays?: Record<string, ArrayLike<number>> | undefined;
  centroids?: { mz: number; intensity: number }[] | undefined;
};

/** Plain, transfer-ready reconstruction output (pre-adapter). */
export type ReconstructedSpectrum = {
  index: number;
  id: string;
  mz: Float64Array;
  intensity: Float32Array;
  /** The representation the reconstruction resolved/used ("profile" | "centroid"). */
  representation: SpectrumRepresentation;
};

function hasDataArrays(s: RawSpectrum): boolean {
  return !!(s.dataArrays && s.dataArrays[MZ_KEY] && s.dataArrays[INTENSITY_KEY]);
}
function hasCentroids(s: RawSpectrum): boolean {
  return !!(s.centroids && s.centroids.length > 0);
}

/** Reconstruct from spectra_data (profile). Throws (never silent zeros) when absent. */
function fromDataArrays(s: RawSpectrum, index: number): ReconstructedSpectrum {
  const da = s.dataArrays;
  if (!da || !da[MZ_KEY] || !da[INTENSITY_KEY]) {
    throw new Error(`spectra_data has no arrays for spectrum ${index}`);
  }
  const mz = Float64Array.from(da[MZ_KEY]);
  const intensity = Float32Array.from(da[INTENSITY_KEY]);
  if (mz.length !== intensity.length) {
    throw new Error(
      `Spectrum ${index}: m/z (${mz.length}) and intensity (${intensity.length}) length mismatch`,
    );
  }
  return { index, id: String(s.id), mz, intensity, representation: "profile" };
}

/** Reconstruct from spectra_peaks (centroid). Throws (never silent zeros) when empty. */
function fromCentroids(s: RawSpectrum, index: number): ReconstructedSpectrum {
  const centroids = s.centroids;
  if (!centroids || centroids.length === 0) {
    throw new Error(
      `Spectrum ${index}: centroid representation but spectra_peaks has no rows`,
    );
  }
  const n = centroids.length;
  const mz = new Float64Array(n);
  const intensity = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mz[i] = centroids[i]!.mz;
    intensity[i] = centroids[i]!.intensity;
  }
  return { index, id: String(s.id), mz, intensity, representation: "centroid" };
}

/**
 * PURE reconstruction: choose the signal source from the resolved representation,
 * with a fall-through to the other source so a file whose MS:1000525 disagrees with
 * its stored layout still reconstructs (instead of throwing on the empty routed
 * source). Fails loud only when NEITHER source has decodable arrays.
 */
export function reconstructSpectrum(
  spectrum: RawSpectrum,
  index: number,
  representation: SpectrumRepresentation,
): ReconstructedSpectrum {
  if (representation === "centroid") {
    if (hasCentroids(spectrum)) return fromCentroids(spectrum, index);
    if (hasDataArrays(spectrum)) return fromDataArrays(spectrum, index);
    return fromCentroids(spectrum, index); // throws the named centroid error
  }
  // "profile" or null (unknown) → data-array default, centroid fall-through.
  if (hasDataArrays(spectrum)) return fromDataArrays(spectrum, index);
  if (hasCentroids(spectrum)) return fromCentroids(spectrum, index);
  return fromDataArrays(spectrum, index); // throws the named profile error
}

/**
 * Read + reconstruct spectrum `index` and adapt it to the wire `SpectrumArrays`.
 * The live reader stays in the engine; only plain typed arrays leave the boundary.
 */
export async function readEngineSpectrum(
  reader: Reader,
  index: number,
): Promise<WireSpectrumArrays> {
  // Resolve representation from the metadata row (MS:1000525), null when unknown.
  let representation: SpectrumRepresentation = null;
  try {
    representation = spectrumMeta(reader, index).representation;
  } catch {
    representation = null;
  }

  const spectrum = (await reader.getSpectrum(index)) as RawSpectrum | null;
  if (!spectrum) throw new Error(`No spectrum at index ${index}`);

  const recon = reconstructSpectrum(spectrum, index, representation);
  return adaptSpectrum({
    index: recon.index,
    id: recon.id,
    mz: recon.mz,
    intensity: recon.intensity,
    representation: recon.representation,
  });
}
