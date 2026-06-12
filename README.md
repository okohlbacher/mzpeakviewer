# mzpeak-viewer

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
        ├── @mzpeak/ui-kit   design tokens + presentational components
        └── @mzpeak/core     ONE Web Worker data engine (reader + scheduler + cache + compute)
```

## Status

No application code yet. Phase 0 (reader convergence) is the prerequisite, in
flight via [HUPO-PSI/mzpeakts#1](https://github.com/HUPO-PSI/mzpeakts/pull/1).
Source apps: `~/Claude/mzPeakIV`, `~/Claude/mzPeakExplorer`.
