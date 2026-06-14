#!/usr/bin/env python3
"""Compare CDN range-read latency from two vantages — client (Mac) vs infra (StackIT VM).

Reads the two probe CSVs (rel,mb,rep,http,ttfb_ms,total_ms), keeps WARM reps (rep>=1,
i.e. discards the first/cold load per the cache-warming plan), averages per file, and
emits a comparison table + a horizontal boxplot with scatter.

Usage: python3 bench/cdn_probe_plot.py <bench_dir> [mac.csv] [vm.csv]
"""
import csv, os, sys
from collections import defaultdict
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BENCH = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/Claude/mzPeakViewer/design-reviews/mzpeakviewer-2026-06-12/bench")
MAC = sys.argv[2] if len(sys.argv) > 2 else os.path.join(BENCH, "cdn-probe-mac.csv")
VM = sys.argv[3] if len(sys.argv) > 3 else os.path.join(BENCH, "cdn-probe-vm.csv")
COLORS = {"client": "#3b54da", "infra": "#c00000"}
LABELS = {"client": "Client (Mac → CDN)", "infra": "Infra (StackIT VM → CDN)"}


def warm_perfile(path):
    """rel -> mean warm TTFB (ms) over reps>=1 with http 200/206."""
    reps = defaultdict(list)
    if not os.path.exists(path):
        return {}
    with open(path) as fh:
        for row in csv.DictReader(fh):
            if int(row["rep"]) >= 1 and row["http"] in ("200", "206"):
                reps[row["rel"]].append(float(row["ttfb_ms"]))
    return {rel: sum(v) / len(v) for rel, v in reps.items() if v}


def stats(a):
    a = np.array(a, float)
    return dict(n=len(a), median=np.median(a), mean=a.mean(),
                p90=np.percentile(a, 90), p99=np.percentile(a, 99), mn=a.min(), mx=a.max())


def fmt(ms):
    return f"{ms:.0f}ms"


def main():
    client = warm_perfile(MAC)
    infra = warm_perfile(VM)
    series = {"client": list(client.values()), "infra": list(infra.values())}
    present = [k for k in ("client", "infra") if series[k]]

    lines = ["# CDN range-read latency — client vs infra (warm)", "",
             "Per-file = mean TTFB over warm reps (rep ≥ 1; first/cold load discarded). "
             "TTFB ≈ one network round-trip to the CDN; a full open issues many such reads.", "",
             "| Vantage | files | min | median | mean | p90 | p99 | max |",
             "|---------|------:|----:|-------:|-----:|----:|----:|----:|"]
    for k in present:
        s = stats(series[k])
        lines.append(f"| {LABELS[k]} | {s['n']} | {fmt(s['mn'])} | {fmt(s['median'])} | "
                     f"{fmt(s['mean'])} | {fmt(s['p90'])} | {fmt(s['p99'])} | {fmt(s['mx'])} |")
    both = [(client[r], infra[r]) for r in client if r in infra]
    if both:
        ratios = [c / i for c, i in both if i > 0]
        lines += ["", f"Files measured on both vantages: **{len(both)}**. "
                  f"Median client/infra TTFB ratio: **{np.median(ratios):.2f}×** "
                  f"(>1 → infra is faster/closer to the CDN)."]
    lines += ["", "Plot: `cdn-probe-boxplot.png`."]
    with open(os.path.join(BENCH, "CDN-PROBE.md"), "w") as fh:
        fh.write("\n".join(lines))

    if present:
        fig, ax = plt.subplots(figsize=(10, 2.2 + 0.7 * len(present)))
        data = [series[k] for k in present]
        pos = list(range(1, len(present) + 1))
        bp = ax.boxplot(data, positions=pos, vert=False, widths=0.5, showfliers=False,
                        patch_artist=True, zorder=2)
        for patch, k in zip(bp["boxes"], present):
            patch.set_facecolor(COLORS[k]); patch.set_alpha(0.18); patch.set_edgecolor(COLORS[k])
        for el in ("whiskers", "caps"):
            for ln in bp[el]:
                ln.set_color("#353c43")
        for ln in bp["medians"]:
            ln.set_color("#151a1e"); ln.set_linewidth(2)
        rng = np.random.RandomState(7)
        for p, k in zip(pos, present):
            ys = p + (rng.rand(len(series[k])) - 0.5) * 0.3
            ax.scatter(series[k], ys, s=14, color=COLORS[k], alpha=0.5,
                       edgecolors="white", linewidths=0.3, zorder=3)
        ax.set_yticks(pos); ax.set_yticklabels([LABELS[k] for k in present])
        ax.set_xlim(left=0)
        ax.set_xlabel("CDN range-read TTFB (ms, warm) — linear")
        ax.set_title("S3/CDN access latency: client vs S3 infrastructure (warm range reads)")
        ax.grid(axis="x", alpha=0.25); ax.set_axisbelow(True)
        fig.tight_layout()
        fig.savefig(os.path.join(BENCH, "cdn-probe-boxplot.png"), dpi=150)
        fig.savefig(os.path.join(BENCH, "cdn-probe-boxplot.svg"))
    print("[cdn-probe] wrote CDN-PROBE.md + cdn-probe-boxplot.png")
    for k in present:
        s = stats(series[k])
        print(f"  {k}: n={s['n']} median={fmt(s['median'])} mean={fmt(s['mean'])} p90={fmt(s['p90'])}")


if __name__ == "__main__":
    main()
