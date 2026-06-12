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

## Target architecture

```
app shell (Explorer base)  →  capability-adaptive sidebar, one store, deep-link resolver
        │
        ├── @mzpeak/contracts  protocol + store + capability types + URL grammar (KEYSTONE — shipped)
        ├── @mzpeak/ui-kit     design tokens + presentational components
        └── @mzpeak/core       ONE Web Worker data engine (reader + scheduler + cache + compute)
```

## Status

**Phase 1 (Unified Contracts) — first version shipped.** The npm workspace and the
keystone package [`packages/contracts`](packages/contracts) are in: the superset worker
protocol + per-message clone/transfer/cancellation policy, the plain wire payload types,
the capability model (phased imaging detection + tri-state chromatogram capability), the
unified store/view-state model, and a pure URL grammar (parse / conflict-matrix resolve /
shortest-canonical serialize) with legacy `/IV/` translation. 49 tests; build, typecheck,
and tests green. See [`packages/contracts/SPEC.md`](packages/contracts/SPEC.md).

Phase 0 (reader convergence) remains the prerequisite for the *engine* phases, in flight
via [HUPO-PSI/mzpeakts#1](https://github.com/HUPO-PSI/mzpeakts/pull/1) — the contracts are
decoupled from the reader, so Phase 1 landed first. The v2 roadmap got a second
adversarial review (codex + vibe); both `reject`ed on under-specification, which the
contracts resolve — see [the synthesis](.planning/research/ADVERSARIAL-REVIEW-v2-SYNTHESIS.md).

```bash
npm install && npm test    # 49 passing
```

Source apps: `~/Claude/mzPeakIV`, `~/Claude/mzPeakExplorer`.
