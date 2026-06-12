// GOLDEN NODE TEST — the multi-channel RGB-overlay render against the REAL imaging
// fixture (mzpeakts runs in node via WASM). Gates engine/multichannel.ts:
//   open → grid → engineRenderMultiChannel(reader, grid, [chA, null, chB])
//   → assert the result is POSITION-ALIGNED with the input (length matches),
//     each non-null slot is a Float32Array of width*height with signal, and the null
//     slot is null.
//   → per-channel PARITY: each non-null channel equals the standalone
//     engineRenderIonImage for that (mz, tolDa), pinning the overlay to the single-
//     channel primitive (and through it to IV's window-sum source).
//
// The two m/z values are chosen from the fixture itself (peaks of a filled pixel's
// RAW data-array spectrum), so they are guaranteed to have signal — no magic number.

import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { openEngineFile, type EngineFile } from "./open";
import { engineRenderMultiChannel } from "./multichannel";
import { engineRenderIonImage } from "./imaging";
import { rebuildCoordMap } from "../adapt/grid";
import { harvestDataArraysOrNull } from "../reader/arrays";

const FIXTURE = fileURLToPath(
  new URL("../../test/fixtures/imaging.mzpeak", import.meta.url),
);

const TOL = 0.5;

describe("engine multi-channel render round-trip against real imaging.mzpeak", () => {
  let opened: EngineFile;

  beforeAll(async () => {
    const bytes = await readFile(FIXTURE);
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    opened = await openEngineFile(ab, "imaging.mzpeak");
  }, 120_000);

  it("renders one image per channel slot, position-aligned, null→null, with signal", async () => {
    const grid = opened.grid;
    expect(grid).not.toBeNull();
    const g = grid!;

    // Two real m/z values WITH signal: the two strongest peaks of the first filled
    // pixel's RAW DATA-ARRAY spectrum (the SAME source the ion-image path uses).
    const map = rebuildCoordMap(g);
    const firstSpectrumIndex = map.values().next().value as number;
    const raw = await harvestDataArraysOrNull(opened.reader, firstSpectrumIndex);
    expect(raw).not.toBeNull();
    const rawMz = raw!.mz;
    const rawIn = raw!.intensity;

    // top-2 peak indices by intensity
    let p1 = 0;
    for (let i = 1; i < rawIn.length; i++) if (rawIn[i]! > rawIn[p1]!) p1 = i;
    let p2 = -1;
    for (let i = 0; i < rawIn.length; i++) {
      if (i === p1) continue;
      // keep the next-strongest peak that is at least ~1 Da away from p1 so the two
      // channels select distinct windows (not the same peak twice)
      if (Math.abs(rawMz[i]! - rawMz[p1]!) < 1) continue;
      if (p2 < 0 || rawIn[i]! > rawIn[p2]!) p2 = i;
    }
    if (p2 < 0) p2 = p1; // degenerate (tiny spectrum): fall back to the same peak
    const mzA = rawMz[p1]!;
    const mzB = rawMz[p2]!;
    expect(Number.isFinite(mzA)).toBe(true);
    expect(Number.isFinite(mzB)).toBe(true);

    // Channel slots: [A, null, B] — a null in the MIDDLE proves position-alignment.
    const channels = [
      { mz: mzA, tolDa: TOL },
      null,
      { mz: mzB, tolDa: TOL },
    ];
    const result = await engineRenderMultiChannel(opened.reader, g, channels);

    // length parity + position alignment
    expect(result.length).toBe(channels.length);
    expect(result[1]).toBeNull(); // null slot → null result

    // slot 0 (channel A)
    expect(result[0]).toBeInstanceOf(Float32Array);
    const chA = result[0]!;
    expect(chA.length).toBe(g.width * g.height);
    let nonzeroA = 0;
    for (let i = 0; i < chA.length; i++) if (chA[i]! > 0) nonzeroA++;
    expect(nonzeroA).toBeGreaterThan(0); // some signal

    // slot 2 (channel B)
    expect(result[2]).toBeInstanceOf(Float32Array);
    const chB = result[2]!;
    expect(chB.length).toBe(g.width * g.height);

    // ── PARITY vs the single-channel primitive ────────────────────────────────
    // Each non-null channel must be byte-identical to a standalone render of the same
    // (mz, tolDa). This pins the overlay to engineRenderIonImage (and through it to
    // IV's window-sum source), so the multi-channel path cannot silently diverge.
    const soloA = await engineRenderIonImage(opened.reader, g, mzA, TOL);
    const soloB = await engineRenderIonImage(opened.reader, g, mzB, TOL);
    expect(Array.from(chA)).toEqual(Array.from(soloA.ionImage));
    expect(Array.from(chB)).toEqual(Array.from(soloB.ionImage));
  }, 120_000);

  it("returns an all-null array when every channel is null", async () => {
    const g = opened.grid!;
    const result = await engineRenderMultiChannel(opened.reader, g, [null, null]);
    expect(result).toEqual([null, null]);
  }, 120_000);
});
