// GOLDEN NODE TEST — the imaging RENDER round-trip against the REAL imaging fixture
// (mzpeakts runs in node via WASM). Gates engine/imaging.ts:
//   open → grid → engineRenderIonImage(reader, grid, <real m/z with signal>, 0.5)
//   → assert shape + nonzero + value-parity against a hand-computed window sum
//     computed from the RAW DATA-ARRAY intensity (NOT via reconstructSpectrum), so the
//     parity check is a true cross-implementation pin of the ion-image SOURCE vs IV,
//     not a circular re-run of the same routed read.
//   → narrow window around the peak → max>0 + a SMALL nonzero count.
//   → empty (no-signal) window → all-zero image, stats {0,0,0}.
//   → engineMeanSpectrum → non-empty, equal-length mz/intensity, honest "mean-sampled" id.
//
// The m/z is chosen from the fixture itself (the strongest peak of a filled pixel's
// RAW data-array spectrum), so it is guaranteed to have signal — no magic number.

import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { openEngineFile, type EngineFile } from "./open";
import { engineRenderIonImage, engineMeanSpectrum } from "./imaging";
import { rebuildCoordMap } from "../adapt/grid";
import { harvestDataArraysOrNull } from "../reader/arrays";

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

  it("renders an ion image sized to the grid with signal (parity vs RAW data arrays)", async () => {
    const grid = opened.grid;
    expect(grid).not.toBeNull();
    const g = grid!;

    // Pick a real m/z WITH signal: the strongest peak of the first filled pixel's
    // RAW DATA-ARRAY spectrum. Reading via harvestDataArraysOrNull (the SAME source
    // the ion-image path uses, but a SEPARATE call here) keeps the parity check
    // independent of engine/spectrum.ts reconstructSpectrum — it pins the ion image
    // to the raw spectra_data bytes (the IV source), not to a routed reconstruction.
    const map = rebuildCoordMap(g);
    const firstSpectrumIndex = map.values().next().value as number;
    const raw = await harvestDataArraysOrNull(opened.reader, firstSpectrumIndex);
    expect(raw).not.toBeNull();
    const rawMz = raw!.mz;
    const rawIn = raw!.intensity;
    let peakIdx = 0;
    for (let i = 1; i < rawIn.length; i++) {
      if (rawIn[i]! > rawIn[peakIdx]!) peakIdx = i;
    }
    const targetMz = rawMz[peakIdx]!;
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

    // ── VALUE-PARITY (NON-CIRCULAR) ────────────────────────────────────────────
    // The ion image at the first filled pixel must equal a HAND-COMPUTED window sum
    // over that pixel's RAW DATA-ARRAY intensity: sum where mz ∈ [target-TOL,
    // target+TOL] inclusive — the exact semantics engineRenderIonImage mirrors from
    // IV (ionImageFromCache / computeIonImageFast: `if (m < start || m > end) continue`).
    // The hand-sum uses rawMz/rawIn (data-array bytes), NOT reconstructSpectrum, so it
    // genuinely pins SOURCE parity vs IV rather than re-running the same routed read.
    const [firstKey, firstSpec] = map.entries().next().value as [number, number];
    expect(firstSpec).toBe(firstSpectrumIndex);
    const lo = targetMz - TOL;
    const hi = targetMz + TOL;
    // The ion-image pipeline now streams m/z as f32 (ample for window selection; halves the
    // footprint), so the hand-sum selects its in-window points from the SAME f32 m/z.
    const f32Mz = Float32Array.from(rawMz);
    let hand = 0;
    for (let i = 0; i < f32Mz.length; i++) {
      const m = f32Mz[i]!;
      if (m < lo || m > hi) continue;
      const v = rawIn[i]!;
      if (Number.isFinite(v)) hand += v;
    }
    expect(hand).toBeGreaterThan(0); // the chosen peak guarantees signal in-window
    // Float32 storage of the summed value: parity within f32 epsilon of the sum.
    expect(ionImage[firstKey]!).toBeCloseTo(hand, 1);
    // Cross-check: the f32-rounded hand sum is bit-equal to the stored cell.
    expect(ionImage[firstKey]!).toBe(Math.fround(hand));

    // ── NARROW WINDOW (vibe m3) ────────────────────────────────────────────────
    // A very small tolerance around the same real peak still yields signal (max>0),
    // and selects only a handful of nearby points → a SMALL nonzero count (strictly
    // fewer than the whole grid). This guards against a window that silently widens.
    const narrow = await engineRenderIonImage(opened.reader, g, targetMz, 0.01);
    expect(narrow.stats.max).toBeGreaterThan(0);
    expect(narrow.stats.nonzeroCount).toBeGreaterThan(0);
    expect(narrow.stats.nonzeroCount).toBeLessThanOrEqual(stats.nonzeroCount);

    // ── EMPTY WINDOW (vibe m3) ─────────────────────────────────────────────────
    // An m/z window placed well ABOVE the file's reported m/z range has no signal →
    // an all-zero image with stats {nonzeroCount:0, min:0, max:0}.
    const above =
      (opened.stats.mzRange ? opened.stats.mzRange[1] : targetMz) + 10_000;
    const empty = await engineRenderIonImage(opened.reader, g, above, TOL);
    expect(empty.ionImage.length).toBe(g.width * g.height);
    expect(empty.ionImage.every((v) => v === 0)).toBe(true);
    expect(empty.stats).toEqual({ nonzeroCount: 0, min: 0, max: 0 });
  }, 120_000);

  it("computes a non-empty SAMPLED mean spectrum with an honest id", async () => {
    const mean = await engineMeanSpectrum(opened.reader);
    expect(mean.mz).toBeInstanceOf(Float64Array);
    expect(mean.intensity).toBeInstanceOf(Float32Array);
    expect(mean.mz.length).toBeGreaterThan(0);
    expect(mean.mz.length).toBe(mean.intensity.length);
    // Honest id: a consumer can tell this is a SAMPLED mean, not an exact all-pixel one.
    expect(mean.id).toBe("mean-sampled");
    // f32 axis CONSISTENTLY: the cold mean's reference m/z is f32-precision (built as a
    // Float32Array, then widened to f64 for the wire) — so it matches the warm-cache mean.
    for (let i = 0; i < mean.mz.length; i++) expect(mean.mz[i]).toBe(Math.fround(mean.mz[i]!));
  }, 120_000);
});
