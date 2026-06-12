# Source provenance

This repo builds **one new app** by harvesting code from two existing apps. The old apps
are **external, read-only reference sources** — they are NOT vendored, copied, or hosted
here, and they are never modified. Only two things are pulled in: the shared **reader**
(as a submodule) and, phase by phase, specific **code** harvested into `packages/*` and
the single `app/`.

## Vendored reader (submodule — the one piece both old apps and the new app share)

| Path | Repo | Pinned commit | Why |
|---|---|---|---|
| `vendor/mzpeakts` | `github.com/okohlbacher/mzpeakts` | `4067f84` (`fix/numpress-linear-decode`) | The converged "both fixes" commit: parent `b826397` = upstream `HUPO-PSI/mzpeakts` main (**auxiliary arrays**), plus the **Numpress Linear** 64-bit decode fix. One commit, both fixes — the Phase-0 fork-pin fallback. |

**Re-point on PR merge:** when [HUPO-PSI/mzpeakts#1](https://github.com/HUPO-PSI/mzpeakts/pull/1)
merges, bump the submodule to the upstream commit:
```bash
cd vendor/mzpeakts && git fetch origin && git checkout <upstream-merge-sha>
cd ../.. && git add vendor/mzpeakts && git commit -m "Phase 0: re-point mzpeakts to upstream merge"
```

**Bootstrap (`npm run bootstrap`):** `git submodule update --init` → build the reader
(`cd vendor/mzpeakts/lib && npm ci && npm run build`) → `npm install`.

## Reference sources (external — harvested from, never hosted)

| Source repo | Local checkout | Reference SHA | Role |
|---|---|---|---|
| `github.com/okohlbacher/mzPeakIV` | `~/Claude/mzPeakIV` | `a5ec7c6` | imaging viewer — the source of imaging compute, the worker engine, ion-image/optical/grid UI |
| `github.com/okohlbacher/mzPeakExplorer` | `~/Claude/mzPeakExplorer` | `f0723b0` | general explorer — the source of the shell, deep-link resolver, scheduler/cache, SDRF/ISA, structure inspector |

When a phase harvests code, record the source file(s) + the reference SHA in that phase's
notes so the lineage is auditable. The old apps stay deployed (`mzpeak.org/IV`, `/view`)
and serve as the **parity oracle**: golden outputs are captured from them (and from the
live deploys) into fixtures the new app's tests check against — the old apps are not built
inside this repo.

## Validated finding (Phase 0 de-risk, 2026-06-12)

Both old codebases compiled and passed their unit suites against this single converged
reader (`4067f84`) — confirming aux-arrays + Numpress Linear coexist with no local
patches. (Done as a throwaway check from temporary copies, since removed; the finding
stands, the copies do not.)

_Last updated: 2026-06-12._
