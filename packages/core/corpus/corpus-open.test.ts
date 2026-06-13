// Corpus open-test harness — drives the REAL engine open path (openEngineFile, the
// same one the viewer's worker calls) over every .mzpeak in the mzML2mzPeak corpus,
// recording for each: opened?, imaging?, spectra count, grid, optical images, layout,
// m/z range, duration, and any error. Results stream to a JSONL (crash-safe) and a
// final SUMMARY.md is written.
//
// Run (NOT part of `npm test`):
//   cd packages/core
//   NODE_OPTIONS="--max-old-space-size=8192 --expose-gc" \
//     npx vitest run --config corpus/vitest.corpus.config.ts
//
// Env:
//   CORPUS_DIR  (default ~/Claude/mzMl2mzPeak/data)
//   CORPUS_OUT  (default <repo>/design-reviews/mzpeakviewer-2026-06-12/corpus)
//   CORPUS_MAX_MB (default 2000 — files larger than this are recorded "skipped:size")
//   CORPUS_TIMEOUT_MS (default 90000 per file)

import { describe, it } from "vitest";
import { openEngineFile } from "../src/engine/open";
import { readFile, appendFile, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

const CORPUS = process.env.CORPUS_DIR || join(os.homedir(), "Claude/mzMl2mzPeak/data");
const OUT =
  process.env.CORPUS_OUT ||
  join(os.homedir(), "Claude/mzPeakViewer/design-reviews/mzpeakviewer-2026-06-12/corpus");
const MAX_BYTES = (Number(process.env.CORPUS_MAX_MB) || 2000) * 1_000_000;
const PER_FILE_TIMEOUT = Number(process.env.CORPUS_TIMEOUT_MS) || 90_000;

type Rec = {
  rel: string;
  sizeMB: number;
  ok: boolean;
  skipped?: string;
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

describe("mzML2mzPeak corpus — viewer engine open", () => {
  it("opens every .mzpeak and records the result", async () => {
    const all = await walk(CORPUS);
    const withSizes = await Promise.all(
      all.map(async (p) => ({ p, size: (await stat(p)).size })),
    );
    withSizes.sort((a, b) => a.size - b.size); // small first → fast early signal

    const jsonl = join(OUT, "corpus-results.jsonl");
    await writeFile(jsonl, ""); // truncate
    const records: Rec[] = [];

    console.log(`[corpus] ${withSizes.length} files under ${CORPUS}`);
    let i = 0;
    for (const { p, size } of withSizes) {
      i++;
      const rel = p.slice(CORPUS.length + 1);
      const sizeMB = +(size / 1e6).toFixed(2);
      let rec: Rec;

      if (size > MAX_BYTES) {
        rec = { rel, sizeMB, ok: false, skipped: "size" };
      } else if (size === 0) {
        rec = { rel, sizeMB, ok: false, errorName: "Empty", error: "0-byte file" };
      } else {
        const t0 = Date.now();
        try {
          const bytes = await readFile(p);
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          const opened = await withTimeout(openEngineFile(ab, rel.split("/").pop()!), PER_FILE_TIMEOUT);
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
            error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
          };
        }
      }

      records.push(rec);
      await appendFile(jsonl, JSON.stringify(rec) + "\n");
      const tag = rec.skipped
        ? `SKIP(${rec.skipped})`
        : rec.ok
          ? `ok ${rec.imaging ? "IMG" : "lc "} sp=${rec.numSpectra}${rec.optical ? ` opt=${rec.optical}` : ""} ${rec.durationMs}ms`
          : `FAIL ${rec.errorName}`;
      console.log(`[${i}/${withSizes.length}] ${sizeMB}MB ${tag}  ${rel}`);
      if (global.gc) global.gc();
    }

    // ---- Summary ----
    const ok = records.filter((r) => r.ok);
    const failed = records.filter((r) => !r.ok && !r.skipped);
    const skipped = records.filter((r) => r.skipped);
    const imaging = ok.filter((r) => r.imaging);
    const optical = ok.filter((r) => (r.optical ?? 0) > 0);
    const byErr: Record<string, number> = {};
    for (const r of failed) byErr[r.errorName || "?"] = (byErr[r.errorName || "?"] || 0) + 1;

    const lines: string[] = [];
    lines.push(`# Corpus open test — viewer engine — ${new Date().toISOString().slice(0, 10)}`);
    lines.push("");
    lines.push(`Corpus: \`${CORPUS}\``);
    lines.push("");
    lines.push(`- **Total**: ${records.length}`);
    lines.push(`- **Opened OK**: ${ok.length}`);
    lines.push(`- **Failed**: ${failed.length}`);
    lines.push(`- **Skipped (>${MAX_BYTES / 1e6} MB)**: ${skipped.length}`);
    lines.push(`- Imaging files opened: ${imaging.length}`);
    lines.push(`- Optical-bearing opened: ${optical.length}`);
    lines.push("");
    if (Object.keys(byErr).length) {
      lines.push("## Failures by error class");
      lines.push("");
      lines.push("| Error | Count |");
      lines.push("|-------|-------|");
      for (const [k, v] of Object.entries(byErr).sort((a, b) => b[1] - a[1]))
        lines.push(`| ${k} | ${v} |`);
      lines.push("");
      lines.push("## Failed / skipped files");
      lines.push("");
      lines.push("| File | Size MB | Result |");
      lines.push("|------|--------:|--------|");
      for (const r of [...failed, ...skipped])
        lines.push(`| ${r.rel} | ${r.sizeMB} | ${r.skipped ? "skip:" + r.skipped : r.errorName + " — " + (r.error ?? "")} |`);
      lines.push("");
    }
    lines.push("## Imaging files (opened)");
    lines.push("");
    lines.push("| File | Grid | Spectra | Optical | Conf |");
    lines.push("|------|------|--------:|--------:|------|");
    for (const r of imaging)
      lines.push(`| ${r.rel} | ${r.gridW}×${r.gridH} | ${r.numSpectra} | ${r.optical} | ${r.confidence} |`);

    await writeFile(join(OUT, "SUMMARY.md"), lines.join("\n"));
    console.log(
      `[corpus] DONE: ${ok.length} ok, ${failed.length} failed, ${skipped.length} skipped; imaging=${imaging.length}, optical=${optical.length}`,
    );
  });
});
