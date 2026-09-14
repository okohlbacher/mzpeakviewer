// Corpus SWEEP harness — drives the real engine over the example corpus via HTTP RANGE
// reads (openEngineUrl: the path the deployed viewer actually uses, and the only one
// that works on multi-GB files without slurping them). Per file it records the open
// result AND probes the decode paths the recent releases changed: a signal-bearing
// spectrum, both facets of a dual-stored file, the grid/IMS reconstruction, and DIA
// isolation-window discovery.
//
// Run (NOT part of `npm test`) — serve the corpus first:
//   npx http-server <corpus-root> -p 8903 --cors -s &
//   cd packages/core
//   CORPUS_URL=http://127.0.0.1:8903 CORPUS_DIR=<corpus-root> \
//     npx vitest run --config corpus/vitest.corpus.config.ts -t sweep
//
// Env: CORPUS_DIR (local root, for discovery + sizes), CORPUS_URL (http root),
//      CORPUS_OUT (default <CORPUS_DIR>/../corpus-sweep-out),
//      SWEEP_TIMEOUT_MS (per phase, default 120000), SWEEP_FILTER (substring).
import { describe, it } from "vitest";
import { openEngineUrl } from "../src/engine/open";
import { readEngineSpectrum } from "../src/engine/spectrum";
import { buildDiaWindowMap } from "../src/engine/dia";
import { appendFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";

const DIR = process.env.CORPUS_DIR!;
const URLROOT = (process.env.CORPUS_URL || "http://127.0.0.1:8903").replace(/\/$/, "");
const OUT = process.env.CORPUS_OUT || join(DIR, "..", "corpus-sweep-out");
const T = Number(process.env.SWEEP_TIMEOUT_MS) || 120_000;
const FILTER = process.env.SWEEP_FILTER || "";

type Probe = {
  idx: number; pts: number; repr: string | null;
  src?: string; alt?: boolean; mzLo?: number; mzHi?: number;
};
type Rec = {
  rel: string; sizeMB: number; ok: boolean;
  openMs?: number; numSpectra?: number; layout?: string;
  imaging?: boolean; gridW?: number | null; gridH?: number | null; optical?: number;
  chroms?: number; wavelength?: number;
  mzMin?: number | null; mzMax?: number | null;
  probe?: Probe | null; forcedCentroid?: string; forcedProfile?: string;
  diaWindows?: number | string;
  phase?: string; errorName?: string; error?: string;
};

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".mzpeak")) acc.push(p);
  }
  return acc;
}
const to = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`TIMEOUT ${what} ${ms}ms`)), ms))]);

describe("corpus sweep", () => {
  it("opens and probes every .mzpeak over HTTP range reads", async () => {
    const all = (await walk(DIR)).filter((p) => !FILTER || p.includes(FILTER));
    const sized = await Promise.all(all.map(async (p) => ({ p, size: (await stat(p)).size })));
    sized.sort((a, b) => a.size - b.size); // small first → fast early signal
    await mkdir(OUT, { recursive: true });
    const jsonl = join(OUT, "sweep.jsonl");
    await writeFile(jsonl, "");
    console.log(`[sweep] ${sized.length} files`);

    let n = 0;
    for (const { p, size } of sized) {
      n++;
      const rel = p.slice(DIR.length + 1);
      const rec: Rec = { rel, sizeMB: +(size / 1e6).toFixed(1), ok: false };
      const url = `${URLROOT}/${rel.split("/").map(encodeURIComponent).join("/")}`;
      const t0 = Date.now();
      try {
        rec.phase = "open";
        const ef = await to(openEngineUrl(url), T, "open");
        rec.openMs = Date.now() - t0;
        const cap = ef.capabilities;
        rec.numSpectra = ef.stats.numSpectra;
        rec.layout = cap.layout;
        rec.imaging = cap.imaging.isImaging;
        rec.gridW = ef.grid?.width ?? null;
        rec.gridH = ef.grid?.height ?? null;
        rec.optical = ef.opticalImages.length;
        rec.chroms = cap.chromatograms.numChromatograms; // NOT ef.stats — that field doesn't exist there
        rec.wavelength = cap.wavelength?.count ?? 0;
        rec.mzMin = ef.stats.mzRange?.[0] ?? null;
        rec.mzMax = ef.stats.mzRange?.[1] ?? null;

        // ── spectrum probe: first signal-bearing spectrum among a few positions ──
        rec.phase = "spectrum";
        const N = ef.stats.numSpectra;
        if (N > 0) {
          for (const i of [Math.floor(N / 2), 0, Math.floor(N / 4), N - 1]) {
            const s = await to(readEngineSpectrum(ef.reader, i), T, `spectrum ${i}`);
            if (s.mz.length > 0) {
              rec.probe = {
                idx: i, pts: s.mz.length, repr: s.representation ?? null,
                src: s.sourceUsed, alt: s.altAvailable,
                mzLo: +s.mz[0]!.toFixed(4), mzHi: +s.mz[s.mz.length - 1]!.toFixed(4),
              };
              break;
            }
            rec.probe = { idx: i, pts: 0, repr: s.representation ?? null, src: s.sourceUsed, alt: s.altAvailable };
          }
          // ── dual-stored: force each facet ──
          if (rec.probe?.alt) {
            rec.phase = "forced";
            const i = rec.probe.idx;
            const c = await to(readEngineSpectrum(ef.reader, i, "centroid"), T, "forced centroid");
            const pr = await to(readEngineSpectrum(ef.reader, i, "profile"), T, "forced profile");
            rec.forcedCentroid = `${c.sourceUsed}/${c.mz.length}`;
            rec.forcedProfile = `${pr.sourceUsed}/${pr.mz.length}`;
          }
        }
        // ── DIA isolation windows (metadata scan; skip on huge runs) ──
        rec.phase = "dia";
        if (N > 0 && N <= 60_000) {
          try {
            const w = await to(Promise.resolve().then(() => buildDiaWindowMap(ef.reader)), T, "dia");
            rec.diaWindows = w.length;
          } catch (e) { rec.diaWindows = `ERR:${e instanceof Error ? e.message.slice(0, 60) : e}`; }
        } else rec.diaWindows = "skipped";

        rec.ok = true;
        rec.phase = undefined;
      } catch (err) {
        rec.errorName = err instanceof Error ? err.name : "unknown";
        rec.error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      }
      await appendFile(jsonl, JSON.stringify(rec) + "\n");
      const tag = rec.ok ? "ok " : "FAIL";
      console.log(`[${n}/${sized.length}] ${tag} ${rec.rel} (${rec.sizeMB}MB) ${rec.ok
        ? `n=${rec.numSpectra} ${rec.layout} probe=${rec.probe?.pts ?? "-"}pts/${rec.probe?.src ?? "-"} dia=${rec.diaWindows}`
        : `[${rec.phase}] ${rec.errorName}: ${rec.error}`}`);
    }
  }, 3_600_000);
});
