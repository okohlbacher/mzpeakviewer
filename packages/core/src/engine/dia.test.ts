// Unit tests for the DIA window-map logic (Stage A). Pure grouping/matching is tested
// directly; buildDiaWindowMap is exercised through a minimal fake reader that mimics the
// in-memory metadata surface (columnar ms-level + per-spectrum precursor isolation window).
import { describe, it, expect } from "vitest";
import { groupWindows, windowsForPrecursor, buildDiaWindowMap, type WindowRecord } from "./dia";
import type { Reader } from "../reader/openUrl";

describe("groupWindows", () => {
  it("collapses repeated windows and keeps member indices ascending", () => {
    // Two windows (400±2, 404±2) cycling: MS2 indices 1,3 → win A; 2,4 → win B.
    const recs: WindowRecord[] = [
      { index: 1, target: 400, lower: 2, upper: 2 },
      { index: 2, target: 404, lower: 2, upper: 2 },
      { index: 3, target: 400, lower: 2, upper: 2 },
      { index: 4, target: 404, lower: 2, upper: 2 },
    ];
    const w = groupWindows(recs);
    expect(w.length).toBe(2);
    expect(w[0]).toMatchObject({ lo: 398, hi: 402, indices: [1, 3] });
    expect(w[1]).toMatchObject({ lo: 402, hi: 406, indices: [2, 4] });
  });

  it("infers a tiling half-width from target spacing when offsets are absent", () => {
    const recs: WindowRecord[] = [
      { index: 1, target: 400, lower: 0, upper: 0 },
      { index: 2, target: 404, lower: 0, upper: 0 }, // 4 Th spacing → ±2 inferred
      { index: 3, target: 408, lower: 0, upper: 0 },
    ];
    const w = groupWindows(recs);
    expect(w.map((x) => [x.lo, x.hi])).toEqual([[398, 402], [402, 406], [406, 410]]);
  });

  it("returns [] for no records", () => {
    expect(groupWindows([])).toEqual([]);
  });
});

describe("windowsForPrecursor", () => {
  const windows = groupWindows([
    { index: 0, target: 400, lower: 2, upper: 2 }, // [398,402]
    { index: 1, target: 404, lower: 2, upper: 2 }, // [402,406]
  ]);

  it("finds the containing window (inclusive bounds)", () => {
    expect(windowsForPrecursor(windows, 399).map((w) => w.target)).toEqual([400]);
    expect(windowsForPrecursor(windows, 405).map((w) => w.target)).toEqual([404]);
  });
  it("returns [] when no window contains the precursor", () => {
    expect(windowsForPrecursor(windows, 500)).toEqual([]);
  });
  it("returns both windows at a shared boundary (overlapping/touching schemes)", () => {
    expect(windowsForPrecursor(windows, 402).map((w) => w.target)).toEqual([400, 404]);
  });
});

/** Fake reader: ms-level column + per-spectrum precursor isolation window, mirroring the
 *  in-memory metadata shape buildDiaWindowMap reads. */
function fakeReader(levels: number[], windowTargets: (number | null)[]): Reader {
  return {
    spectrumMetadata: {
      length: levels.length,
      spectra: {
        getChild: (n: string) =>
          n === "MS_1000511_ms_level" ? { get: (i: number) => levels[i] } : null,
      },
      get: (i: number) => {
        const t = windowTargets[i];
        if (t == null) return { precursors: [] };
        return {
          precursors: [
            {
              isolation_window: {
                MS_1000827_isolation_window_target_mz: t,
                MS_1000828_isolation_window_lower_offset: 1,
                MS_1000829_isolation_window_upper_offset: 1,
              },
            },
          ],
        };
      },
    },
  } as unknown as Reader;
}

describe("buildDiaWindowMap", () => {
  it("maps MS2 spectra to their isolation windows and excludes MS1", () => {
    // idx: 0   1    2    3   4    5
    // lvl: 1   2    2    1   2    2     (MS1 survey + 2 windows per cycle)
    // win: -  400  410   -  400  410
    const reader = fakeReader([1, 2, 2, 1, 2, 2], [null, 400, 410, null, 400, 410]);
    const windows = buildDiaWindowMap(reader);
    expect(windows.length).toBe(2);
    expect(windows[0]).toMatchObject({ lo: 399, hi: 401, indices: [1, 4] });
    expect(windows[1]).toMatchObject({ lo: 409, hi: 411, indices: [2, 5] });
  });

  it("returns [] when there are no MS2 windows (non-DIA file)", () => {
    const reader = fakeReader([1, 1, 1], [null, null, null]);
    expect(buildDiaWindowMap(reader)).toEqual([]);
  });
});
