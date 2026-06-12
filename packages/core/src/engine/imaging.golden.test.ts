// GOLDEN NODE TEST — the keystone file→capabilities→spectrum round-trip against a
// REAL imaging fixture (imzML Example_Continuous). Gates the harvested reader
// boundary + engine: if this passes, the engine can open an imaging mzPeak, detect
// it, reconstruct its grid, and read a pixel spectrum — entirely in node via WASM.

import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { openEngineFile, type EngineFile } from "./open";
import { readEngineSpectrum } from "./spectrum";
import { getSpectrumArrays as referenceGetSpectrumArrays } from "../reader/explorer/browse";
import type { Reader as ExplorerReader } from "../reader/explorer/open";

const FIXTURE = fileURLToPath(
  new URL("../../test/fixtures/imaging.mzpeak", import.meta.url),
);

describe("engine golden round-trip against real imaging.mzpeak", () => {
  let opened: EngineFile;

  beforeAll(async () => {
    const bytes = await readFile(FIXTURE);
    // node Buffer → ArrayBuffer (the wire-side input shape).
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    opened = await openEngineFile(ab, "imaging.mzpeak");
  }, 60_000); // generous timeout for WASM init + metadata read

  it("detects the file as imaging", () => {
    expect(opened.capabilities.imaging.isImaging).toBe(true);
    expect(opened.capabilities.imaging.confidence).toBe("probed");
    expect(opened.capabilities.imaging.signals.length).toBeGreaterThan(0);
  });

  it("reports numSpectra > 0", () => {
    expect(opened.stats.numSpectra).toBeGreaterThan(0);
  });

  it("reconstructs a non-empty grid with width*height > 0", () => {
    expect(opened.grid).not.toBeNull();
    const g = opened.grid!;
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(0);
    expect(g.width * g.height).toBeGreaterThan(0);
    expect(g.coordKey.length).toBe(g.spectrumIndex.length);
    expect(g.coordKey.length).toBeGreaterThan(0);
  });

  it("produces a TIC sized to the grid", () => {
    expect(opened.tic).not.toBeNull();
    expect(opened.tic!.length).toBe(opened.grid!.width * opened.grid!.height);
  });

  it("reads spectrum 0 as equal-length mz/intensity Float arrays with representation", async () => {
    const s = await readEngineSpectrum(opened.reader, 0);
    expect(s.mz).toBeInstanceOf(Float64Array);
    expect(s.intensity).toBeInstanceOf(Float32Array);
    expect(s.mz.length).toBeGreaterThan(0);
    expect(s.mz.length).toBe(s.intensity.length);
    expect(["profile", "centroid"]).toContain(s.representation);
  });

  // VALUE-PARITY: the engine's reconstruction must reproduce the OLD reader's output
  // byte-for-byte — not just the right shape. The reference is the source-faithful
  // Explorer `getSpectrumArrays` harvested into reader/explorer/browse.ts. Same reader
  // handle, same spectrum → identical mz/intensity values (within 1e-6).
  it("engine spectrum 0 is VALUE-EQUAL to the old Explorer reader (parity)", async () => {
    const engine = await readEngineSpectrum(opened.reader, 0);
    // The engine's live reader is the same mzpeakts MzPeakReader the Explorer path
    // wraps; pass it straight to the reference reconstruction.
    const reference = await referenceGetSpectrumArrays(
      opened.reader as unknown as ExplorerReader,
      0,
    );

    expect(engine.mz.length).toBe(reference.mz.length);
    expect(engine.intensity.length).toBe(reference.intensity.length);
    for (let i = 0; i < reference.mz.length; i++) {
      expect(engine.mz[i]).toBeCloseTo(reference.mz[i]!, 6);
      expect(engine.intensity[i]).toBeCloseTo(reference.intensity[i]!, 6);
    }
    // Representation also agrees (both derive it from MS:1000525).
    expect(engine.representation).toBe(reference.representation);
  });
});
