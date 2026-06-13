// Verify Numpress-Linear (MS:1002312) files now OPEN and DECODE a real spectrum
// (not just pass the capability gate). Uses a real pwiz Thermo BSA file.
import { describe, it, expect } from "vitest";
import { openEngineFile } from "../src/engine/open";
import { readEngineSpectrum } from "../src/engine/spectrum";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

const FILE = join(
  os.homedir(),
  "Claude/mzMl2mzPeak/data/pwiz-examples/Thermo/Reader_Thermo_Test.data/BSA-FT-HCD.mzpeak",
);

describe("Numpress Linear decode (MS:1002312)", () => {
  it("opens and reads a real spectrum from a Numpress-Linear file", async () => {
    const bytes = await readFile(FILE);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const opened = await openEngineFile(ab, "BSA-FT-HCD.mzpeak"); // must NOT throw now
    expect(opened.stats.numSpectra).toBeGreaterThan(0);

    const spec = await readEngineSpectrum(opened.reader, 0);
    // Decode sanity: non-empty, equal-length, finite, ascending m/z.
    expect(spec.mz.length).toBeGreaterThan(0);
    expect(spec.intensity.length).toBe(spec.mz.length);
    let ascending = true;
    let allFinite = true;
    for (let i = 0; i < spec.mz.length; i++) {
      if (!Number.isFinite(spec.mz[i]!) || !Number.isFinite(spec.intensity[i]!)) allFinite = false;
      if (i > 0 && spec.mz[i]! < spec.mz[i - 1]!) ascending = false;
    }
    expect(allFinite).toBe(true);
    expect(ascending).toBe(true);
    // eslint-disable-next-line no-console
    console.error(
      `[numpress] OK: ${opened.stats.numSpectra} spectra; spectrum0 = ${spec.mz.length} pts, m/z ${spec.mz[0]?.toFixed(2)}–${spec.mz[spec.mz.length - 1]?.toFixed(2)}`,
    );
  });
});
