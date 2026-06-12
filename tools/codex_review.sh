#!/usr/bin/env bash
#
# PROC-01 Codex review harness for mzPeakIV.
#
# Usage:
#   tools/codex_review.sh round1 <phase> [--dry-run]
#       Adversarial read of the phase PLAN bundle
#       (.planning/phases/<phase>-*/*-PLAN.md).
#
#   tools/codex_review.sh round2 <phase> --sha <phase_start_sha> [--dry-run]
#       Adversarial read of the phase DIFF since <phase_start_sha>.
#
# Behaviour:
#   - Invokes the `codex` CLI at /opt/homebrew/bin/codex (override with $CODEX_BIN).
#   - Writes full output to
#       .planning/phases/<phase>-*/<phase>-CODEX-ROUND{1,2}.log   (gitignored)
#   - Prints the verdict line (accept / accept-with-revisions / reject) to stdout.
#   - With --dry-run, prints the command it WOULD run and exits 0 (no live call),
#     so CI / verification needs no real codex invocation.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_BIN="${CODEX_BIN:-/opt/homebrew/bin/codex}"

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-2}"
}

[ "$#" -lt 2 ] && usage 2

ROUND="$1"; shift
PHASE="$1"; shift

SHA=""
DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --sha) SHA="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown argument: $1" >&2; usage 2 ;;
  esac
done

# Resolve the phase directory (e.g. 01 -> .planning/phases/01-reader-...).
PHASE_DIR="$(find "$ROOT/.planning/phases" -maxdepth 1 -type d -name "${PHASE}-*" | head -n1)"
if [ -z "$PHASE_DIR" ]; then
  echo "ERROR: no phase directory matching '${PHASE}-*' under .planning/phases" >&2
  exit 1
fi

build_prompt() {
  case "$ROUND" in
    round1)
      cat <<EOF
You are an adversarial reviewer for HUPO-PSI mzPeakIV phase ${PHASE}.
Read the phase PLAN bundle below and find concrete defects: missing acceptance
criteria, unsafe assumptions, scope creep, version/compat hazards, and anything
that would make the plan fail to deliver its stated capability.

End your review with EXACTLY ONE verdict line of the form:
  verdict: accept
  verdict: accept-with-revisions
  verdict: reject

--- PLAN BUNDLE (${PHASE}) ---
EOF
      cat "$PHASE_DIR"/*-PLAN.md
      ;;
    round2)
      if [ -z "$SHA" ]; then
        echo "ERROR: round2 requires --sha <phase_start_sha>" >&2
        exit 1
      fi
      cat <<EOF
You are an adversarial reviewer for HUPO-PSI mzPeakIV phase ${PHASE}.
Read the DIFF below (phase changes since ${SHA}) against the phase plan and find
concrete defects: deviations from plan, unhandled errors, security/supply-chain
risks, and acceptance criteria that the diff does not actually satisfy.

End your review with EXACTLY ONE verdict line of the form:
  verdict: accept
  verdict: accept-with-revisions
  verdict: reject

--- DIFF (${PHASE} since ${SHA}) ---
EOF
      DIFF="$(cd "$ROOT" && git diff "${SHA}" -- . ':(exclude)vendor')"
      if [ -z "$DIFF" ]; then
        echo "ERROR: diff from ${SHA} is empty — ensure phase work is committed before running round2" >&2
        exit 1
      fi
      printf '%s\n' "$DIFF"
      ;;
    *)
      echo "ERROR: round must be 'round1' or 'round2', got '$ROUND'" >&2
      usage 2
      ;;
  esac
}

case "$ROUND" in
  round1) LOG="$PHASE_DIR/${PHASE}-CODEX-ROUND1.log" ;;
  round2) LOG="$PHASE_DIR/${PHASE}-CODEX-ROUND2.log" ;;
  *) echo "ERROR: unknown round '$ROUND'" >&2; usage 2 ;;
esac

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] round   = $ROUND"
  echo "[dry-run] phase   = $PHASE ($PHASE_DIR)"
  [ -n "$SHA" ] && echo "[dry-run] sha     = $SHA"
  echo "[dry-run] log     = $LOG"
  echo "[dry-run] would run: $CODEX_BIN exec <prompt-on-stdin>"
  echo "[dry-run] prompt preview:"
  build_prompt | head -n 12
  exit 0
fi

if [ ! -x "$CODEX_BIN" ]; then
  echo "ERROR: codex CLI not found/executable at '$CODEX_BIN' (set \$CODEX_BIN)" >&2
  exit 1
fi

echo "[codex] running $ROUND for phase $PHASE -> $LOG" >&2
build_prompt | "$CODEX_BIN" exec - | tee "$LOG"

# Surface the verdict line for the operator / phase commit footer.
VERDICT="$(grep -iE '^verdict:' "$LOG" | tail -n1 | sed -E 's/^verdict:[[:space:]]*//I' || true)"
if [ -n "$VERDICT" ]; then
  echo "$VERDICT"
else
  echo "WARNING: no 'verdict:' line found in codex output ($LOG)" >&2
  exit 3
fi
