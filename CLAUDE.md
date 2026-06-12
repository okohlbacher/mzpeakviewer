# mzpeak-viewer

Monorepo for the **unified mzPeak viewer** — the merge of mzPeakIV (imaging) and
mzPeakExplorer (general explorer) into one app where the imaging (MSI) layer
activates only for imaging files. See `.planning/PROJECT.md` and
`.planning/ROADMAP.md`. Full design + adversarial-review history:
`.planning/research/MERGE-ROADMAP.md`.

## Status

Planning. Repo skeleton + GSD milestone scaffolded 2026-06-12 from a v2 roadmap
that passed a dual adversarial review (codex + vibe). No application code yet.

## Push / Remote Policy (HARD RULE)

**This repo has NO authorized remote yet.** Do NOT add a git remote, push, or
create a hosted repository for `mzpeak-viewer` without an explicit, interactive
operator "yes" in chat naming the exact target. If/when the operator creates
`github.com/okohlbacher/mzpeak-viewer`, that becomes the sole authorized push
target (same discipline as the source repos: never push to a fork/mirror/other
remote). Until then, all work is local-only.

The source repos retain their own policies: mzPeakIV → only `okohlbacher/mzPeakIV`;
mzPeakExplorer → only `okohlbacher/mzPeakExplorer`. Do not push merge work to
either source repo's remote.

## PROC-01 — Codex adversarial review (every phase)

Each phase NN is bracketed by an external Codex CLI review:

```bash
bash tools/codex_review.sh round1 NN                          # adversarial read of the phase PLAN
bash tools/codex_review.sh round2 NN --sha <phase_start_sha>  # adversarial read of the phase DIFF
```

Copy the verdict line (`accept` / `accept-with-revisions` / `reject`) into the
phase commit footer. `codex` is at `/opt/homebrew/bin/codex`; `vibe` at
`~/.local/bin/vibe` for second-opinion reviews.

## Stack (target)

Vite 8 + React 19 + TypeScript ~5.9; npm workspaces; `@mzpeak/core` (Web Worker
data engine) + `@mzpeak/ui-kit` (tokens + presentational components) + app shell.
Vendored `mzpeakts` (parquet-wasm + apache-arrow + zip.js) as a git submodule.
Canvas 2D ion images; uPlot spectra. Client-side only; static-deployable
(GitHub Pages + mzpeak.org rsync).

## GSD

This project uses GSD. ROADMAP.md defines 7 phases (0–6); run `/gsd:plan-phase NN`
to generate executable plans for a phase, then `/gsd:execute-phase NN`. Phase 1
(Unified Contracts) is the keystone — nothing migrates before it.

## Format reference (mzPeak)

mzPeak = uncompressed ZIP of Apache Parquet files + `mzpeak_index.json`. Spec:
https://github.com/HUPO-PSI/mzPeak. Explicitly unstable — version-detect, fail
loud, degrade gracefully. Imaging convention: one spectrum per pixel; coords from
promoted `IMS_1000050_position_x` / `IMS_1000051_position_y` columns; imaging
detection via `probeIsImaging` (3 signals: promoted IMS columns OR CV params OR
`metadata.imaging.is_imaging`).
