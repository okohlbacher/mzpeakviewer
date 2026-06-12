# mzpeak-viewer — Handoff Package

> **Start here.** This repository is the planning + handoff home for the **unified
> mzPeak viewer** — the merge of **mzPeakIV** (imaging/MSI) and **mzPeakExplorer**
> (general explorer) into one app where the imaging layer activates only for
> imaging files. A fresh checkout of this repo contains everything needed to build
> the new codebase: the roadmap, the GSD harness, the adversarial-review process,
> the validated tech stack, the source-app architecture, and both projects'
> backlogs.

**Status (2026-06-12):** Planning. No application code yet. The roadmap passed a
dual adversarial review (codex + vibe). Phase 0 (reader convergence) is in flight
via [HUPO-PSI/mzpeakts#1](https://github.com/HUPO-PSI/mzpeakts/pull/1).

---

## 1. What this is, in one paragraph

Two browser apps already share a vendored reader (`mzpeakts`), value-equal design
tokens, and a generic explorer surface. They diverged on the **data engine**
(mzPeakIV = Web Worker owning reader+compute; mzPeakExplorer = main-thread reader
+ scheduler + LRU cache) and the **vendored reader version**. The merged app keeps
the general explorer always-on and activates the imaging visualization layer only
for imaging files. The payoff is paying mzPeak's format-instability tax **once**
instead of twice. The hard part is welding the two data engines into one — which
is why the roadmap is **contracts-first**.

## 2. Read order (30-minute orientation)

1. **`HANDOFF.md`** (this file) — the map.
2. **`.planning/PROJECT.md`** — what the product is + target architecture.
3. **`.planning/ROADMAP.md`** — the 7 phases (0→6), goals + success criteria.
4. **`.planning/research/MERGE-ROADMAP.md`** — the full design + the v1→v2
   adversarial-review changelog (why the plan is shaped this way).
5. **`.planning/REQUIREMENTS.md`** — requirement IDs (RDR/CTR/KIT/ENG/NAV/URL/DEP)
   mapped to phases.
6. **`.planning/research/SOURCE-ARCHITECTURE.md`** — how the two source apps are
   built (what you're merging).
7. **`.planning/PROC-01.md`** — the adversarial-review process every phase follows.
8. **`.planning/STACK.md`** — the validated tech stack + versions + what NOT to use.
9. **`.planning/BACKLOG.md`** — consolidated backlog (merge items + both inherited).

## 3. Repository map

```
HANDOFF.md                     ← you are here
README.md                      public-facing summary
CLAUDE.md                      agent operating rules (push policy, PROC-01, stack, GSD)
tools/codex_review.sh          PROC-01 codex review harness (round1/round2)
.planning/
  PROJECT.md                   product + target architecture
  ROADMAP.md                   7 phases, goals, success criteria, dependency order
  REQUIREMENTS.md              requirement IDs → phases
  STATE.md                     GSD milestone state (status, position, next actions)
  STACK.md                     validated tech stack + versions + anti-patterns
  PROC-01.md                   adversarial-review process (codex + vibe)
  BACKLOG.md                   consolidated backlog (merge + inherited)
  config.json                  GSD configuration
  phases/00..06/PHASE.md       per-phase briefs (ready for /gsd:plan-phase NN)
  research/
    MERGE-ROADMAP.md           the synthesized v2 design (authoritative rationale)
    SOURCE-ARCHITECTURE.md     architecture maps of both source apps + reader diff
    ADVERSARIAL-REVIEW-codex-v1.md   raw codex review of the roadmap (REJECT→fixed)
    ADVERSARIAL-REVIEW-vibe-v1.md    raw vibe review of the roadmap (REJECT→fixed)
    source-backlogs/
      mzPeakIV-BACKLOG.md            verbatim copy (provenance)
      mzPeakExplorer-future-work.md  extracted future-work notes (provenance)
```

## 4. How to build it (the GSD workflow)

This project uses **GSD** (Get Stuff Done) — planning artifacts live in `.planning/`,
and each phase is planned then executed through GSD commands.

```
Phase 0  Reader convergence        (prerequisite; in flight via the numpress PR)
   │
Phase 1  Unified Contracts ◀ KEYSTONE — nothing migrates before this
   │      protocol + store + capability model + URL grammar, as types/spec/tests
   ├── Phase 2  Shared ui-kit       (tokens + presentational components)
   └── Phase 3  Engine migration    (the hard phase; one worker; parity tests)
   │
Phase 4  Unified shell + sidebar    (capability-gated nav; lazy MSI chunk; a11y)
Phase 5  URL resolver + link stability
Phase 6  Safety harness + single deploy + decommission
```

Per phase:
1. `/gsd:plan-phase NN` — generate executable plans under `.planning/phases/NN/`.
2. **PROC-01 round1** — adversarial review of the plan (`bash tools/codex_review.sh round1 NN`); operator adjudicates a non-`accept` verdict.
3. `/gsd:execute-phase NN` — implement, atomic commits.
4. **PROC-01 round2** — adversarial review of the diff (`bash tools/codex_review.sh round2 NN --sha <phase_start_sha>`); copy the verdict into the phase commit footer.

**The one rule that must not be broken:** Phase 1 (contracts) precedes any engine
or shell migration. The original plan tried to migrate the engine first and was
rejected by both reviewers for a circular dependency. See MERGE-ROADMAP.md §0.

## 5. Decision log (operator decisions on record)

| Decision | Choice | Note |
|---|---|---|
| Go/no-go on the merge | **Go** | operator, 2026-06-12 |
| Repo home | **Fresh monorepo `mzpeak-viewer`** | this repo |
| Harness method | **Scaffold GSD phases directly from v2** | (vs running /gsd:new-milestone) |
| App URL | keep **`/view/`** unified + `/IV/` redirect shim | best link stability (recommended; confirm at Phase 5/6) |
| Workspace tool | **npm workspaces** | recommended; confirm at Phase 2 |
| mzpeakts post-merge | **single git submodule** | recommended |
| UI base | **mzPeakExplorer** | broader generic surface + resolver |
| Engine base | **mzPeakIV's worker** | imaging compute needs it |

**Still open (non-blocking):** whether to move the source apps into this repo now
or after Phase 1; whether the deep-link extras (`ch=`/`roi=`/`px=`) are Phase 7 or
backlog. See MERGE-ROADMAP.md §5.

## 6. Source projects (provenance)

| | Path | Role in the merge |
|---|---|---|
| mzPeakIV | `~/Claude/mzPeakIV` | imaging engine + Web Worker; UI views: ion image, optical, overlay, grid; the file→ion-image→pixel→spectrum loop |
| mzPeakExplorer | `~/Claude/mzPeakExplorer` | UI base + deep-link resolver + scheduler/cache + SDRF/ISA study metadata; 5 tabs |
| mzpeakts (reader) | submodule / in-tree in each | vendored Parquet+Arrow+ZIP reader; converging in Phase 0 |

Architecture detail for both is in `research/SOURCE-ARCHITECTURE.md`. These repos
remain authoritative until Phase 6 decommission; **do not push merge work to either
source remote.**

## 7. Reader convergence status (Phase 0)

The two apps vendor `mzpeakts` differently: mzPeakIV pins upstream `b826397`
(aux-arrays) as a **submodule**; mzPeakExplorer carries an **in-tree** copy of
`a87abe3` + a local Numpress-Linear fix. That fix is upstreamed as
[HUPO-PSI/mzpeakts#1](https://github.com/HUPO-PSI/mzpeakts/pull/1). Phase 0
converges both to one commit (aux-arrays **and** Numpress Linear) via a single
submodule. Until merged, Phase 0 can pin the fork commit as a fallback.

## 8. Push / remote policy (HARD RULE — repeated from CLAUDE.md)

The sole authorized push target is **`github.com/okohlbacher/mzpeak-viewer`** (this
repo's `origin`). Never push to any other remote (fork/mirror/other org) without an
explicit operator "yes" naming the exact target. Source repos keep their own
single-remote policies.
