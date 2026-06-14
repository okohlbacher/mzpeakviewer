#!/usr/bin/env python3
"""Overall opening-time comparison, folding in the two StackIT-hosted CDN results.

Measured opening times (open → first spectrum, full engine open, ≤49 MB cut):
  - Local      : Mac file picker (disk, no network)        [open-bench-perfile.csv]
  - CDN client : Mac → StackIT CDN (range reads)            [open-bench-perfile.csv]
StackIT-hosted network latency (warm range-read TTFB):
  - client TTFB : Mac → StackIT CDN                         [cdn-probe-mac.csv]
  - infra  TTFB : StackIT VM → StackIT CDN                  [cdn-probe-vm.csv]

A full open is RTT-dominated (~N sequential range reads), so we ESTIMATE the
StackIT-infra opening time by scaling the measured client-CDN opening distribution
by the measured infra/client TTFB ratio. That estimate is drawn hatched + labelled
"(est.)" — it is not a direct measurement (no browser/Node on the VM).

Usage: python3 bench/opening_overall.py [bench_dir]
"""
import csv, os, sys
from collections import defaultdict
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BENCH = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/Claude/mzPeakViewer/design-reviews/mzpeakviewer-2026-06-12/bench")
PERFILE = os.path.join(BENCH, "cut1750", "open-bench-perfile.csv")


def warm_ttfb_median(path):
    reps = defaultdict(list)
    if not os.path.exists(path):
        return None
    with open(path) as fh:
        next(fh, None)
        for line in fh:
            p = line.rstrip("\n").split(",")
            if len(p) < 6:
                continue
            mb, rep, http, ttfb, total = p[-5:]
            try:
                if int(rep) >= 1 and http in ("200", "206"):
                    reps[",".join(p[:-5])].append(float(ttfb))
            except ValueError:
                continue
    perfile = [sum(v) / len(v) for v in reps.values() if v]
    return float(np.median(perfile)) if perfile else None


def stats(a):
    a = np.array(a, float)
    return dict(n=len(a), mn=a.min(), median=float(np.median(a)), mean=a.mean(),
                p90=np.percentile(a, 90), p99=np.percentile(a, 99), mx=a.max())


def fmt(ms):
    return f"{ms/1000:.2f}s" if ms >= 1000 else f"{ms:.0f}ms"


def main():
    local, cdn_client = [], []
    with open(PERFILE) as fh:
        for r in csv.DictReader(fh):
            if r.get("local_avg_ms"):
                local.append(float(r["local_avg_ms"]))
            if r.get("s3_avg_ms"):
                cdn_client.append(float(r["s3_avg_ms"]))

    cttfb = warm_ttfb_median(os.path.join(BENCH, "cdn-probe-mac.csv"))
    ittfb = warm_ttfb_median(os.path.join(BENCH, "cdn-probe-vm.csv"))
    ratio = (ittfb / cttfb) if (cttfb and ittfb) else None
    cdn_infra_est = [v * ratio for v in cdn_client] if ratio else []

    series = [
        ("Local filesystem", local, "#2e9e5b", False),
        ("Remote S3", cdn_client, "#3b54da", False),
    ]
    if cdn_infra_est:
        series.append(("Local S3", cdn_infra_est, "#c00000", True))

    # ---- summary ----
    lines = ["# Overall opening times — incl. StackIT vantages", "",
             "Opening time = open → first spectrum (full engine open), ≤49 MB cut, warm.", "",
             "| Series | files | min | median | mean | p90 | p99 | max |",
             "|--------|------:|----:|-------:|-----:|----:|----:|----:|"]
    for name, vals, _c, est in series:
        if not vals:
            continue
        s = stats(vals)
        tag = " *(estimated)*" if est else ""
        lines.append(f"| {name}{tag} | {s['n']} | {fmt(s['mn'])} | {fmt(s['median'])} | "
                     f"{fmt(s['mean'])} | {fmt(s['p90'])} | {fmt(s['p99'])} | {fmt(s['mx'])} |")
    lines += ["", "**StackIT-hosted network latency (warm range-read TTFB, the two CDN-probe results):**",
              f"- Client (Mac → StackIT CDN): median **{fmt(cttfb)}**" if cttfb else "",
              f"- Infra (StackIT VM → StackIT CDN): median **{fmt(ittfb)}**" if ittfb else "",
              (f"- Infra is **{1/ratio:.1f}× faster** per round-trip → the StackIT-infra opening "
               f"time is estimated at the client open × {ratio:.2f} "
               f"(median ≈ {fmt(float(np.median(cdn_infra_est)))})." if ratio else ""),
              "",
              "The infra opening series is ESTIMATED (TTFB-scaled): a full open is ~N sequential "
              "range reads, so it scales with per-RTT latency. A direct measurement needs Node on "
              "the VM (offered).", "",
              "Plot: `opening-overall-boxplot.png`."]
    with open(os.path.join(BENCH, "OVERALL-OPENING.md"), "w") as fh:
        fh.write("\n".join([l for l in lines if l is not None]))

    # ---- plot ---- (rows sorted by increasing mean time, bottom → top)
    plotted = sorted((s for s in series if s[1]), key=lambda s: np.mean(s[1]))
    fig, ax = plt.subplots(figsize=(10, 2.0 + 0.7 * len(plotted)))
    pos = list(range(1, len(plotted) + 1))
    bp = ax.boxplot([s[1] for s in plotted], positions=pos, vert=False, widths=0.5,
                    showfliers=False, patch_artist=True, zorder=2)
    for patch, (_n, _v, c, est) in zip(bp["boxes"], plotted):
        patch.set_facecolor(c); patch.set_alpha(0.18); patch.set_edgecolor(c)
        if est:
            patch.set_hatch("///")
    for el in ("whiskers", "caps"):
        for ln in bp[el]:
            ln.set_color("#353c43")
    for ln in bp["medians"]:
        ln.set_color("#151a1e"); ln.set_linewidth(2)
    rng = np.random.RandomState(7)
    for p, (_n, vals, c, _e) in zip(pos, plotted):
        ys = p + (rng.rand(len(vals)) - 0.5) * 0.3
        ax.scatter(vals, ys, s=12, color=c, alpha=0.45, edgecolors="white", linewidths=0.3, zorder=3)
    ax.set_yticks(pos); ax.set_yticklabels([s[0] for s in plotted])
    ax.set_xlim(left=0)
    ax.set_xlabel("Open → first spectrum on screen (ms, linear) — hatched = estimated")
    ax.set_title("mzPeakViewer opening times — Local filesystem vs Local S3 vs Remote S3")
    ax.grid(axis="x", alpha=0.25); ax.set_axisbelow(True)
    fig.tight_layout()
    fig.savefig(os.path.join(BENCH, "opening-overall-boxplot.png"), dpi=150)
    fig.savefig(os.path.join(BENCH, "opening-overall-boxplot.svg"))
    print(f"[overall] client TTFB={fmt(cttfb) if cttfb else '?'} infra TTFB={fmt(ittfb) if ittfb else '?'} "
          f"ratio={ratio:.3f}" if ratio else "[overall] no ratio")
    for n, v, _c, _e in plotted:
        s = stats(v); print(f"  {n}: median={fmt(s['median'])} p90={fmt(s['p90'])} n={s['n']}")


if __name__ == "__main__":
    main()
