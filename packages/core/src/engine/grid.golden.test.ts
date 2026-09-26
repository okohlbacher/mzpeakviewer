// GOLDEN: coordinate grid encoding (chunk_encoding MS:1003826) — the timsTOF peaks-facet layout
// of the reference writer (HUPO-PSI/mzPeak e62e18c) and mzpeak-convert ≥0.13.0. Fixture is the
// spec repo's diaPASEF.grid.mzpeak (9 spectra, timebase 0.2 — the no-Math.fma case), copied as
// test/fixtures/grid-diapasef.mzpeak. Expected values were read through this engine from its
// point-layout twin diaPASEF.ref.mzpeak (same run, same writer, no grid). Before grid support
// every spectrum read threw "Unknown chunk encoding: MS:1003826".
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decodeGridCell, gridModel } from "mzpeakts";
import { openEngineFile, type EngineFile } from "./open";
import { readEngineSpectrum } from "./spectrum";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/grid-diapasef.mzpeak", import.meta.url));

// Per spectrum: point count, intensity sum, and m/z + 1/K0 at the first / middle / last point.
const REF = [
  { n: 205921, isum: 17891311, mz: [95.09149703493205, 915.4166074499204, 1704.976900971801], k0: [1.0467308802733821, 1.1832200870306457, 1.0826086401871362] },
  { n: 8377, isum: 525567, mz: [95.1085459409012, 796.9008671750964, 1703.9464397733252], k0: [1.363232213510821, 1.0893295872840658, 0.9646780119697353] },
  { n: 960, isum: 43778, mz: [97.10912594295905, 474.13846712467114, 1703.500222039738], k0: [0.7486220539829913, 0.7474856221878954, 0.6951503159615756] },
  { n: 9186, isum: 605903, mz: [95.43742361004576, 774.3982765181808, 1701.0405121164963], k0: [0.9511622819273341, 1.0792474408811554, 1.4251355173433022] },
  { n: 1362, isum: 72396, mz: [95.14729914189232, 488.7536969420427, 1688.9842193425256], k0: [0.9297464058254469, 0.7599833516764252, 0.7985707329535275] },
  { n: 6160, isum: 383941, mz: [96.07507217495562, 835.8903277652511, 1703.4936604502109], k0: [1.234476450835196, 1.2122049397439383, 1.087089486588238] },
  { n: 4735, isum: 334984, mz: [97.30499945423342, 544.2547143582591, 1685.484035573344], k0: [0.8212396170473509, 0.8359626626566037, 0.6803387842358775] },
  { n: 51559, isum: 6470112, mz: [95.04345834591794, 802.6511873199236, 1703.9858147316393], k0: [1.1318506929899397, 1.1463796100588315, 1.3543753830235343] },
  { n: 3193, isum: 204288, mz: [96.24651008657317, 551.820830997445, 1697.4623517553628], k0: [0.6552518718767082, 0.8087744390678602, 0.78836259201795] },
];

describe("GRID golden: MS:1003826 grid-encoded timsTOF peaks", () => {
  let ef: EngineFile;
  beforeAll(async () => {
    const b = await readFile(FIXTURE);
    ef = await openEngineFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, "grid-diapasef.mzpeak");
  }, 60000);

  it("every spectrum matches its non-grid twin (m/z to 1e-6 ppm, 1/K0 to 1e-9)", async () => {
    expect(ef.stats.numSpectra).toBe(REF.length);
    for (let i = 0; i < REF.length; i++) {
      const s = await readEngineSpectrum(ef.reader, i), r = REF[i]!;
      expect(s.mz.length, `spectrum ${i}`).toBe(r.n);
      expect(s.intensity.reduce((a, v) => a + v, 0), `spectrum ${i} intensity`).toBe(r.isum);
      const pick = [0, r.n >> 1, r.n - 1];
      pick.forEach((k, j) => {
        expect(Math.abs(s.mz[k]! - r.mz[j]!) / r.mz[j]!, `spectrum ${i} m/z[${k}]`).toBeLessThan(1e-12);
        const m = s.mobility!;
        expect(Math.abs(m.values[m.index[k]!]! - r.k0[j]!) / r.k0[j]!, `spectrum ${i} 1/K0[${k}]`).toBeLessThan(1e-9);
      });
    }
  });
});

describe("grid models (mzpeakts)", () => {
  const cell = (grid_type: string, parameters: number[], indices: number[]) => ({
    grid_type,
    parameters: { toArray: () => Float64Array.from(parameters) },
    indices: { toArray: () => Uint32Array.from(indices) },
  });
  it("main axis is a running sum INCLUDING the first index; secondary axes are absolute", () => {
    const lin = (idx: number[], delta: boolean) =>
      Array.from(decodeGridCell(cell("MS:1003824", [10, 2, 1], idx), delta).toArray());
    expect(lin([5, 1, 3], true)).toEqual([20, 22, 28]); // bins 5, 6, 9
    expect(lin([5, 1, 3], false)).toEqual([20, 12, 16]);
  });
  it("an unknown grid model fails loud instead of defaulting", () => {
    expect(() => gridModel("MS:0000000", [1, 2])).toThrow(/Unknown coordinate grid model/);
  });
});
