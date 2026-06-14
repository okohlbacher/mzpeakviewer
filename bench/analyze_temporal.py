#!/usr/bin/env python3
"""Temporal analysis of S3 open times — detect network-regime changes over test order.

The benchmark JSONL is written in execution order and has no wall-clock timestamps,
so we use execution order (a monotonic proxy for time) as the x-axis. File size grows
with order (small→large), which confounds a raw trend — BUT a long mid-run stretch is
the ~47 MB MTBLS1129 set, where size is ~constant, so S3 variation there is essentially
pure network. We changepoint-detect on that constant-size band to surface the network
changes.

Outputs (to <bench>/):
  temporal-s3-all.png        S3 time vs order, colored by file size
  temporal-s3-network.png    constant-size band: S3 time vs order + segments
  TEMPORAL.md                detected segments (candidate network regimes)

Usage:  python3 bench/analyze_temporal.py [bench_dir]
"""
import json, os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BENCH = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/Claude/mzPeakViewer/design-reviews/mzpeakviewer-2026-06-12/bench")
JSONL = os.path.join(BENCH, "open-bench-results.jsonl")
BAND = (44.0, 52.0)   # the dominant constant-size cluster (~47-48 MB MTBLS1129)


def load():
    """Return s3 records in execution order: list of dicts {seq,size,ms,rel,rep,ok}."""
    s3 = []
    seq = 0  # global execution order over ALL records
    with open(JSONL) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue  # partial last line while still running
            seq += 1
            if r.get("source") == "s3":
                s3.append(dict(seq=seq, size=r.get("sizeMB"), ms=r.get("ms"),
                               rel=r.get("rel"), rep=r.get("rep"), ok=bool(r.get("ok"))))
    return s3


def sse(a):
    # L1 cost around the MEDIAN — robust to the upper-band round-trip outliers, so
    # segmentation tracks the dense network baseline rather than chasing spikes.
    a = np.asarray(a, float)
    return float(np.abs(a - np.median(a)).sum()) if len(a) else 0.0


def binseg(vals, min_len=8, min_gain=0.08, max_cuts=10):
    """Recursive binary segmentation → list of (start,end) over index range of vals."""
    cuts = []

    def rec(s, e):
        if len(cuts) >= max_cuts or (e - s) < 2 * min_len:
            return
        base = sse(vals[s:e]); best = None
        for k in range(s + min_len, e - min_len):
            cur = sse(vals[s:k]) + sse(vals[k:e])
            if best is None or cur < best[1]:
                best = (k, cur)
        if best and base > 0 and (base - best[1]) / base > min_gain:
            cuts.append(best[0]); rec(s, best[0]); rec(best[0], e)

    rec(0, len(vals))
    bounds = [0] + sorted(cuts) + [len(vals)]
    return [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1)]


def main():
    s3 = load()
    ok = [r for r in s3 if r["ok"] and r["ms"] is not None]
    print(f"[temporal] {len(s3)} s3 records, {len(ok)} ok")

    # ---- Plot 1: S3 time vs order, colored by file size ----
    xs = np.array([r["seq"] for r in ok])
    ys = np.array([r["ms"] for r in ok])
    sz = np.array([r["size"] for r in ok])
    fig, ax = plt.subplots(figsize=(11, 5))
    sc = ax.scatter(xs, ys, c=sz, cmap="viridis", norm=matplotlib.colors.LogNorm(),
                    s=18, alpha=0.8, edgecolors="white", linewidths=0.3)
    cb = fig.colorbar(sc, ax=ax); cb.set_label("file size (MB, log)")
    ax.set_xlabel("test order (S3 measurement #, ≈ time)")
    ax.set_ylabel("S3 open → first spectrum (ms)")
    ax.set_title("S3 open time over test order (color = file size)")
    ax.grid(alpha=0.25); ax.set_axisbelow(True)
    fig.tight_layout(); fig.savefig(os.path.join(BENCH, "temporal-s3-all.png"), dpi=150)

    # ---- Constant-size band → network regimes ----
    band = [r for r in ok if r["size"] is not None and BAND[0] <= r["size"] <= BAND[1]]
    band.sort(key=lambda r: r["seq"])
    bx = np.array([r["seq"] for r in band])
    by = np.array([r["ms"] for r in band])
    lines = [f"# Temporal analysis — S3 network regimes", "",
             f"Records: {len(s3)} S3 ({len(ok)} ok). x-axis = execution order (no wall-clock "
             f"timestamps in the log; order is a monotonic proxy for time).", "",
             f"**Constant-size band {BAND[0]:.0f}–{BAND[1]:.0f} MB** (the MTBLS1129 set): "
             f"{len(band)} S3 measurements where file size is ~constant, so variation is network, not size.", ""]

    if len(band) >= 20:
        segs = binseg(by)
        lines += [f"Changepoint detection (binary segmentation) found **{len(segs)} segment(s)** "
                  f"→ candidate network regimes:", "",
                  "| Segment | order range | n | median S3 (baseline) | mean | std |",
                  "|--------:|------------|--:|---------------------:|-----:|----:|"]
        seg_summ = []
        for i, (a, b) in enumerate(segs, 1):
            vals = by[a:b]
            seg_summ.append((bx[a], bx[b - 1], float(np.median(vals))))
            lines.append(f"| {i} | {bx[a]}–{bx[b-1]} | {len(vals)} | "
                         f"{np.median(vals):.0f}ms | {vals.mean():.0f}ms | {vals.std():.0f}ms |")
        # interpret shifts (on the robust baseline median)
        lines += ["", "Baseline (median) shifts between consecutive segments — candidate network changes:"]
        for i in range(1, len(seg_summ)):
            d = seg_summ[i][2] - seg_summ[i - 1][2]
            pct = 100 * d / seg_summ[i - 1][2]
            lines.append(f"- at order ~{seg_summ[i][0]}: {seg_summ[i-1][2]:.0f} → "
                         f"{seg_summ[i][2]:.0f} ms ({pct:+.0f}%)")

        # ---- Plot 2: band with segment means + changepoints ----
        fig2, ax2 = plt.subplots(figsize=(11, 5))
        ax2.scatter(bx, by, s=20, color="#c00000", alpha=0.55, edgecolors="white",
                    linewidths=0.3, zorder=3, label="S3 reps (≈47 MB files)")
        # rolling median
        if len(by) >= 7:
            k = 7
            rm = np.array([np.median(by[max(0, j - k): j + 1]) for j in range(len(by))])
            ax2.plot(bx, rm, color="#6b757e", lw=1, alpha=0.8, zorder=4, label="rolling median (7)")
        for i, (a, b) in enumerate(segs):
            ax2.hlines(np.median(by[a:b]), bx[a], bx[b - 1], color="#151a1e", lw=2.5, zorder=5)
            if i > 0:
                ax2.axvline(bx[a] - 0.5, color="#3b54da", ls="--", lw=1.2, alpha=0.8, zorder=2)
        ax2.set_xlabel("test order (S3 measurement #, ≈ time)")
        ax2.set_ylabel("S3 open → first spectrum (ms)")
        ax2.set_title(f"S3 network regimes — constant {BAND[0]:.0f}–{BAND[1]:.0f} MB band "
                      f"({len(segs)} segments; dashed = changepoint)")
        ax2.grid(alpha=0.25); ax2.set_axisbelow(True); ax2.legend(fontsize=8)
        fig2.tight_layout(); fig2.savefig(os.path.join(BENCH, "temporal-s3-network.png"), dpi=150)
        print(f"[temporal] {len(segs)} network segments in the constant-size band:")
        for i, (a, e, m) in enumerate(seg_summ, 1):
            print(f"  seg{i}: order {a}-{e}  mean={m:.0f}ms")
    else:
        lines.append("Not enough constant-size-band measurements for changepoint detection yet.")

    lines += ["", "Plots: `temporal-s3-all.png` (all S3 vs order, color=size) · "
              "`temporal-s3-network.png` (constant-size band + regimes)."]
    with open(os.path.join(BENCH, "TEMPORAL.md"), "w") as fh:
        fh.write("\n".join(lines))
    print(f"[temporal] wrote TEMPORAL.md + plots to {BENCH}")


if __name__ == "__main__":
    main()
