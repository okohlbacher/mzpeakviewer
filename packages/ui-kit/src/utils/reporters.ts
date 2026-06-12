// Reporter-ion quantitation overlay for isobaric (TMT/iTRAQ) spectra.
//
// The producer's --reporter-quant aux array is not reliably surfaced by the
// reader, and the reporter intensities are physically present as peaks in the
// MS2/MS3 spectrum anyway — so we extract them CLIENT-SIDE: for each channel's
// known reporter m/z, take the most intense peak within a small tolerance.
// Works for centroid and profile spectra; source-independent.

/**
 * Self-contained presentational types mirroring only the channel/spectrum fields
 * this reporter-matching logic reads. Kept local so ui-kit stays free of any
 * `@mzpeak/contracts` / reader import; the reader's richer `ChannelAssignment`
 * and `SpectrumArrays` are structurally assignable to these.
 */
export type ChannelAssignment = {
  channelLabel: string | null;
  reporterMz: number | null;
  role: string | null;
  tag: unknown;
  sampleId: string | null;
  sampleName: string | null;
  boundToThisRun: boolean;
};

export type SpectrumArrays = {
  index: number;
  id: string;
  msLevel: number | null;
  representation: unknown;
  time: number | null;
  mz: Float64Array;
  intensity: Float32Array;
};

export type ReporterPeak = {
  channelLabel: string | null; // e.g. "TMT126"
  reporterMz: number; // expected
  sampleName: string | null;
  role: string | null;
  /** Actual matched peak m/z + intensity, or null when no peak within tolerance. */
  matchedMz: number | null;
  intensity: number | null;
};

/** First index i with mz[i] >= target (binary search on ascending m/z). */
function lowerBound(mz: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = mz.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (mz[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Extract per-channel reporter quantities by matching each channel's reporter
 * m/z to the most intense peak within ±`tolDa`. Channels without a reporter m/z
 * (e.g. an unresolved TMTpro 16/18-plex slot) yield a null quantity, never a
 * sentinel. Returns one entry per input channel, in input order.
 */
export function extractReporters(
  channels: ChannelAssignment[],
  mz: ArrayLike<number>,
  intensity: ArrayLike<number>,
  tolDa = 0.005,
): ReporterPeak[] {
  const n = Math.min(mz.length, intensity.length);
  return channels.map((ch) => {
    const base: ReporterPeak = {
      channelLabel: ch.channelLabel,
      reporterMz: ch.reporterMz ?? NaN,
      sampleName: ch.sampleName,
      role: ch.role,
      matchedMz: null,
      intensity: null,
    };
    const target = ch.reporterMz;
    if (target == null || n === 0) return base;
    let bestI = -1;
    let bestInt = -Infinity;
    for (let i = lowerBound(mz, target - tolDa); i < n && mz[i]! <= target + tolDa; i++) {
      if (intensity[i]! > bestInt) {
        bestInt = intensity[i]!;
        bestI = i;
      }
    }
    if (bestI < 0 || !Number.isFinite(bestInt)) return base;
    return { ...base, matchedMz: mz[bestI]!, intensity: bestInt };
  });
}

/** Reporter overlay for the spectrum: extracted peaks + whether any matched.
 *  Gated on isobaric channels (with reporter m/z) bound to this run + an MSn≥2
 *  spectrum; returns an empty result otherwise so the overlay stays dormant. */
export function spectrumReporters(
  channels: ChannelAssignment[] | undefined,
  spectrum: SpectrumArrays | null,
  tolDa = 0.005,
): { reporters: ReporterPeak[]; matched: number } {
  if (!channels || !spectrum) return { reporters: [], matched: 0 };
  if ((spectrum.msLevel ?? 0) < 2) return { reporters: [], matched: 0 };
  const bound = channels.filter((c) => c.boundToThisRun && c.reporterMz != null);
  if (bound.length === 0) return { reporters: [], matched: 0 };
  const reporters = extractReporters(bound, spectrum.mz, spectrum.intensity, tolDa);
  return { reporters, matched: reporters.filter((r) => r.intensity != null).length };
}
