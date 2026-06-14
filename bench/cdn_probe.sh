#!/usr/bin/env bash
# CDN range-read latency probe — runnable from any vantage (client Mac or the StackIT
# VM) with only curl+awk (no node). For each object it issues a small Range request
# (the dominant network op an open performs is many such range reads) and records TTFB
# (time to first byte ≈ RTT + server) and total time. REPS per object; the CDN caches
# the range after rep 0, so reps 1..N are warm — analysis keeps reps ≥ 1.
#
# Usage: bash cdn_probe.sh <list.tsv> <out.csv> [reps]
#   list.tsv columns: <encoded_url>\t<sizeMB>\t<relpath>
set -u
LIST="$1"; OUT="$2"; REPS="${3:-3}"
echo "rel,mb,rep,http,ttfb_ms,total_ms" > "$OUT"
n=0
while IFS=$'\t' read -r url mb rel; do
  [ -z "${url:-}" ] && continue
  n=$((n+1))
  for r in $(seq 0 $((REPS-1))); do
    res=$(curl -s -m 40 -o /dev/null -r 0-65535 \
            -w "%{http_code} %{time_starttransfer} %{time_total}" "$url" 2>/dev/null)
    set -- $res
    code="${1:-000}"; ttfb="${2:-0}"; total="${3:-0}"
    awk -v rel="$rel" -v mb="$mb" -v r="$r" -v c="$code" -v t="$ttfb" -v tt="$total" \
      'BEGIN{printf "%s,%s,%d,%s,%.1f,%.1f\n", rel, mb, r, c, t*1000, tt*1000}' >> "$OUT"
  done
  if [ $((n % 50)) -eq 0 ]; then echo "[probe] $n files…" >&2; fi
done < "$LIST"
echo "[probe] done: $n files → $OUT" >&2
