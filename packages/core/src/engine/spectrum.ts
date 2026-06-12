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
//   - when the routed source is empty we fall through to the OTHER source so a
//     slightly-mislabeled file still renders — BUT the reported `representation`
//     stays the metadata-declared value (the file's own claim). The fallback never
//     rewrites the representation, so we don't lie about what the file says it is.
//   - when BOTH sources are empty we throw a named error rather than emit zeros.

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
  /**
   * The representation the FILE declares (its MS:1000525 metadata value), NOT the
   * source the bytes were ultimately read from. A fallback read of the other source
   * does not change this — the metadata claim is preserved verbatim.
   */
  representation: SpectrumRepresentation;
};

/**
 * Thrown when neither spectra_data nor spectra_peaks yields decodable arrays for a
 * spectrum. Named so callers can distinguish "no signal at all" from a transient
 * reader error and never silently render zeros.
 */
export class EmptySpectrumError extends Error {
  constructor(public readonly index: number) {
    super(`Spectrum ${index}: neither spectra_data nor spectra_peaks has decodable m/z + intensity arrays`);
    this.name = "EmptySpectrumError";
  }
}

function hasDataArrays(s: RawSpectrum): boolean {
  return !!(s.dataArrays && s.dataArrays[MZ_KEY] && s.dataArrays[INTENSITY_KEY]);
}
function hasCentroids(s: RawSpectrum): boolean {
  return !!(s.centroids && s.centroids.length > 0);
}

/**
 * Drop non-finite (mz, intensity) PAIRS, reconcile a ragged mz/intensity length
 * (truncate to the shorter), and guarantee ascending m/z. Harvested from
 * mzPeakExplorer's `getSpectrumArrays` (browse.ts `sanitizePairs`): uPlot and the
 * hover binary-search require monotonic finite x. PURE + separately unit-testable.
 *
 * Fast path: when the input is already finite + sorted + equal-length (the normal
 * case for real data) the inputs are returned unchanged with no copy.
 */
export function sanitizePairs(
  mz: Float64Array,
  intensity: Float32Array,
): { mz: Float64Array; intensity: Float32Array } {
  const n = Math.min(mz.length, intensity.length);
  let clean = mz.length === intensity.length;
  for (let i = 0; i < n && clean; i++) {
    if (
      !Number.isFinite(mz[i]!) ||
      !Number.isFinite(intensity[i]!) ||
      (i > 0 && mz[i]! < mz[i - 1]!)
    ) {
      clean = false;
    }
  }
  if (clean) return { mz, intensity };

  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(mz[i]!) && Number.isFinite(intensity[i]!)) idx.push(i);
  }
  idx.sort((a, b) => mz[a]! - mz[b]!);
  const nmz = new Float64Array(idx.length);
  const ninten = new Float32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    const j = idx[i]!;
    nmz[i] = mz[j]!;
    ninten[i] = intensity[j]!;
  }
  return { mz: nmz, intensity: ninten };
}

/** Copy spectra_data (profile) arrays into the canonical dtypes (f64 m/z, f32 int). */
function readDataArrays(s: RawSpectrum): { mz: Float64Array; intensity: Float32Array } {
  const da = s.dataArrays!;
  return {
    mz: Float64Array.from(da[MZ_KEY]!),
    intensity: Float32Array.from(da[INTENSITY_KEY]!),
  };
}

/** Copy spectra_peaks (centroid) arrays into the canonical dtypes. */
function readCentroids(s: RawSpectrum): { mz: Float64Array; intensity: Float32Array } {
  const centroids = s.centroids!;
  const n = centroids.length;
  const mz = new Float64Array(n);
  const intensity = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mz[i] = centroids[i]!.mz;
    intensity[i] = centroids[i]!.intensity;
  }
  return { mz, intensity };
}

/**
 * PURE reconstruction: pick the signal source the resolved `representation` routes
 * to, with a fall-through to the OTHER source so a file whose MS:1000525 disagrees
 * with its stored layout still reconstructs. Two invariants codex asked for:
 *   1. `representation` in the result is ALWAYS the metadata-declared value — a
 *      fallback read never rewrites it (no false claim about the file).
 *   2. When NEITHER source has arrays we throw `EmptySpectrumError`, never zeros.
 * Both profile and centroid arrays are run through `sanitizePairs`.
 */
export function reconstructSpectrum(
  spectrum: RawSpectrum,
  index: number,
  representation: SpectrumRepresentation,
): ReconstructedSpectrum {
  // Route by representation, but fall through to the other source when empty.
  // `representation` is reported as-is regardless of which source supplied bytes.
  let raw: { mz: Float64Array; intensity: Float32Array };
  if (representation === "centroid") {
    if (hasCentroids(spectrum)) raw = readCentroids(spectrum);
    else if (hasDataArrays(spectrum)) raw = readDataArrays(spectrum);
    else throw new EmptySpectrumError(index);
  } else {
    // "profile" or null (unknown) → data-array default, centroid fall-through.
    if (hasDataArrays(spectrum)) raw = readDataArrays(spectrum);
    else if (hasCentroids(spectrum)) raw = readCentroids(spectrum);
    else throw new EmptySpectrumError(index);
  }

  const clean = sanitizePairs(raw.mz, raw.intensity);
  return {
    index,
    id: String(spectrum.id),
    mz: clean.mz,
    intensity: clean.intensity,
    representation, // metadata value, preserved across any fallback
  };
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
