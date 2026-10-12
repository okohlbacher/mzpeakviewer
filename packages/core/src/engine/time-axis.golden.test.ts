// GOLDEN: a run with NO retention-time axis. imzML states no scan start times, so the converter
// writes time = 0 for every spectrum (test/fixtures/imaging-no-rt.mzpeak = the imzML reference
// Example_Processed, mzpeak-convert 0.17.2, 9 pixels). Plotted against RT, every TIC/XIC point
// stacked at x = 0 and a chromatogram click could not tell spectra apart (reported on the GBM
// imaging run Test_P15_r2). Without an axis the spectrum INDEX stands in everywhere.
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openEngineFile, type EngineFile } from "./open";
import { engineScanBreakdown } from "./scanBreakdown";
import { engineExtractChrom } from "./chrom";

const load = async (name: string) => {
  const b = await readFile(fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url)));
  return openEngineFile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, name);
};

describe("time axis: a run without retention times uses the spectrum index", () => {
  let ef: EngineFile;
  beforeAll(async () => { ef = await load("imaging-no-rt.mzpeak"); }, 60000);

  it("stats flag the index axis, report no RT range, and browse.rt is the index", async () => {
    const { stats, browse, rows } = await engineScanBreakdown(ef.reader);
    expect(stats.timeAxis).toBe("index");
    expect(stats.rtRange).toBeNull();
    expect(Array.from(browse.rt)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows.map((r) => r.time)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("TIC and XIC run along the index, one point per spectrum", async () => {
    const { stats, rows } = await engineScanBreakdown(ef.reader);
    const ctx = { rows, representationCounts: stats.representationCounts };
    const tic = await engineExtractChrom(ef.reader, { mode: "tic" }, ctx);
    expect(Array.from(tic.time)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const xic = await engineExtractChrom(ef.reader, { mode: "xic", mz: 500, tolDa: 300 }, ctx);
    expect(Array.from(xic.time)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // a "time" window is an index window here
    const win = await engineExtractChrom(ef.reader, { mode: "xic", mz: 500, tolDa: 300, rt: [2, 4] }, ctx);
    expect(Array.from(win.time)).toEqual([2, 3, 4]);
  });

  it("the converter's placeholder chromatogram row is not listed as a chromatogram", async () => {
    const { engineChromatogramList } = await import("./chrom");
    expect(engineChromatogramList(ef.reader)).toEqual([]); // the archive holds one marked placeholder row
  });

  it("a run WITH retention times keeps seconds (dual.mzpeak: 0.1, 0.2, 0.3 min)", async () => {
    const dual = await load("dual.mzpeak");
    const { stats, browse } = await engineScanBreakdown(dual.reader);
    expect(stats.timeAxis).toBeUndefined();
    expect(Array.from(browse.rt).map((t) => Math.round(t * 1000) / 1000)).toEqual([6, 12, 18]);
    expect(stats.rtRange!.map((t) => Math.round(t))).toEqual([6, 18]);
  }, 60000);
});
