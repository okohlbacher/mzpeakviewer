// Canonical guard: spectrumMeta must report representation from the promoted
// spectrum_representation column (MS:1000127 centroid / MS:1000128 profile), resolving BOTH
// the nested and flat column names — NOT from rec.isProfile alone. The flat (metadata-refactor)
// reader leaves rec.meta empty and sets isProfile=false for centroid spectra, which the old
// code mapped to representation=null → a centroid spectrum rendered as a connected profile
// LINE (with the peak table hidden) instead of sticks. Pure logic over a faked reader.
import { describe, it, expect } from "vitest";
import { spectrumMeta } from "./fileMeta";
import { COL, COL_FLAT } from "./explorer/cv";
import type { Reader } from "./openUrl";

// index 0 = centroid (MS:1000127), index 1 = profile (MS:1000128).
const REPR = ["MS:1000127", "MS:1000128"];

/** Reader whose promoted struct exposes spectrum_representation under `reprName`, and whose
 *  per-record isProfile is DELIBERATELY unhelpful (false for both) — so a passing test proves
 *  representation came from the column, not isProfile. */
function fakeReader(reprName: string): Reader {
  const spectra = {
    length: REPR.length,
    getChild: (n: string) =>
      n === reprName ? { get: (i: number) => REPR[i] } : null,
  };
  const sm = {
    length: REPR.length,
    spectra,
    get: (i: number) => ({ id: `s${i}`, msLevel: 2, isProfile: false }),
  };
  return { spectrumMetadata: sm } as unknown as Reader;
}

describe("spectrumMeta — representation from the column, on both layouts", () => {
  for (const [layout, reprName] of [
    ["flat", COL_FLAT.representation],
    ["nested", COL.representation],
  ] as const) {
    it(`${layout}: centroid stays centroid, profile stays profile`, () => {
      const reader = fakeReader(reprName);
      expect(spectrumMeta(reader, 0).representation).toBe("centroid");
      expect(spectrumMeta(reader, 1).representation).toBe("profile");
    });
  }
});
