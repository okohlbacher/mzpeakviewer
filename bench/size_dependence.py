#!/usr/bin/env python3
"""Access time vs file size for the three categories (clean ≤49 MB cut, warm).

  Local filesystem : measured (Mac disk)            [cut1750/open-bench-perfile.csv]
  Remote S3        : measured (client → StackIT CDN) [cut1750/open-bench-perfile.csv]
  Local S3         : estimated = Remote S3 × (infra/client TTFB ratio)  [cdn-probe-*]

Linear time axis (per request); each category gets a least-squares trend line whose
slope (ms per MB) quantifies the size dependence.

Usage: python3 bench/size_dependence.py [bench_dir]
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
            _mb, rep, http, ttfb, _t = p[-5:]
            try:
                if int(rep) >= 1 and http in ("200", "206"):
                    reps[",".join(p[:-5])].append(float(ttfb))
            except ValueError:
                continue
    vals = [sum(v) / len(v) for v in reps.values() if v]
    return float(np.median(vals)) if vals else None


def main():
    size, local, remote = [], [], []
    with open(PERFILE) as fh:
        for r in csv.DictReader(fh):
            if r.get("sizeMB") and r.get("local_avg_ms") and r.get("s3_avg_ms"):
                size.append(float(r["sizeMB"]))
                local.append(float(r["local_avg_ms"]))
                remote.append(float(r["s3_avg_ms"]))
    size = np.array(size); local = np.array(local); remote = np.array(remote)
    cttfb = warm_ttfb_median(os.path.join(BENCH, "cdn-probe-mac.csv"))
    ittfb = warm_ttfb_median(os.path.join(BENCH, "cdn-probe-vm.csv"))
    ratio = (ittfb / cttfb) if (cttfb and ittfb) else 0.28
    local_s3 = remote * ratio

    cats = [
        ("Local filesystem", local, "#2e9e5b", False),
        ("Local S3 (est.)", local_s3, "#c00000", True),
        ("Remote S3", remote, "#3b54da", False),
    ]

    fig, ax = plt.subplots(figsize=(10, 6))
    summ = []
    for name, y, c, est in cats:
        ax.scatter(size, y, s=20, color=c, alpha=0.5, edgecolors="white",
                   linewidths=0.3, label=name, zorder=3)
        # linear least-squares trend: time = a + b·size
        b, a = np.polyfit(size, y, 1)
        gx = np.linspace(size.min(), size.max(), 50)
        ax.plot(gx, a + b * gx, color=c, lw=1.8, ls="--" if est else "-", alpha=0.9, zorder=2)
        summ.append((name, b, np.median(y)))

    ax.set_xlabel("File size (MB)")
    ax.set_ylabel("Open → first spectrum (ms, linear)")
    ax.set_ylim(bottom=0)
    ax.set_title("Access time vs file size — Local filesystem / Local S3 / Remote S3 (≤49 MB, warm)")
    ax.grid(alpha=0.25); ax.set_axisbelow(True)
    ax.legend(loc="upper left", framealpha=0.9)
    fig.tight_layout()
    fig.savefig(os.path.join(BENCH, "size-dependence.png"), dpi=150)
    fig.savefig(os.path.join(BENCH, "size-dependence.svg"))

    lines = ["# Access time vs file size — three categories (≤49 MB cut, warm)", "",
             f"Files: {len(size)} (sizes {size.min():.0f}–{size.max():.0f} MB). "
             f"Local S3 estimated = Remote S3 × {ratio:.2f} (infra/client TTFB ratio).", "",
             "| Category | trend slope | median |", "|---|---|---|"]
    for name, b, med in summ:
        lines.append(f"| {name} | {b:+.1f} ms/MB | {med:.0f} ms |")
    lines += ["", "Plot: `size-dependence.png`."]
    with open(os.path.join(BENCH, "SIZE-DEPENDENCE.md"), "w") as fh:
        fh.write("\n".join(lines))
    print(f"[size] ratio={ratio:.3f}")
    for name, b, med in summ:
        print(f"  {name}: slope={b:+.1f} ms/MB  median={med:.0f}ms")


if __name__ == "__main__":
    main()
