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
import { streamSpectraDataArrays, streamSpectraPeaksArrays, type Reader, type StreamedSpectrumArrays } from "../reader/openUrl";
import type { SpectrumRepresentation } from "../reader/types";
import type { SpectrumLruCache } from "./cache";
import type { PrefetchControl } from "./imaging";

// Promoted per-spectrum columns (CV-accession-derived names) read vectorized for the
// LC prefetch — no per-record materialization.
const MS_LEVEL_COL = "MS_1000511_ms_level";
const REPR_COL = "MS_1000525_spectrum_representation";
const REPR_PROFILE_ACC = "MS:1000128";
const REPR_CENTROID_ACC = "MS:1000127";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
const PREFETCH_SLICE_MS = 30;
/** Max time the prefetch defers to sustained user activity before forcing one slice
 *  (bounds starvation under steady navigation). Mirrors imaging.ts. */
const MAX_PREFETCH_STARVE_MS = 4000;

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

/** Minimal view over the promoted per-spectrum Arrow columns. */
type Col = { get(i: number): unknown } | null | undefined;
function readCols(reader: Reader): { n: number; lvl: Col; repr: Col } {
  const sm = reader.spectrumMetadata as unknown as
    | { length?: number; spectra?: { getChild?: (n: string) => Col } | null }
    | null
    | undefined;
  const spectra = sm?.spectra;
  const get = (name: string): Col =>
    spectra && typeof spectra.getChild === "function" ? spectra.getChild(name) : null;
  return { n: sm?.length ?? 0, lvl: get(MS_LEVEL_COL), repr: get(REPR_COL) };
}

/**
 * Background-prefetch the SPECTRUM LRU for a non-imaging (LC/DDA) file: stream the signal
 * sources ONCE and cache the **MS0/1** spectra (skipping MS2, per the design requirement)
 * so first-time navigation to any MS1 spectrum is instant instead of a cold row-group read.
 *
 * Routing correctness: each spectrum is cached from the source its declared representation
 * routes to — profile/unknown from `spectra_data`, centroid from `spectra_peaks` — which is
 * exactly what `readEngineSpectrumCached` would reconstruct on a miss, so a cache hit never
 * returns mismatched arrays. (LC/DDA spectra usually live in `spectra_peaks` as centroids.)
 *
 * Cooperative + interruptible (same `PrefetchControl` as the ion prefetch): reads run under
 * the mutex, pause on user activity, time-slice (30 ms), and bail on `shouldStop`. The LRU's
 * own budget eviction bounds memory. MS-scoping saves cache memory; it does not save
 * bandwidth (MS1/MS2 interleave in the peaks row groups).
 */
export async function prefetchSpectrumCache(
  reader: Reader,
  cache: SpectrumLruCache,
  control: PrefetchControl,
): Promise<{ cached: number; stopped: boolean }> {
  const { lvl, repr } = readCols(reader);
  let cached = 0;

  const msLevelOf = (i: number): number | null => {
    const v = lvl?.get(i);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  // MS0/1 only — skip MS2+. null/unknown level is treated as MS1 (kept).
  const isMs01 = (i: number): boolean => {
    const m = msLevelOf(i);
    return m === null || m <= 1;
  };
  const reprOf = (i: number): SpectrumRepresentation => {
    const v = repr?.get(i);
    if (v === REPR_PROFILE_ACC) return "profile";
    if (v === REPR_CENTROID_ACC) return "centroid";
    return null;
  };

  const waitWhileUserActive = async (): Promise<boolean> => {
    const waitStart = nowMs();
    while (control.isUserActive()) {
      if (control.shouldStop()) return false;
      if (nowMs() - waitStart > MAX_PREFETCH_STARVE_MS) break; // forced progress (see imaging.ts)
      await sleep(control.cooldownMs()); // live adaptive value, re-read each slice
    }
    return !control.shouldStop();
  };

  // Drive one bulk stream through the time-sliced mutex loop, caching entries `accept`s.
  const drain = async (
    stream: AsyncGenerator<StreamedSpectrumArrays>,
    accept: (index: number) => boolean,
  ): Promise<boolean> => {
    const it = stream[Symbol.asyncIterator]();
    let done = false;
    try {
      while (!done) {
        if (!(await waitWhileUserActive())) return false;
        await control.mutex.runExclusive(async () => {
          const start = nowMs();
          for (;;) {
            const res = await it.next();
            if (res.done) { done = true; return; }
            const { index, mz, intensity } = res.value;
            if (accept(index)) {
              // The spectrum-display prefetch streams full f64 m/z (default, no mzFloat32) for
              // display fidelity, so mz is a Float64Array here.
              cache.set(index, { mz: mz as Float64Array, intensity, msLevel: msLevelOf(index) });
              cached++;
            }
            if (nowMs() - start > PREFETCH_SLICE_MS) return;
          }
        });
        await sleep(0);
      }
    } finally {
      if (it.return) await it.return(undefined);
    }
    return true;
  };

  // Profile/unknown spectra from spectra_data; centroid spectra from spectra_peaks.
  const okData = await drain(streamSpectraDataArrays(reader), (i) => isMs01(i) && reprOf(i) !== "centroid");
  if (!okData) return { cached, stopped: true };
  const okPeaks = await drain(streamSpectraPeaksArrays(reader), (i) => isMs01(i) && reprOf(i) === "centroid");
  return { cached, stopped: !okPeaks };
}

/**
 * Cached variant of {@link readEngineSpectrum}: serves the decoded (m/z, intensity)
 * arrays from the worker's `SpectrumLruCache` on a hit, avoiding the expensive
 * `getSpectrum` row-group read. Only the signal arrays + msLevel are cached; the light
 * metadata (id, representation) is re-read from the in-memory table every call (cheap),
 * per the "no metadata besides MS level" design requirement.
 *
 * Transfer-safety: `adaptSpectrum` ALWAYS copies its inputs (it is the transfer
 * boundary), so the wire result never aliases — and therefore never detaches — the
 * cached arrays. The cache keeps the canonical buffers; the response carries copies.
 */
export async function readEngineSpectrumCached(
  reader: Reader,
  index: number,
  cache: SpectrumLruCache,
): Promise<WireSpectrumArrays> {
  // Light metadata is always cheap (in-memory metadata table): id, representation, msLevel.
  let representation: SpectrumRepresentation = null;
  let id = String(index);
  let msLevel: number | null = null;
  try {
    const m = spectrumMeta(reader, index);
    representation = m.representation;
    id = m.id;
    msLevel = m.msLevel;
  } catch {
    // keep defaults
  }

  const hit = cache.get(index);
  if (hit) {
    return adaptSpectrum({ index, id, mz: hit.mz, intensity: hit.intensity, representation });
  }

  const spectrum = (await reader.getSpectrum(index)) as RawSpectrum | null;
  if (!spectrum) throw new Error(`No spectrum at index ${index}`);
  const recon = reconstructSpectrum(spectrum, index, representation);
  // Cache the canonical decoded arrays (adaptSpectrum copies for the wire below).
  cache.set(index, { mz: recon.mz, intensity: recon.intensity, msLevel });
  return adaptSpectrum({
    index,
    id: recon.id,
    mz: recon.mz,
    intensity: recon.intensity,
    representation: recon.representation,
  });
}
