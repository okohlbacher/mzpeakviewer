# mzpeakviewer

> The unified [mzPeak](https://github.com/HUPO-PSI/mzPeak) viewer that merges
> **mzPeakIV** (imaging/MSI) and **mzPeakExplorer** (general explorer) into one app.
> The imaging visualization layer activates only for imaging files; the general
> explorer works for every file. **Phases 0–5 are complete and the app runs
> end-to-end in the browser** (preview-deployed on `gh-pages`); Phase 6 (single
> deploy + decommission) remains.

One browser app, no backend, static-deployable. It replaces the two separate apps
(`mzpeak.org/IV/` and `mzpeak.org/view/`) and ends the duplicated reader /
design-system / deploy maintenance.

## Where things are

- **Roadmap & phases:** [`.planning/ROADMAP.md`](.planning/ROADMAP.md) (7 phases, contracts-first)
- **Design + adversarial-review history:** [`.planning/research/MERGE-ROADMAP.md`](.planning/research/MERGE-ROADMAP.md)
- **Requirements:** [`.planning/REQUIREMENTS.md`](.planning/REQUIREMENTS.md)
- **Project overview:** [`.planning/PROJECT.md`](.planning/PROJECT.md)

## Repository layout

We are building **one new app**. The two old apps are external, read-only repos we harvest
code from (see [`SOURCES.md`](SOURCES.md)) — never hosted or built here.

```
packages/
  contracts/   ✅ Phase 1 — wire protocol + store/view + capability model + URL grammar (KEYSTONE)
  ui-kit/      ✅ Phase 2 — unified tokens + harvested pure components
  core/        ✅ Phase 3 — ONE Web Worker data engine (reader + scheduler + cache)
app/           ✅ Phase 4/5 — THE one app (shell + capability sidebar + lazy MSI chunk + URL resolver)
vendor/
  mzpeakts/    git submodule — the one shared reader (aux-arrays + Numpress Linear)
```

## Status

**Building — Phases 0–5 complete; the app runs end-to-end in a browser.** As of HEAD
`5175c0c` (2026-06-14): **180 unit tests + 15 Playwright e2e, all green**;
`npm run typecheck` and `npm run build` clean across all four workspaces.

| | what | state |
|---|---|---|
| `vendor/mzpeakts` | the one reader — `okohlbacher/mzpeakts@4067f84` (aux-arrays + Numpress Linear in one commit) | submodule pinned ✅ |
| `packages/contracts` | wire protocol + per-message policy, wire types, capability model, unified store/view, URL grammar | Phase 1 ✅ (49 tests) |
| `packages/ui-kit` | unified tokens + purely presentational components (uPlot spectra, tree, reporters) | Phase 2 ✅ (19 tests) |
| `packages/core` | ONE Web Worker engine — reader I/O, adapters, scheduler, `EngineClient` ↔ worker; value-parity vs old readers | Phase 3 ✅ (112 tests) |
| `app/` | the unified shell — capability-gated sidebar, lazy MSI views, URL resolver / deep links, `/IV/` legacy shim | Phase 4/5 ✅ (15 e2e) |

**Remaining — Phase 6:** safety/perf/memory harness + rollback canary, collapse to one
deploy, redirect old paths, decommission the source apps.

The app was built **phase by phase**, harvesting specific code from the (untouched) old
repos into `packages/*` and `app/`; parity is checked against golden fixtures captured from
the old apps + their live deploys, not by hosting them here. Strategy:
[`research/HARMONIZATION-PLAN.md`](.planning/research/HARMONIZATION-PLAN.md). The v2 roadmap
got a second adversarial review (codex + vibe); both `reject`ed on under-specification,
resolved in the contracts + recorded roadmap deltas — see
[the synthesis](.planning/research/ADVERSARIAL-REVIEW-v2-SYNTHESIS.md).

```bash
npm run bootstrap     # submodule init → build reader → install (fresh checkout)
npm test              # all workspaces — contracts + ui-kit + core (180 unit tests)
npm run typecheck     # all four workspaces
npm --workspace @mzpeak/app run dev      # run the app locally (Vite)
npm --workspace @mzpeak/app run e2e      # Playwright e2e (smokes a built dist)
```

Reference sources (read-only): `~/Claude/mzPeakIV`, `~/Claude/mzPeakExplorer`.
