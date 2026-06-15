// Unit test for the ion-image MS1-only gate (makeMs1Only) — the design rule "NEVER sum
// MS2 into an ion image / its cache" and its misannotation fallback. Pure logic over a
// faked promoted MS-level column; no WASM/fixture needed.
import { describe, it, expect } from "vitest";
import { makeMs1Only } from "./imaging";
import type { Reader } from "../reader/openUrl";

/** Minimal reader exposing only the promoted MS-level column makeMs1Only reads. */
function fakeReader(levels: number[] | null): Reader {
  const spectra =
    levels === null
      ? null
      : {
          getChild: (n: string) =>
            n === "MS_1000511_ms_level" ? { get: (i: number) => levels[i] } : null,
        };
  return { spectrumMetadata: { length: levels?.length ?? 0, spectra } } as unknown as Reader;
}

describe("makeMs1Only — ion-image MS1 gate", () => {
  it("excludes MS2 spectra when the grid carries MS1 data", () => {
    const levels = [1, 1, 2, 1, 2]; // pixels 2 and 4 are MS2
    const keep = makeMs1Only(fakeReader(levels), [0, 1, 2, 3, 4]);
    expect([0, 1, 2, 3, 4].filter(keep)).toEqual([0, 1, 3]);
  });

  it("falls back to including all when NO mapped spectrum is MS1 (misannotated/level-0)", () => {
    const levels = [0, 0, 2, 2]; // nothing is level 1
    const keep = makeMs1Only(fakeReader(levels), [0, 1, 2, 3]);
    expect([0, 1, 2, 3].filter(keep)).toEqual([0, 1, 2, 3]);
  });

  it("includes all when the MS-level column is absent", () => {
    const keep = makeMs1Only(fakeReader(null), [0, 1, 2]);
    expect([0, 1, 2].filter(keep)).toEqual([0, 1, 2]);
  });

  it("treats MS3+ as non-MS1 (only level 1 is kept)", () => {
    const levels = [1, 3, 1];
    const keep = makeMs1Only(fakeReader(levels), [0, 1, 2]);
    expect([0, 1, 2].filter(keep)).toEqual([0, 2]);
  });
});
