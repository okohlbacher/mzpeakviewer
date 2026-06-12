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

We are building **one new app**. The two old apps are external, read-only repos we harvest
code from (see [`SOURCES.md`](SOURCES.md)) — never hosted or built here.

```
packages/
  contracts/   ✅ Phase 1 — wire protocol + store/view + capability model + URL grammar (KEYSTONE)
  ui-kit/      Phase 2 — unified tokens + harvested pure components             (not yet)
  core/        Phase 3 — ONE Web Worker data engine (reader + scheduler + cache) (not yet)
app/           Phase 4 — THE one app (shell + capability sidebar + lazy MSI chunk) (not yet)
vendor/
  mzpeakts/    git submodule — the one shared reader (aux-arrays + Numpress Linear)
```

## Status

**Shared core in place.** The two genuinely-shared foundations exist:

| | what | state |
|---|---|---|
| `vendor/mzpeakts` | the one reader — `okohlbacher/mzpeakts@4067f84` (aux-arrays + Numpress Linear in one commit) | submodule pinned ✅ |
| `packages/contracts` | wire protocol + per-message policy, wire types, capability model, unified store/view, URL grammar | shipped ✅ (49 tests) |

**Phase 1 (Unified Contracts):** [`packages/contracts`](packages/contracts) — see
[`packages/contracts/SPEC.md`](packages/contracts/SPEC.md). The v2 roadmap got a second
adversarial review (codex + vibe); both `reject`ed on under-specification, resolved in the
contracts + recorded roadmap deltas — see
[the synthesis](.planning/research/ADVERSARIAL-REVIEW-v2-SYNTHESIS.md).

The new app is built **phase by phase**, harvesting specific code from the (untouched) old
repos into `packages/*` and `app/`; parity is checked against golden fixtures captured from
the old apps + their live deploys, not by hosting them here. Strategy:
[`research/HARMONIZATION-PLAN.md`](.planning/research/HARMONIZATION-PLAN.md).

```bash
npm run bootstrap     # submodule init → build reader → install (fresh checkout)
npm test              # contracts (the only built workspace member today)
```

Reference sources (read-only): `~/Claude/mzPeakIV`, `~/Claude/mzPeakExplorer`.
