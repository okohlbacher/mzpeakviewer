#!/usr/bin/env python3
"""Summarize the opening benchmark and draw a horizontal boxplot with scatter dots.

Reads  <bench>/open-bench-results.jsonl  (one record per file/source/rep)
Writes <bench>/TIMINGS.md                (summary table + notes)
       <bench>/open-bench-perfile.csv    (per-file averaged times)
       <bench>/open-bench-boxplot.png    (horizontal boxplot + jittered scatter)
       <bench>/open-bench-boxplot.svg

Per-file data point = mean over the OK reps for that (file, source). The boxplot
shows the distribution of those per-file averages, one box per source.

Usage:  python3 bench/plot.py [bench_dir]
"""
import json
import os
import sys
import csv
from collections import defaultdict

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BENCH = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/Claude/mzPeakViewer/design-reviews/mzpeakviewer-2026-06-12/bench"
)
JSONL = os.path.join(BENCH, "open-bench-results.jsonl")
SOURCES = ["local", "s3"]
LABELS = {"local": "Local (file picker)", "s3": "S3 / StackIT CDN (range reads)"}
COLORS = {"local": "#3b54da", "s3": "#c00000"}  # mzPeak accent blue / signal red


def load():
    reps = defaultdict(lambda: defaultdict(list))   # rel -> source -> [ms]
    size = {}
    fails = defaultdict(int)
    with open(JSONL) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            size[r["rel"]] = r.get("sizeMB")
            if r.get("ok") and r.get("ms") is not None:
                reps[r["rel"]][r["source"]].append(r["ms"])
            elif not r.get("ok"):
                fails[r["source"]] += 1
    # per-file average
    perfile = {}  # rel -> {source: avg_ms}
    for rel, by_src in reps.items():
        perfile[rel] = {s: (sum(v) / len(v)) for s, v in by_src.items() if v}
    return perfile, size, fails


def stats(vals):
    a = np.array(vals, dtype=float)
    return dict(
        n=len(a), min=a.min(), p25=np.percentile(a, 25), median=np.median(a),
        mean=a.mean(), p75=np.percentile(a, 75), p90=np.percentile(a, 90),
        p99=np.percentile(a, 99), max=a.max(),
    )


def fmt(ms):
    return f"{ms/1000:.2f}s" if ms >= 1000 else f"{ms:.0f}ms"


def main():
    perfile, size, fails = load()
    series = {s: [perfile[rel][s] for rel in perfile if s in perfile[rel]] for s in SOURCES}

    # ---- per-file CSV ----
    with open(os.path.join(BENCH, "open-bench-perfile.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["file", "sizeMB", "local_avg_ms", "s3_avg_ms"])
        for rel in sorted(perfile, key=lambda r: size.get(r) or 0):
            pf = perfile[rel]
            w.writerow([rel, size.get(rel), round(pf.get("local"), 1) if "local" in pf else "",
                        round(pf.get("s3"), 1) if "s3" in pf else ""])

    # ---- summary table (Markdown) ----
    lines = ["# Opening benchmark — local vs S3 (StackIT/CDN)", "",
             f"Per-file data point = mean of OK reps. Files ≥ 10 MB only.", ""]
    lines.append("| Source | Files | min | p25 | median | mean | p75 | p90 | p99 | max | failed reps |")
    lines.append("|--------|------:|----:|----:|-------:|-----:|----:|----:|----:|----:|-----:|")
    for s in SOURCES:
        if not series[s]:
            lines.append(f"| {LABELS[s]} | 0 | — | — | — | — | — | — | — | — | {fails.get(s,0)} |")
            continue
        st = stats(series[s])
        lines.append(
            f"| {LABELS[s]} | {st['n']} | {fmt(st['min'])} | {fmt(st['p25'])} | "
            f"{fmt(st['median'])} | {fmt(st['mean'])} | {fmt(st['p75'])} | {fmt(st['p90'])} | "
            f"{fmt(st['p99'])} | {fmt(st['max'])} | {fails.get(s,0)} |"
        )
    # paired speedup (files measured on BOTH sources)
    both = [(perfile[r]["local"], perfile[r]["s3"]) for r in perfile
            if "local" in perfile[r] and "s3" in perfile[r]]
    if both:
        ratios = [l / s for l, s in both if s > 0]
        lines += ["", f"Files measured on both: **{len(both)}**. "
                  f"Median local/S3 ratio: **{np.median(ratios):.2f}×** "
                  f"(>1 → S3 faster; range reads avoid reading the whole file)."]
    lines += ["", "Plots: `open-bench-boxplot.png` (distribution) · "
              "`open-bench-time-vs-size.png` (time vs file size) · "
              "per-file data: `open-bench-perfile.csv`", ""]
    with open(os.path.join(BENCH, "TIMINGS.md"), "w") as fh:
        fh.write("\n".join(lines))

    # ---- horizontal boxplot + jittered scatter ----
    present = [s for s in SOURCES if series[s]]
    fig, ax = plt.subplots(figsize=(10, 2.4 + 0.6 * len(present)))
    data = [series[s] for s in present]
    positions = list(range(1, len(present) + 1))
    bp = ax.boxplot(data, positions=positions, vert=False, widths=0.5,
                    showfliers=False, patch_artist=True, zorder=2)
    for patch, s in zip(bp["boxes"], present):
        patch.set_facecolor(COLORS[s]); patch.set_alpha(0.18); patch.set_edgecolor(COLORS[s])
    for el in ("whiskers", "caps", "medians"):
        for ln in bp[el]:
            ln.set_color("#353c43")
    for ln in bp["medians"]:
        ln.set_color("#151a1e"); ln.set_linewidth(2)
    rng = np.random.RandomState(7)
    for pos, s in zip(positions, present):
        ys = pos + (rng.rand(len(series[s])) - 0.5) * 0.28
        ax.scatter(series[s], ys, s=14, color=COLORS[s], alpha=0.55,
                   edgecolors="white", linewidths=0.4, zorder=3)
    ax.set_yticks(positions)
    ax.set_yticklabels([LABELS[s] for s in present])
    ax.set_xlim(left=0)  # linear x axis (per request)
    ax.set_xlabel("Open → first spectrum on screen (ms, linear scale)")
    ax.set_title(f"mzPeakViewer opening benchmark — {len(perfile)} files ≥ 10 MB")
    ax.grid(axis="x", which="both", alpha=0.25)
    ax.set_axisbelow(True)
    fig.tight_layout()
    fig.savefig(os.path.join(BENCH, "open-bench-boxplot.png"), dpi=150)
    fig.savefig(os.path.join(BENCH, "open-bench-boxplot.svg"))

    # ---- opening time vs file size (scatter, log-log, per source + trend) ----
    fig2, ax2 = plt.subplots(figsize=(10, 6))
    for s in present:
        xs = [size[rel] for rel in perfile if s in perfile[rel] and size.get(rel)]
        ys = [perfile[rel][s] for rel in perfile if s in perfile[rel] and size.get(rel)]
        if not xs:
            continue
        ax2.scatter(xs, ys, s=18, color=COLORS[s], alpha=0.55, edgecolors="white",
                    linewidths=0.4, label=LABELS[s], zorder=3)
        # log-log least-squares trend line (time ≈ a · size^b)
        if len(xs) >= 3:
            lx, ly = np.log10(xs), np.log10(ys)
            b, a = np.polyfit(lx, ly, 1)
            gx = np.linspace(min(lx), max(lx), 50)
            ax2.plot(10 ** gx, 10 ** (a + b * gx), color=COLORS[s], lw=1.5, alpha=0.9,
                     zorder=2, label=f"  {s} trend ∝ size^{b:.2f}")
    ax2.set_xscale("log")  # file size spans 10 MB → 1 GB
    ax2.set_ylim(bottom=0)  # linear time axis (per request)
    ax2.set_xlabel("File size (MB, log scale)")
    ax2.set_ylabel("Open → first spectrum (ms, linear scale)")
    ax2.set_title(f"mzPeakViewer opening time vs file size — {len(perfile)} files ≥ 10 MB")
    ax2.grid(which="both", alpha=0.25); ax2.set_axisbelow(True)
    ax2.legend(loc="upper left", fontsize=8, framealpha=0.9)
    fig2.tight_layout()
    fig2.savefig(os.path.join(BENCH, "open-bench-time-vs-size.png"), dpi=150)
    fig2.savefig(os.path.join(BENCH, "open-bench-time-vs-size.svg"))

    print(f"[plot] wrote TIMINGS.md, open-bench-perfile.csv, open-bench-boxplot.png/.svg, "
          f"open-bench-time-vs-size.png/.svg to {BENCH}")
    for s in present:
        st = stats(series[s])
        print(f"  {s}: n={st['n']} median={fmt(st['median'])} mean={fmt(st['mean'])} max={fmt(st['max'])} fails={fails.get(s,0)}")


if __name__ == "__main__":
    main()
