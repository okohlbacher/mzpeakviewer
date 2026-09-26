// Grid-layout A/B harness — reads EVERY spectrum of a grid-encoded archive (chunk_encoding
// MS:1003826) and of its non-grid twin (same run, 0.12.x TOF layout or the reference writer's
// point layout) through the viewer engine and compares them point for point: counts and
// intensities exact, m/z within GRID_AB_PPM (default 1e-6 ppm; no Math.fma in JS, see
// mzpeakts gridModel), 1/K0 within 1e-9 relative.
//
// Run (NOT part of `npm test`) — serve both files first:
//   npx http-server <dir> -p 8903 --cors -s &
//   GRID_A=http://127.0.0.1:8903/run.grid.mzpeak GRID_B=http://127.0.0.1:8903/run.tof.mzpeak \
//     npx vitest run --config corpus/vitest.corpus.config.ts -t grid-ab
import { describe, it, expect } from "vitest";
import { openEngineUrl } from "../src/engine/open";
import { readEngineSpectrum } from "../src/engine/spectrum";
import { engineExtractChrom } from "../src/engine/chrom";
import { engineScanBreakdown } from "../src/engine/scanBreakdown";

const A = process.env.GRID_A, B = process.env.GRID_B;
const PPM = Number(process.env.GRID_AB_PPM) || 1e-6;

describe.skipIf(!A || !B)("grid-ab", () => {
  it("grid archive decodes to its twin", async () => {
    const [ga, gb] = [await openEngineUrl(A!), await openEngineUrl(B!)];
    const n = ga.stats.numSpectra;
    expect(gb.stats.numSpectra).toBe(n);
    let pts = 0, worstPpm = 0, worstK0 = 0, withMob = 0;
    for (let i = 0; i < n; i++) {
      const [a, b] = [await readEngineSpectrum(ga.reader, i), await readEngineSpectrum(gb.reader, i)];
      expect(a.mz.length, `spectrum ${i} points`).toBe(b.mz.length);
      for (let k = 0; k < a.mz.length; k++) {
        if (a.intensity[k] !== b.intensity[k])
          throw new Error(`spectrum ${i} point ${k}: intensity ${a.intensity[k]} vs ${b.intensity[k]}`);
        worstPpm = Math.max(worstPpm, (Math.abs(a.mz[k] - b.mz[k]) / b.mz[k]) * 1e6);
      }
      expect(!!a.mobility, `spectrum ${i} mobility presence`).toBe(!!b.mobility);
      if (a.mobility && b.mobility) {
        withMob++;
        // MobilityCodec: per-peak index into a dictionary of distinct 1/K0 values.
        const [ma, mb] = [a.mobility, b.mobility];
        expect(ma.index.length).toBe(a.mz.length);
        for (let k = 0; k < ma.index.length; k++) {
          const [ka, kb] = [ma.values[ma.index[k]!]!, mb.values[mb.index[k]!]!];
          if (!(kb > 0)) throw new Error(`spectrum ${i} point ${k}: bad twin 1/K0 ${kb}`);
          worstK0 = Math.max(worstK0, Math.abs(ka - kb) / kb);
        }
      }
      pts += a.mz.length;
    }
    process.stderr.write(`grid-ab: ${n} spectra, ${pts} points, ${withMob} with mobility; worst m/z ${worstPpm.toExponential(2)} ppm, worst 1/K0 rel ${worstK0.toExponential(2)}\n`);
    // XIC: the extractor reads the peaks facet on its own path (grid bounds are real m/z).
    // Same scan context the worker caches after scanBreakdown.
    const ctxOf = async (r: typeof ga.reader) => {
      const { stats, rows } = await engineScanBreakdown(r);
      return { rows, representationCounts: stats.representationCounts };
    };
    const [ca, cb] = [await ctxOf(ga.reader), await ctxOf(gb.reader)];
    for (const mz of [445.12, 524.26, 785.84]) {
        const req = { mode: "xic" as const, mz, tolDa: 0.02 };
      const [xa, xb] = [await engineExtractChrom(ga.reader, req, ca), await engineExtractChrom(gb.reader, req, cb)];
      expect(xa.time.length, `XIC ${mz} length`).toBe(xb.time.length);
      let sa = 0, sb = 0;
      for (let k = 0; k < xa.intensity.length; k++) { sa += xa.intensity[k]; sb += xb.intensity[k]; }
      process.stderr.write(`grid-ab: XIC ${mz}±0.02 ${xa.time.length} pts, sum ${sa} vs ${sb}\n`);
      expect(sb).toBeGreaterThan(0);
      expect(Math.abs(sa - sb) / sb).toBeLessThan(1e-6);
    }
    expect(worstPpm).toBeLessThan(PPM);
    expect(worstK0).toBeLessThan(1e-9);
  });
});
