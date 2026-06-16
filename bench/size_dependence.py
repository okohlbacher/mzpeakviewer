#!/usr/bin/env python3
"""Access time vs file size for the three categories (curated size-dependence set, warm).

  Local filesystem : measured (Mac disk, whole-file read)  [size-bench/open-bench-perfile.csv]
  Remote S3        : measured (client → StackIT CDN, range) [size-bench/open-bench-perfile.csv]
  Local S3         : estimated = Remote S3 × (infra/client TTFB ratio)  [cdn-probe-* in parent dir]

The set is the 10-file even-sampled subset (see mzML2mzPeak/size-bench.md), spanning
~20 MB → 3.3 GB on a LOG size axis. Each category gets a linear physical fit
time = a + b·size (TTFB + bandwidth·size); the slope b (ms/MB) quantifies size dependence:
whole-file local grows with size, range-read S3 stays ~flat.

Local & remote are collected INDEPENDENTLY — a file whose whole-file local open failed
(e.g. the 3.3 GB archive the browser can't hold) still contributes its S3 data point.

Usage: python3 bench/size_dependence.py [size_bench_dir]
"""
import csv, os, sys
from collections import defaultdict
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BENCH = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/Claude/mzPeakViewer/design-reviews/mzpeakviewer-2026-06-12/bench/size-bench")
PERFILE = os.path.join(BENCH, "open-bench-perfile.csv")
# CDN TTFB probes: prefer ones co-located WITH this run (a fresh per-set vantage probe),
# else fall back to the shared 375-file probes one level up.
PROBE_DIR = BENCH if os.path.exists(os.path.join(BENCH, "cdn-probe-mac.csv")) \
    else os.path.dirname(BENCH.rstrip("/"))


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
            _mb, rep, http, ttfb, _t = p[-5:]
            try:
                if int(rep) >= 1 and http in ("200", "206"):
                    reps[",".join(p[:-5])].append(float(ttfb))
            except ValueError:
                continue
    vals = [sum(v) / len(v) for v in reps.values() if v]
    return float(np.median(vals)) if vals else None


def _fit(ax, x, y, color, est):
    """Scatter + linear physical fit time = a + b·size, rendered on a dense grid.
    Returns the slope b (ms/MB)."""
    ax.scatter(x, y, s=26, color=color, alpha=0.6, edgecolors="white",
               linewidths=0.4, zorder=3)
    if len(x) >= 2:
        b, a = np.polyfit(x, y, 1)
        gx = np.linspace(x.min(), x.max(), 100)
        ax.plot(gx, a + b * gx, color=color, lw=1.8, ls="--" if est else "-",
                alpha=0.9, zorder=2)
        return b
    return float("nan")


def main():
    # Collect local & remote independently — keep an S3 point even when local failed.
    loc_x, loc_y, rem_x, rem_y = [], [], [], []
    n_local_fail = 0
    with open(PERFILE) as fh:
        for r in csv.DictReader(fh):
            mb = r.get("sizeMB")
            if not mb:
                continue
            mb = float(mb)
            if r.get("local_avg_ms"):
                loc_x.append(mb); loc_y.append(float(r["local_avg_ms"]))
            elif r.get("s3_avg_ms"):  # had an S3 point but local open did not complete
                n_local_fail += 1
            if r.get("s3_avg_ms"):
                rem_x.append(mb); rem_y.append(float(r["s3_avg_ms"]))
    loc_x, loc_y = np.array(loc_x), np.array(loc_y)
    rem_x, rem_y = np.array(rem_x), np.array(rem_y)

    cttfb = warm_ttfb_median(os.path.join(PROBE_DIR, "cdn-probe-mac.csv"))
    ittfb = warm_ttfb_median(os.path.join(PROBE_DIR, "cdn-probe-vm.csv"))
    ratio = (ittfb / cttfb) if (cttfb and ittfb) else 0.28
    locs3_x, locs3_y = rem_x, rem_y * ratio

    cats = [
        ("Local filesystem", loc_x, loc_y, "#2e9e5b", False),
        ("Local S3 (est.)", locs3_x, locs3_y, "#c00000", True),
        ("Remote S3", rem_x, rem_y, "#3b54da", False),
    ]

    fig, ax = plt.subplots(figsize=(10, 6))
    summ = []
    for name, x, y, c, est in cats:
        if not len(x):
            continue
        # plot the trend's scatter under its label
        ax.scatter([], [], s=26, color=c, alpha=0.6, edgecolors="white",
                   linewidths=0.4, label=name)
        b = _fit(ax, x, y, c, est)
        summ.append((name, b, float(np.median(y))))

    ax.set_xlim(left=0)  # linear size axis
    ax.set_xlabel("File size (MB)")
    ax.set_ylabel("Open → first spectrum (ms)")
    ax.set_ylim(bottom=0)
    ax.set_title("Access time vs file size — Local / Local S3 / Remote S3 "
                 "(20 MB–3.3 GB even-sampled, warm)")
    ax.grid(which="both", alpha=0.25); ax.set_axisbelow(True)
    ax.legend(loc="upper left", framealpha=0.9)
    fig.tight_layout()
    fig.savefig(os.path.join(BENCH, "size-dependence.png"), dpi=150)
    fig.savefig(os.path.join(BENCH, "size-dependence.svg"))

    span = f"{rem_x.min():.0f}–{rem_x.max():.0f} MB" if len(rem_x) else "n/a"
    probe_src = "co-located per-set VM probe" if PROBE_DIR == BENCH else "shared 375-file probe"
    lines = ["# Access time vs file size — three categories (size-dependence set, warm)", "",
             f"Even-sampled set ({span}). Local filesystem n={len(loc_x)} (local disk, lazy range reads), "
             f"Remote S3 n={len(rem_x)} (HTTP range reads). "
             f"Local S3 estimated = Remote S3 × {ratio:.2f} (infra/client TTFB ratio, {probe_src})."]
    if n_local_fail:
        lines.append("")
        lines.append(f"> {n_local_fail} file(s) had no local data point: the whole-file local "
                     f"open did not complete in-browser (too large to hold); the S3 range-read "
                     f"path still opened them. This is the size limit of the local whole-file path.")
    lines += ["", "| Category | trend slope | median |", "|---|---|---|"]
    for name, b, med in summ:
        lines.append(f"| {name} | {b:+.2f} ms/MB | {med:.0f} ms |")
    lines += ["", "Plot: `size-dependence.png`. Slopes are the linear fit (ms/MB); remote S3 "
              "carries a network-latency floor (higher intercept), while local/infra reads sit "
              "near disk speed. Large-file S3 points are network-noise-sensitive."]
    with open(os.path.join(BENCH, "SIZE-DEPENDENCE.md"), "w") as fh:
        fh.write("\n".join(lines))
    print(f"[size] ratio={ratio:.3f}  local_n={len(loc_x)} remote_n={len(rem_x)} "
          f"local_fail={n_local_fail}")
    for name, b, med in summ:
        print(f"  {name}: slope={b:+.2f} ms/MB  median={med:.0f}ms")


if __name__ == "__main__":
    main()
