// GOLDEN NODE TEST — the imaging RENDER round-trip against the REAL imaging fixture
// (mzpeakts runs in node via WASM). Gates engine/imaging.ts:
//   open → grid → engineRenderIonImage(reader, grid, <real m/z with signal>, 0.5)
//   → assert shape + nonzero + value-parity against a hand-computed window sum.
//   → engineMeanSpectrum → non-empty, equal-length mz/intensity.
//
// The m/z is chosen from the fixture itself (the strongest peak of a filled pixel's
// spectrum), so it is guaranteed to have signal — no hard-coded magic number.

import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { openEngineFile, type EngineFile } from "./open";
import { engineRenderIonImage, engineMeanSpectrum } from "./imaging";
import { rebuildCoordMap } from "../adapt/grid";
import { readEngineSpectrum } from "./spectrum";

const FIXTURE = fileURLToPath(
  new URL("../../test/fixtures/imaging.mzpeak", import.meta.url),
);

const TOL = 0.5;

describe("engine imaging RENDER round-trip against real imaging.mzpeak", () => {
  let opened: EngineFile;

  beforeAll(async () => {
    const bytes = await readFile(FIXTURE);
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    opened = await openEngineFile(ab, "imaging.mzpeak");
  }, 120_000);

  it("renders an ion image sized to the grid with signal", async () => {
    const grid = opened.grid;
    expect(grid).not.toBeNull();
    const g = grid!;

    // Pick a real m/z WITH signal: the strongest peak of the first filled pixel's
    // spectrum. Within the fixture's reported m/z range, guaranteed nonzero.
    const map = rebuildCoordMap(g);
    const firstSpectrumIndex = map.values().next().value as number;
    const ref = await readEngineSpectrum(opened.reader, firstSpectrumIndex);
    let peakIdx = 0;
    for (let i = 1; i < ref.intensity.length; i++) {
      if (ref.intensity[i]! > ref.intensity[peakIdx]!) peakIdx = i;
    }
    const targetMz = ref.mz[peakIdx]!;
    expect(Number.isFinite(targetMz)).toBe(true);
    // sanity: target sits inside the file-reported m/z range when present
    if (opened.stats.mzRange) {
      expect(targetMz).toBeGreaterThanOrEqual(opened.stats.mzRange[0]);
      expect(targetMz).toBeLessThanOrEqual(opened.stats.mzRange[1]);
    }

    const { ionImage, stats } = await engineRenderIonImage(
      opened.reader,
      g,
      targetMz,
      TOL,
    );

    expect(ionImage.length).toBe(g.width * g.height);
    expect(stats.max).toBeGreaterThan(0);
    expect(stats.nonzeroCount).toBeGreaterThan(0);

    // ── VALUE-PARITY ──────────────────────────────────────────────────────────
    // The ion image at the first filled pixel must equal a HAND-COMPUTED window sum
    // over that pixel's raw spectrum: sum intensity where mz ∈ [target-TOL, target+TOL]
    // inclusive — the exact semantics engineRenderIonImage claims to mirror from IV
    // (ionImageFromCache / computeIonImageFast: `if (m < start || m > end) continue`).
    const [firstKey, firstSpec] = map.entries().next().value as [number, number];
    expect(firstSpec).toBe(firstSpectrumIndex);
    const lo = targetMz - TOL;
    const hi = targetMz + TOL;
    let hand = 0;
    for (let i = 0; i < ref.mz.length; i++) {
      const m = ref.mz[i]!;
      if (m < lo || m > hi) continue;
      const v = ref.intensity[i]!;
      if (Number.isFinite(v)) hand += v;
    }
    expect(hand).toBeGreaterThan(0); // the chosen peak guarantees signal in-window
    // Float32 storage of the summed value: parity within f32 epsilon of the sum.
    expect(ionImage[firstKey]!).toBeCloseTo(hand, 1);
    // Cross-check: the f32-rounded hand sum is bit-equal to the stored cell.
    expect(ionImage[firstKey]!).toBe(Math.fround(hand));
  }, 120_000);

  it("computes a non-empty mean spectrum with equal-length mz/intensity", async () => {
    const mean = await engineMeanSpectrum(opened.reader);
    expect(mean.mz).toBeInstanceOf(Float64Array);
    expect(mean.intensity).toBeInstanceOf(Float32Array);
    expect(mean.mz.length).toBeGreaterThan(0);
    expect(mean.mz.length).toBe(mean.intensity.length);
  }, 120_000);
});
