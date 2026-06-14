# mzpeakviewer

Monorepo for the **unified mzPeak viewer** — the merge of mzPeakIV (imaging) and
mzPeakExplorer (general explorer) into one app where the imaging (MSI) layer
activates only for imaging files. See `.planning/PROJECT.md` and
`.planning/ROADMAP.md`. Full design + adversarial-review history:
`.planning/research/MERGE-ROADMAP.md`.

## Status

**Building — Phases 0–5 complete.** The app runs end-to-end in a browser and is
preview-deployed on `gh-pages` (with the legacy `/IV/` shim + demo datasets). As of
HEAD `5175c0c` (2026-06-14): **180 unit tests** (contracts 49 / core 112 / ui-kit 19)
**+ 15 Playwright e2e**, all green; `npm run typecheck` and `npm run build` clean
across all four workspaces. Phase 6 (safety harness + single deploy + decommission)
is the remaining work. The 7-phase roadmap was scaffolded 2026-06-12 from a v2 plan
that passed a dual adversarial review (codex + vibe).

## Push / Remote Policy (HARD RULE)

**The ONLY authorized push target is `github.com/okohlbacher/mzpeakviewer`** (this
repo's `origin`). Pushing there for committed work, when the operator has asked to
push, is fine. Pushing to ANY other remote/repo (a fork, a different org/user, a new
remote, a mirror) is prohibited by default — even if named or supplied; warn and
require an explicit, interactive operator "yes" for that specific push first. Before
any push, verify the resolved remote is `okohlbacher/mzpeakviewer`.

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

## Stack

Vite 8 + React 19 + TypeScript ~5.9; npm workspaces (`packages/contracts`,
`packages/ui-kit`, `packages/core`, `app`). `@mzpeak/core` (Web Worker data engine) +
`@mzpeak/ui-kit` (tokens + presentational components) + `@mzpeak/contracts` (protocol/
store/capability/URL) + the `app/` shell. Vendored `mzpeakts` (parquet-wasm +
apache-arrow + zip.js) as a git submodule (`vendor/mzpeakts`). Canvas 2D ion images;
uPlot spectra. Client-side only; static-deployable (GitHub Pages + mzpeak.org rsync).
See `.planning/STACK.md` for pinned versions.

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
