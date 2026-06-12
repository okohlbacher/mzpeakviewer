# Source provenance

This monorepo is assembled from three upstreams. Per `research/HARMONIZATION-PLAN.md`
the two source apps are **copy-snapshots at a recorded SHA** (not subtrees); the reader
is a **git submodule**. The source repos remain authoritative (full history) until the
Phase-6 decommission.

## Vendored reader (submodule)

| Path | Repo | Pinned commit | Why |
|---|---|---|---|
| `vendor/mzpeakts` | `github.com/okohlbacher/mzpeakts` | `4067f84` (`fix/numpress-linear-decode`) | The converged "both fixes" commit: parent `b826397` = upstream `HUPO-PSI/mzpeakts` main (**auxiliary arrays**), plus the **Numpress Linear** 64-bit decode fix. One commit, both fixes — the Phase-0 fork-pin fallback. |

**Re-point on PR merge:** when [HUPO-PSI/mzpeakts#1](https://github.com/HUPO-PSI/mzpeakts/pull/1)
merges, bump the submodule to the upstream commit and (optionally) repoint the URL to
`HUPO-PSI/mzpeakts`:
```bash
cd vendor/mzpeakts && git fetch origin && git checkout <upstream-merge-sha>
cd ../.. && git add vendor/mzpeakts && git commit -m "Phase 0: re-point mzpeakts to upstream merge"
```

**Bootstrap (CI / fresh checkout):**
```bash
git submodule update --init
cd vendor/mzpeakts/lib && npm ci && npm run build   # emits dist used by file: consumers
```

## Source apps (copy-snapshots — pulled in at Step H2)

| Path | Source repo | Snapshot SHA | Subject |
|---|---|---|---|
| `apps/iv` | `github.com/okohlbacher/mzPeakIV` | `a5ec7c6` | Update vendored mzpeakts a87abe3 → b826397 (auxiliary arrays) |
| `apps/explorer` | `github.com/okohlbacher/mzPeakExplorer` | `f0723b0` | docs: touch-device spectrum zoom — research handoff |

Each app is copied excluding `.git/`, `node_modules/`, `dist/`, build artifacts, and its
**private** `vendor/mzpeakts` copy — both are repointed at the single `vendor/mzpeakts`
submodule above. To re-sync an app before decommission, diff against its source repo at
the recorded SHA (or a newer one) and re-apply.

_Last updated: 2026-06-12 (H1 — reader submodule landed; app SHAs recorded for H2)._
