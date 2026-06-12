// PURE adapter: reader-extracted chromatogram points → the contract ChromatogramSeries.
// Follows the package template (see ./capability.ts): a pure function from plain,
// already-extracted data (NO mzpeakts handle, no Reader) to a wire type, with a unit
// test. The reader-I/O (running extractXIC / getStoredChromatogram / the cheap TIC
// column path and summing intensity per point) lives in the handler; this adapter only
// repacks the result into the transfer-safe wire shape.
//
// Source semantics (Phase-3 map, mzPeakExplorer/src/reader/browse.ts:152
// extractChromatogram + :199 getStoredChromatogram, and store.ts buildTic/cheapTic):
//   - "tic"    — total-ion chromatogram (both ranges null; or the cheap promoted-TIC
//                column path). intensity = per-spectrum total ion current.
//   - "xic"    — extracted-ion chromatogram over an m/z window; intensity = summed
//                intensity inside the window per spectrum.
//   - "stored" — a chromatogram the converter wrote (carries an id).
// Explorer returns an ARRAY OF OBJECTS (`ChromPoint[]` = {index,time,intensity}); the
// wire form is PARALLEL Float32Array time/intensity (transferable). The handler pulls
// `time` and `intensity` out into plain arrays and hands them here.

import type { ChromatogramSeries } from "@mzpeak/contracts";

/** Plain extracted chromatogram: kind/id + parallel time & intensity sequences. */
export type ChromInput = {
  /** Trace class — drives the plot label and the handler's read path. */
  kind: "tic" | "xic" | "stored";
  /** Native chromatogram id (stored chroms carry one; tic/xic usually null). */
  id?: string | null;
  /** x — retention time in seconds. */
  time: ArrayLike<number>;
  /** y — total/summed intensity per point. Must be the same length as `time`. */
  intensity: ArrayLike<number>;
};

/**
 * Copy the first `n` elements of a numeric ArrayLike into a fresh Float32Array. Always
 * copies (never aliases the input buffer), so the returned array is safe to transfer.
 */
function toF32(src: ArrayLike<number>, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = src[i] as number; // i < n <= src.length ⇒ defined
  return out;
}

/**
 * Repack extracted chromatogram points into the wire `ChromatogramSeries`.
 *
 * Coerces `time`/`intensity` to fresh Float32Arrays (transfer-safe). Guards mismatched
 * lengths by TRUNCATING both axes to the shorter length so the two parallel arrays stay
 * index-aligned — a ragged input (e.g. a dropped trailing point) can never produce a
 * series where `time[i]` and `intensity[i]` describe different spectra. The handler is
 * responsible for never producing ragged input; this truncation is a defensive guard.
 */
export function adaptChromatogram(input: ChromInput): ChromatogramSeries {
  const n = Math.min(input.time.length, input.intensity.length);
  return {
    kind: input.kind,
    id: input.id ?? null,
    time: toF32(input.time, n),
    intensity: toF32(input.intensity, n),
  };
}
