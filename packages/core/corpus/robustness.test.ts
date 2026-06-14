// Robustness test — open EVERY .mzpeak in the local corpus through the real engine
// open path (openEngineFile, the same one the viewer's worker calls), with NO size
// cap (the smoke-test 2 GB cap is removed here on purpose). Records per file:
// opened?, imaging?, spectra, grid, optical, layout, m/z range, duration, error.
// Streams to a crash-safe JSONL and writes ROBUSTNESS.md.
//
// Run (NOT part of `npm test` — it sweeps tens of GB):
//   cd packages/core
//   NODE_OPTIONS="--max-old-space-size=12288 --expose-gc" \
//     npx vitest run --config corpus/vitest.corpus.config.ts corpus/robustness.test.ts
//
// Env:
//   CORPUS_DIR        (default ~/Claude/mzML2mzPeak/data)
//   CORPUS_OUT        (default <repo>/design-reviews/mzpeakviewer-2026-06-12/bench)
//   CORPUS_TIMEOUT_MS (default 300000 per file — large files need headroom)

import { describe, it } from "vitest";
import { openEngineFile } from "../src/engine/open";
import { readFile, appendFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

const CORPUS = process.env.CORPUS_DIR || join(os.homedir(), "Claude/mzML2mzPeak/data");
const OUT =
  process.env.CORPUS_OUT ||
  join(os.homedir(), "Claude/mzPeakViewer/design-reviews/mzpeakviewer-2026-06-12/bench");
const PER_FILE_TIMEOUT = Number(process.env.CORPUS_TIMEOUT_MS) || 300_000;

type Rec = {
  rel: string;
  sizeMB: number;
  ok: boolean;
  durationMs?: number;
  imaging?: boolean;
  confidence?: string;
  numSpectra?: number;
  gridW?: number | null;
  gridH?: number | null;
  optical?: number;
  layout?: string;
  mzMin?: number | null;
  mzMax?: number | null;
  errorName?: string;
  error?: string;
};

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".mzpeak")) acc.push(p);
  }
  return acc;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT after ${ms}ms`)), ms)),
  ]);
}

declare const global: { gc?: () => void };

describe("mzML2mzPeak corpus — robustness (open every file, NO size cap)", () => {
  it("opens every .mzpeak via the engine and records the result", async () => {
    await mkdir(OUT, { recursive: true });
    const all = await walk(CORPUS);
    const withSizes = await Promise.all(all.map(async (p) => ({ p, size: (await stat(p)).size })));
    withSizes.sort((a, b) => a.size - b.size); // small first → fast early signal

    const jsonl = join(OUT, "robustness-results.jsonl");
    await writeFile(jsonl, "");
    const records: Rec[] = [];

    console.log(`[robustness] ${withSizes.length} files under ${CORPUS} (no size cap)`);
    let i = 0;
    for (const { p, size } of withSizes) {
      i++;
      const rel = p.slice(CORPUS.length + 1);
      const sizeMB = +(size / 1e6).toFixed(2);
      let rec: Rec;

      if (size === 0) {
        rec = { rel, sizeMB, ok: false, errorName: "Empty", error: "0-byte file" };
      } else {
        const t0 = Date.now();
        try {
          const buf = await readFile(p); // Buffer IS a Uint8Array — pass it directly,
          // no .buffer.slice() copy (avoids doubling memory on multi-GB files).
          const opened = await withTimeout(
            openEngineFile(buf, rel.split("/").pop()!),
            PER_FILE_TIMEOUT,
          );
          const cap = opened.capabilities;
          rec = {
            rel,
            sizeMB,
            ok: true,
            durationMs: Date.now() - t0,
            imaging: cap.imaging.isImaging,
            confidence: cap.imaging.confidence,
            numSpectra: opened.stats.numSpectra,
            gridW: opened.grid?.width ?? null,
            gridH: opened.grid?.height ?? null,
            optical: opened.opticalImages.length,
            layout: cap.layout,
            mzMin: opened.stats.mzRange?.[0] ?? null,
            mzMax: opened.stats.mzRange?.[1] ?? null,
          };
        } catch (err) {
          rec = {
            rel,
            sizeMB,
            ok: false,
            durationMs: Date.now() - t0,
            errorName: err instanceof Error ? err.name : "unknown",
            error: (err instanceof Error ? err.message : String(err)).slice(0, 400),
          };
        }
      }

      records.push(rec);
      await appendFile(jsonl, JSON.stringify(rec) + "\n");
      const tag = rec.ok
        ? `ok ${rec.imaging ? "IMG" : "lc "} sp=${rec.numSpectra}${rec.optical ? ` opt=${rec.optical}` : ""} ${rec.durationMs}ms`
        : `FAIL ${rec.errorName}`;
      console.log(`[${i}/${withSizes.length}] ${sizeMB}MB ${tag}  ${rel}`);
      if (global.gc) global.gc();
    }

    // ---- Summary ----
    const ok = records.filter((r) => r.ok);
    const failed = records.filter((r) => !r.ok);
    const imaging = ok.filter((r) => r.imaging);
    const optical = ok.filter((r) => (r.optical ?? 0) > 0);
    const byErr: Record<string, number> = {};
    for (const r of failed) byErr[r.errorName || "?"] = (byErr[r.errorName || "?"] || 0) + 1;
    const durs = ok.filter((r) => r.durationMs != null).map((r) => r.durationMs!).sort((a, b) => a - b);
    const pct = (q: number) => (durs.length ? durs[Math.floor(q * (durs.length - 1))] : 0);

    const lines: string[] = [];
    lines.push(`# Corpus robustness — viewer engine open (no size cap) — ${new Date().toISOString().slice(0, 10)}`);
    lines.push("");
    lines.push(`Corpus: \`${CORPUS}\``);
    lines.push("");
    lines.push(`- **Total**: ${records.length}`);
    lines.push(`- **Opened OK**: ${ok.length}`);
    lines.push(`- **Failed**: ${failed.length}`);
    lines.push(`- Imaging files opened: ${imaging.length}`);
    lines.push(`- Optical-bearing opened: ${optical.length}`);
    lines.push(`- Open duration (ok): median ${pct(0.5)}ms · p90 ${pct(0.9)}ms · p99 ${pct(0.99)}ms · max ${durs[durs.length - 1] ?? 0}ms`);
    lines.push("");
    if (failed.length) {
      lines.push("## Failures by error class");
      lines.push("");
      lines.push("| Error | Count |");
      lines.push("|-------|-------|");
      for (const [k, v] of Object.entries(byErr).sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${v} |`);
      lines.push("");
      lines.push("| File | Size MB | Error |");
      lines.push("|------|--------:|-------|");
      for (const r of failed) lines.push(`| ${r.rel} | ${r.sizeMB} | ${r.errorName} — ${r.error ?? ""} |`);
      lines.push("");
    } else {
      lines.push("**No failures.**");
      lines.push("");
    }
    await writeFile(join(OUT, "ROBUSTNESS.md"), lines.join("\n"));
    console.log(
      `[robustness] DONE: ${ok.length} ok, ${failed.length} failed; imaging=${imaging.length}, optical=${optical.length}`,
    );
  });
});
