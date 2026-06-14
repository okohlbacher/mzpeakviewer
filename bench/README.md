# Benchmarks & robustness

Outputs land in `design-reviews/mzpeakviewer-2026-06-12/bench/` (gitignored).

## 1. Robustness — open every local file (no size cap)
Drives the real engine open path (`openEngineFile`) over **every** `.mzpeak` under
`~/Claude/mzML2mzPeak/data` with the smoke-test size cap removed.

```bash
cd packages/core
NODE_OPTIONS="--max-old-space-size=12288 --expose-gc" \
  npx vitest run --config corpus/vitest.corpus.config.ts corpus/robustness.test.ts
```
→ `robustness-results.jsonl`, `ROBUSTNESS.md`.

## 2. Opening benchmark — local vs S3, time to first spectrum
Headless Chromium running the built app. Per file (≥ 10 MB) and per source
(`local` = file picker / whole-file read; `s3` = `data.mzpeak.org/v09` range reads),
runs N reps and times **trigger-open → first spectrum visible on screen**.

```bash
# build + serve the app first
VITE_BASE=/ npm run build
( cd app && npm run preview -- --port 4173 --strictPort & )
# run
cd app && node bench/open-benchmark.mjs
```
Env: `BENCH_REPS` (3), `BENCH_MIN_MB` (10), `BENCH_MAX_FILES` (0=all), `S3_BASE`,
`PREVIEW_URL`, `PER_OPEN_TIMEOUT_MS`. → `open-bench-results.jsonl`.

## 3. Table + horizontal boxplot
```bash
python3 bench/plot.py
```
→ `TIMINGS.md` (summary table), `open-bench-perfile.csv`, `open-bench-boxplot.png/.svg`
(horizontal boxplot of per-file average open times, local vs S3, with jittered scatter).
