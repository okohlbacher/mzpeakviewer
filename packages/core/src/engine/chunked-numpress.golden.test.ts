// GOLDEN: chunk-layout peaks facet, Numpress-encoded m/z, NO physical mz_chunk_values
// column (mzpeak-convert >=0.7.10 omits it when every chunk is Numpress; the array_index
// still declares it). Trimmed from a real Shimadzu LCMS-9030 export
// (test/fixtures/gen_chunked_numpress.py). Guards the null-crash this layout caused on
// every spectrum read: ChunkLayoutReader read the declared-but-absent column
// unconditionally → "null is not an object (evaluating 'o.get')" in the deployed viewer.
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openEngineFile, type EngineFile } from "./open";
import { readEngineSpectrum } from "./spectrum";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/chunked-numpress.mzpeak", import.meta.url));

describe("CHUNKED-NUMPRESS golden: peaks facet without mz_chunk_values", () => {
  let ef: EngineFile;
  beforeAll(async () => {
    const b = await readFile(FIXTURE);
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    ef = await openEngineFile(ab, "chunked-numpress.mzpeak");
  }, 60000);

  it("opens (3 spectra, all-centroid Shimadzu)", () => {
    expect(ef.stats.numSpectra).toBe(3);
  });

  it("every spectrum decodes from the Numpress chunks with sane m/z", async () => {
    for (const i of [0, 1, 2]) {
      const s = await readEngineSpectrum(ef.reader, i);
      expect(s.mz.length).toBeGreaterThan(0);
      expect(s.mz.length).toBe(s.intensity.length);
      expect(s.representation).toBe("centroid");
      expect(s.mz[0]!).toBeGreaterThan(100); // real m/z, not indices/zeros
      for (let k = 1; k < s.mz.length; k++) expect(s.mz[k]!).toBeGreaterThanOrEqual(s.mz[k - 1]!);
    }
  });
});
