// Opening benchmark — measures, in the PRELOADED viewer (a real headless Chromium
// running the built app), the wall-clock time from triggering an open to the first
// spectrum being displayed on screen. Two sources per file:
//   • local : the file opened from disk via the file picker (whole-file read)
//   • s3    : the same file opened from the data.mzpeak.org / StackIT CDN URL
//             (HTTP range reads — only metadata + spectrum 0 are fetched)
//
// For each (file, source) it runs N reps and records every rep; downstream the
// average per (file, source) is the data point. Files < BENCH_MIN_MB are excluded.
//
// Signal: open auto-loads + auto-routes to the Spectra view (store.selectSpectrum(0)
// with route=true), so "first spectrum on screen" = the `spectrum-points` element
// becoming visible. t0 is captured immediately before the open is triggered.
//
// Run:
//   cd app
//   node bench/open-benchmark.mjs
// Env: PREVIEW_URL, CORPUS_DIR, S3_BASE, BENCH_OUT, BENCH_REPS, BENCH_MIN_MB,
//      BENCH_MAX_FILES, PER_OPEN_TIMEOUT_MS, BROWSER_RECYCLE
import { chromium } from "@playwright/test";
import { readdir, stat, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

const PREVIEW = process.env.PREVIEW_URL || "http://localhost:4173";
const CORPUS = process.env.CORPUS_DIR || join(os.homedir(), "Claude/mzML2mzPeak/data");
const S3_BASE = (process.env.S3_BASE || "https://data.mzpeak.org/v09").replace(/\/$/, "");
const OUT = process.env.BENCH_OUT || join(os.homedir(), "Claude/mzPeakViewer/design-reviews/mzpeakviewer-2026-06-12/bench");
const REPS = Number(process.env.BENCH_REPS) || 3;
const MIN_MB = Number(process.env.BENCH_MIN_MB) || 10;
const MAX_FILES = Number(process.env.BENCH_MAX_FILES) || 0; // 0 = all
const TIMEOUT = Number(process.env.PER_OPEN_TIMEOUT_MS) || 120_000;
const RECYCLE = Number(process.env.BROWSER_RECYCLE) || 40;

const log = (...a) => console.log(...a);

async function walk(dir, acc = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".mzpeak")) acc.push(p);
  }
  return acc;
}

function s3UrlFor(rel) {
  // Encode each path segment (corpus dirs contain spaces and commas).
  return `${S3_BASE}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

async function headOk(url) {
  try {
    const r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
    return r.status === 206 || r.status === 200;
  } catch { return false; }
}

/** Open in a fresh context, measure trigger → first-spectrum-visible. Returns ms. */
async function measureOpen(browser, source, { localPath, s3url }) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const pg = await ctx.newPage();
  try {
    await pg.goto(PREVIEW, { waitUntil: "domcontentloaded" });
    await pg.getByTestId("idle-view").waitFor({ timeout: 20_000 });

    const t0 = performance.now();
    if (source === "local") {
      await pg.getByTestId("file-input").setInputFiles(localPath);
    } else {
      await pg.getByTestId("idle-url").fill(s3url);
      await pg.getByTestId("idle-url").press("Enter"); // form submit → store.openUrl
    }
    // First spectrum on screen (open auto-routes to the Spectra view).
    await pg.getByTestId("spectrum-points").waitFor({ state: "visible", timeout: TIMEOUT });
    const ms = performance.now() - t0;

    // Sanity: an error banner would invalidate the measurement.
    if (await pg.getByTestId("error").count()) throw new Error("error banner shown");
    return { ok: true, ms: Math.round(ms) };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 160) };
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const all = (await walk(CORPUS));
  const withSizes = [];
  for (const p of all) {
    const size = (await stat(p)).size;
    if (size >= MIN_MB * 1e6) withSizes.push({ p, size, rel: p.slice(CORPUS.length + 1) });
  }
  withSizes.sort((a, b) => a.size - b.size);
  const files = MAX_FILES > 0 ? withSizes.slice(0, MAX_FILES) : withSizes;
  log(`[bench] ${files.length} files >= ${MIN_MB}MB · reps=${REPS} · preview=${PREVIEW} · s3=${S3_BASE}`);

  const jsonl = join(OUT, "open-bench-results.jsonl");
  await writeFile(jsonl, "");

  let browser = await chromium.launch();
  let sinceRecycle = 0;
  const recycle = async () => {
    if (++sinceRecycle >= RECYCLE) { await browser.close().catch(() => {}); browser = await chromium.launch(); sinceRecycle = 0; }
  };

  let i = 0;
  for (const { p, size, rel } of files) {
    i++;
    const sizeMB = +(size / 1e6).toFixed(2);
    const s3url = s3UrlFor(rel);
    const s3Available = await headOk(s3url);

    for (const source of ["local", "s3"]) {
      const reps = [];
      if (source === "s3" && !s3Available) {
        const rec = { rel, sizeMB, source, rep: 0, ok: false, error: "not on S3" };
        await appendFile(jsonl, JSON.stringify(rec) + "\n");
        continue;
      }
      for (let r = 0; r < REPS; r++) {
        const res = await measureOpen(browser, source, { localPath: p, s3url });
        const rec = { rel, sizeMB, source, rep: r, ...res };
        await appendFile(jsonl, JSON.stringify(rec) + "\n");
        if (res.ok) reps.push(res.ms);
        await recycle();
      }
      const avg = reps.length ? Math.round(reps.reduce((a, b) => a + b, 0) / reps.length) : null;
      log(`[${i}/${files.length}] ${sizeMB}MB ${source.padEnd(5)} avg=${avg ?? "FAIL"}ms (${reps.length}/${REPS})  ${rel}`);
    }
  }
  await browser.close().catch(() => {});
  log(`[bench] DONE → ${jsonl}`);
}

main().catch((e) => { console.error("[bench] FATAL", e); process.exit(1); });
