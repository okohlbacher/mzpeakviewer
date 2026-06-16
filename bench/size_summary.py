#!/usr/bin/env python3
"""Consolidated size-benchmark table + plot.

Joins the open→first-spectrum benchmark (open-bench-perfile.csv: Local + Remote-S3,
measured) with the warm CDN TTFB probes (cdn-probe-{mac,vm}.csv) to produce, per file:

  Local (measured) · S3 remote (measured) · S3 local (estimated = Remote × per-file
  vm/mac TTFB ratio) · the warm client/infra TTFB · the ratio.

Writes  <bench>/size-bench-summary.csv   (every number, one row per file)
        <bench>/size-bench-summary.png/.svg   (grouped horizontal bars, sorted by size)

Usage: python3 bench/size_summary.py [bench_dir]
"""
import csv, os, sys, statistics
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BENCH = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/Claude/mzPeakViewer/design-reviews/mzpeakviewer-2026-06-12/bench/size-bench-rechunked")
COL = {"local": "#2e9e5b", "s3local": "#c00000", "s3remote": "#3b54da"}


def warm_ttfb(path):
    """Per-file mean warm TTFB (rep>=1, http ok). Right-split: rel may contain commas."""
    by = {}
    if not os.path.exists(path):
        return by
    with open(path) as fh:
        next(fh, None)
        for line in fh:
            p = line.rstrip("\n").split(",")
            if len(p) < 6:
                continue
            rel = ",".join(p[:-5]); _mb, rep, http, ttfb, _t = p[-5:]
            try:
                if int(rep) >= 1 and http in ("200", "206"):
                    by.setdefault(rel, []).append(float(ttfb))
            except ValueError:
                continue
    return {k: statistics.mean(v) for k, v in by.items() if v}


def short_label(rel):
    """Readable per-file label: parent family + filename stem (trimmed)."""
    parts = rel.split("/")
    fam = parts[1] if len(parts) > 1 else ""
    stem = parts[-1].replace(".mzpeak", "")
    if len(stem) > 26:
        stem = stem[:24] + "…"
    return f"{stem}"


def main():
    mac = warm_ttfb(os.path.join(BENCH, "cdn-probe-mac.csv"))
    vm = warm_ttfb(os.path.join(BENCH, "cdn-probe-vm.csv"))

    rows = []
    with open(os.path.join(BENCH, "open-bench-perfile.csv")) as fh:
        for r in csv.DictReader(fh):
            rel = r["file"]
            size = float(r["sizeMB"]) if r.get("sizeMB") else None
            local = float(r["local_avg_ms"]) if r.get("local_avg_ms") else None
            remote = float(r["s3_avg_ms"]) if r.get("s3_avg_ms") else None
            mt, vt = mac.get(rel), vm.get(rel)
            ratio = (vt / mt) if (mt and vt) else None
            s3local = (remote * ratio) if (remote is not None and ratio is not None) else None
            rows.append(dict(file=rel, label=short_label(rel), sizeMB=size,
                             local_ms=local, s3local_ms=s3local, s3remote_ms=remote,
                             mac_ttfb_ms=mt, vm_ttfb_ms=vt, ttfb_ratio=ratio))
    rows.sort(key=lambda d: d["sizeMB"] or 0)

    # ---- CSV (all numbers) ----
    csv_path = os.path.join(BENCH, "size-bench-summary.csv")
    cols = ["file", "label", "sizeMB", "local_ms", "s3local_ms", "s3remote_ms",
            "mac_ttfb_ms", "vm_ttfb_ms", "ttfb_ratio"]
    with open(csv_path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for d in rows:
            w.writerow([d["file"], d["label"],
                        f"{d['sizeMB']:.1f}" if d["sizeMB"] is not None else "",
                        f"{d['local_ms']:.0f}" if d["local_ms"] is not None else "",
                        f"{d['s3local_ms']:.0f}" if d["s3local_ms"] is not None else "",
                        f"{d['s3remote_ms']:.0f}" if d["s3remote_ms"] is not None else "",
                        f"{d['mac_ttfb_ms']:.1f}" if d["mac_ttfb_ms"] is not None else "",
                        f"{d['vm_ttfb_ms']:.1f}" if d["vm_ttfb_ms"] is not None else "",
                        f"{d['ttfb_ratio']:.3f}" if d["ttfb_ratio"] is not None else ""])

    # ---- grouped horizontal bars, sorted by size (largest at top) ----
    labels = [f"{d['label']}\n{d['sizeMB']:.0f} MB" for d in rows]
    y = np.arange(len(rows))[::-1]            # largest on top
    h = 0.26
    fig, ax = plt.subplots(figsize=(11, 0.86 * len(rows) + 1.4))
    series = [("Local filesystem", "local_ms", COL["local"], +h),
              ("S3 local (est.)", "s3local_ms", COL["s3local"], 0.0),
              ("Remote S3", "s3remote_ms", COL["s3remote"], -h)]
    for name, key, c, off in series:
        vals = [d[key] if d[key] is not None else 0 for d in rows]
        bars = ax.barh(y + off, vals, height=h, color=c, alpha=0.9, label=name,
                       edgecolor="white", linewidth=0.4, zorder=3)
        for rect, v in zip(bars, vals):
            if v:
                ax.text(rect.get_width() + 40, rect.get_y() + rect.get_height() / 2,
                        f"{v/1000:.2f}s" if v >= 1000 else f"{v:.0f}ms",
                        va="center", ha="left", fontsize=7.5, color=c)
    ax.set_yticks(y)
    ax.set_yticklabels(labels, fontsize=8)
    ax.set_xlabel("Open → first spectrum (ms)")
    ax.set_xlim(0, max(d["s3remote_ms"] or 0 for d in rows) * 1.18)
    ax.set_title("mzPeakViewer open time — Local / S3-local / Remote-S3 (rechunked corpus, warm)",
                 fontsize=12)
    ax.grid(axis="x", alpha=0.25); ax.set_axisbelow(True)
    ax.legend(loc="lower right", framealpha=0.95, fontsize=9)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    fig.tight_layout()
    fig.savefig(os.path.join(BENCH, "size-bench-summary.png"), dpi=150)
    fig.savefig(os.path.join(BENCH, "size-bench-summary.svg"))

    rr = [d["ttfb_ratio"] for d in rows if d["ttfb_ratio"]]
    print(f"[summary] {len(rows)} files → size-bench-summary.csv + .png/.svg")
    print(f"[summary] median vm/mac TTFB ratio = {statistics.median(rr):.3f}" if rr else "[summary] no TTFB")
    print(f"{'file':<30}{'MB':>7}{'local':>9}{'s3local':>9}{'s3remote':>10}")
    for d in rows:
        f = lambda x: (f"{x/1000:.2f}s" if x and x >= 1000 else f"{x:.0f}ms") if x is not None else "—"
        print(f"{d['label'][:28]:<30}{d['sizeMB']:>7.0f}{f(d['local_ms']):>9}{f(d['s3local_ms']):>9}{f(d['s3remote_ms']):>10}")


if __name__ == "__main__":
    main()
