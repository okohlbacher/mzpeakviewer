# mzpeakviewer

> **Planning stage** — this monorepo will host the unified [mzPeak](https://github.com/HUPO-PSI/mzPeak)
> viewer that merges **mzPeakIV** (imaging/MSI) and **mzPeakExplorer** (general
> explorer) into one app. The imaging visualization layer activates only for
> imaging files; the general explorer works for every file.

One browser app, no backend, static-deployable. It replaces the two separate apps
(`mzpeak.org/IV/` and `mzpeak.org/view/`) and ends the duplicated reader /
design-system / deploy maintenance.

## Where things are

- **Roadmap & phases:** [`.planning/ROADMAP.md`](.planning/ROADMAP.md) (7 phases, contracts-first)
- **Design + adversarial-review history:** [`.planning/research/MERGE-ROADMAP.md`](.planning/research/MERGE-ROADMAP.md)
- **Requirements:** [`.planning/REQUIREMENTS.md`](.planning/REQUIREMENTS.md)
- **Project overview:** [`.planning/PROJECT.md`](.planning/PROJECT.md)

## Repository layout

```
packages/
  contracts/   ✅ Phase 1 — wire protocol + store/view + capability model + URL grammar (KEYSTONE)
  ui-kit/      Phase 2 — design tokens + presentational components            (not yet)
  core/        Phase 3 — ONE Web Worker data engine (reader + scheduler + cache) (not yet)
apps/
  iv/          mzPeakIV, ingested — imaging viewer (transitional; removed at Phase 6)
  explorer/    mzPeakExplorer, ingested — general explorer (transitional; removed at Phase 6)
  viewer/      Phase 4 — the unified shell                                      (not yet)
vendor/
  mzpeakts/    git submodule — the one shared reader (aux-arrays + Numpress Linear)
```

## Status

**Harmonized baseline in place (Step H of `research/HARMONIZATION-PLAN.md`).** Both source
apps now live in one repo, build against **one** vendored `mzpeakts` (the converged
`okohlbacher/mzpeakts@4067f84` — aux-arrays + Numpress Linear), and are green:

| | typecheck | unit | prod build |
|---|---|---|---|
| `apps/explorer` | ✅ | ✅ 48 | ✅ (hashed wasm asset) |
| `apps/iv` | ✅ | ✅ 150 (+2 skip) | ✅ (worker + wasm) |
| `packages/contracts` | ✅ | ✅ 49 | ✅ |

**Phase 1 (Unified Contracts) shipped:** [`packages/contracts`](packages/contracts) — the
superset worker protocol + per-message clone/transfer/cancellation policy, plain wire
payload types, the capability model (phased imaging detection + tri-state chromatogram
capability), the unified store/view-state model, and a pure URL grammar with legacy `/IV/`
translation. See [`packages/contracts/SPEC.md`](packages/contracts/SPEC.md).

The two apps are unmodified product code (provenance in [`SOURCES.md`](SOURCES.md)); the
roadmap refactors *out* of them into `packages/*` behind parity gates, deleting them at
Phase 6. The v2 roadmap got a second adversarial review (codex + vibe); both `reject`ed on
under-specification, resolved in the contracts + recorded roadmap deltas — see
[the synthesis](.planning/research/ADVERSARIAL-REVIEW-v2-SYNTHESIS.md).

```bash
npm run bootstrap     # submodule init → build reader → workspace install (fresh checkout)
npm test              # contracts + both apps
npm run -w mzpeakexplorer dev      # or  -w mzpeakiv
```

Source apps: `~/Claude/mzPeakIV`, `~/Claude/mzPeakExplorer` (authoritative until Phase 6).
