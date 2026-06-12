# Harmonization plan — building ONE new app by harvesting from two old ones

**Date:** 2026-06-12 · **Revised:** 2026-06-12 (operator correction — see §0) · **Status:** active
**Reference sources (external, read-only):** `~/Claude/mzPeakIV` (imaging, ~14.4k LOC) +
`~/Claude/mzPeakExplorer` (general explorer, ~9.1k LOC). **Target:** this repo, ONE new app.
**Reads against:** `MERGE-ROADMAP.md`, `SOURCE-ARCHITECTURE.md`,
`ADVERSARIAL-REVIEW-v2-SYNTHESIS.md`, `SOURCES.md`.

## 0. The model (corrected)

We are building **one new app**. The two old apps (mzPeakIV, mzPeakExplorer) are **external,
read-only reference repos we harvest code from** — they are never modified, and they are
**not hosted, copied, or built inside this repo**. They stay deployed (`mzpeak.org/IV`,
`/view`) and act as the **parity oracle**: golden outputs are *captured from them* into
fixtures the new app's tests check against. The only thing physically vendored here is the
shared **reader** (`vendor/mzpeakts`, a submodule). Everything else arrives as **specific
code harvested phase by phase** into `packages/*` and the single `app/`.

> A first attempt copied both whole apps into `apps/iv` + `apps/explorer` as in-repo
> "parity oracles" (a literal reading of the roadmap's "both source apps … e2e green"
> wording). That was an over-build — the old apps are reference-only. Those copies were
> removed; this plan reflects the one-app model and the roadmap parity gates are realigned
> to captured fixtures (§4, and ROADMAP.md Phase 2/3).

## 1. What is genuinely shared, and where each piece goes (grounded, verified)

Verified against the live source trees:

| Layer | Shared? | Evidence | Lands in |
|---|---|---|---|
| **`mzpeakts` reader** | **Yes — the one vendored thing.** | both old apps use it; only commit/consumption differed | `vendor/mzpeakts` submodule ✅ (`4067f84`, both fixes) |
| **`@mzpeak/contracts`** | new, already built | shipped `d63ccd0` | `packages/contracts` ✅ |
| **Design tokens** | **harvest once — value-equal.** grays, `--blue-600 #3b54da`, reds byte-identical; IV only *adds* `--ink`/`--sentinel`/colormaps | `colors.css` diff | `packages/ui-kit` (Phase 2) |
| **Pure presentational components** | **harvest — zero store coupling (verified grep).** IV `src/ui/ds/*`; Explorer `SpectrumPlot`/`useUplot`/`chartTheme`/`uplotZoom`, `TreeView`, `components.tsx` primitives, `cvTerms`/`curie`/`format` → 0 store refs | grep this session | `packages/ui-kit` (Phase 2) |
| **`src/reader/*` adapter code** | **No — app-specific.** IV `stats`/`probeIsImaging`/`imaging`; Explorer `browse`/`archive`/`parquetDeep`/`summary`/`sampleMeta` | tree maps | harvested **into** `packages/core` (Phase 3) |
| **Data engine** | **No — divergent (long pole).** IV worker vs Explorer main-thread+scheduler+cache | §C | `packages/core`, ONE worker (Phase 3) |
| **Tab/panel containers** | **No — store-bound; rebuilt.** SpectraTab 19 store refs, etc. | grep | the new `app/` shell (Phase 4) |

**Consequence:** the shared core is small and low-risk (reader + tokens + pure components +
contracts). The hard parts (reader adapters, engine, containers) are **rewritten in the new
app**, harvesting logic from the old apps, gated by parity against captured fixtures.

## 2. Target layout

```
mzpeakviewer/
  packages/
    contracts/   ✅ Phase 1 — protocol, store/view, capability model, URL grammar
    ui-kit/      Phase 2 — unified tokens + harvested pure components
    core/        Phase 3 — ONE Web Worker engine (owns mzpeakts + scheduler + cache)
  app/           Phase 4 — THE one app (shell + capability sidebar + lazy MSI chunk)
  vendor/
    mzpeakts/    submodule — the one shared reader
```

No `apps/iv`, no `apps/explorer`. One app.

## 3. Harvest mechanics

- **Reader:** submodule (done). Re-point to upstream when `mzpeakts#1` merges.
- **Code:** when a phase needs a module, copy the specific file(s) from the read-only
  source checkout into `packages/*` or `app/`, refactor to the contracts, and **record the
  source path + reference SHA** in the phase notes (lineage stays auditable; see `SOURCES.md`).
  No whole-app copies; no subtree.
- **Parity oracle:** capture golden outputs from the old apps (their unit fixtures + the
  live `mzpeak.org/IV` and `/view` deploys) into fixtures under the new app's tests. The new
  module must match the captured output. The old apps are the reference, not an in-repo build.

## 4. Phase-by-phase (each harvests specific code into the one app)

### Phase 0 — reader (done as H1)
One `vendor/mzpeakts` submodule, both fixes. ✅

### Phase 1 — contracts (done)
`@mzpeak/contracts`. ✅

### Phase 2 — `packages/ui-kit`
- **Tokens:** create the unified set = Explorer base tokens **+** IV's imaging additions
  (`--ink`, `--sentinel`, `colormaps.css`). Value-equal → superset, not reconciliation.
- **Components (verified pure):** harvest `SpectrumPlot`+`useUplot`+`chartTheme`+`uplotZoom`,
  `TreeView`, the `components.tsx` primitives + IV `ds/*`, `cvTerms`/`curie`/`format`.
- **Parity:** snapshot/visual tests in ui-kit; a captured-render fixture per component matches
  the old apps' output. (No "both old apps consume ui-kit" — they're external.)
- **Risk: low.**

### Phase 3 — `packages/core` (the long pole, HIGH risk)
- IV's worker as the base; harvest IN Explorer's data access as worker handlers implementing
  `@mzpeak/contracts` `MESSAGE_POLICY` (`archiveList`/`parquetFooter`/`deepColumn`/
  `sampleColumn` — the Structure path: reconstruct the reader-keyed `WeakMap` cache + dynamic
  `hyparquet` **inside** the worker; `scanBreakdown`, `extractChrom`, `studyMeta`); port
  Explorer's `readScheduler` + LRU cache into the worker; merge IV's imaging handlers.
- **Pre-req spike (review delta E):** a Structure/Parquet workerization spike + parity
  fixtures before the general migration.
- **Parity (realigned):** golden-output fixtures captured from the OLD apps (imaging + LC) —
  the new engine's output must match them; imaging+LC e2e on the new app; the
  file→ion-image→spectrum invariant. Cancellation/perf smoke tests land here.
- **Risk: HIGH.**

### Phase 4 — `app/` (the one shell)
- New shell (modeled on Explorer's `App.tsx`); capability-adaptive sidebar off `CapabilityModel`;
  Advanced accordion (Metadata+Structure); MSI accordion (`isImaging`-gated, **lazy chunk**
  harvesting IV's `ImagingPanel`/`OpticalPanel`/`GridDiagnosticsPanel`/`tiff`); merged into the
  contracts' `UnifiedState`; pixel→spectrum + ROI→spectrum; a11y; detection-override UI.
- **Risk: medium.**

### Phase 5 — URL resolver
- Wire `packages/contracts/url` into `app/`; publish the legacy shims via `LEGACY_PATH_MAP`
  (`/IV/`→`/view/` mzpeak.org; `/mzPeakIV/`→`/mzpeakviewer/` GitHub Pages); old-link corpus +
  query-preservation tests. **Risk: medium.**

### Phase 6 — single deploy + decommission
- Safety harness + rollback canary; one CI; one deploy (`app/` at `/view/`, `/IV/` shim);
  consolidated fixtures. **Decommission** = redirect/retire the old `mzpeak.org/IV` + `/view`
  deploys (the source repos stay as archives). **Risk: low–medium.**

**Order:** 0 → 1 → {2, 3} → 4 → 5 → 6.

## 5. Reconciliation list (what must be *harmonized*, not just copied)

1. Reader vendoring → ONE submodule ✅. 2. Reader type delta (`DataArrays`) → one surface
(in the reader; ✅ via `4067f84`). 3. Tokens → value-equal superset (Phase 2). 4. Detection →
contracts' phased `ImagingDetection`, replacing Explorer's 1-signal (Phase 3/4). 5. `scan`
semantics → provenance-tagged selector + legacy `scan=N→spectrum=N-1` (✅ in `url/legacy.ts`).
6. e2e → build it for the new app (the old apps' e2e isn't reused in-repo). 7. Deploy base →
unified `VITE_BASE` per target; both redirect roots (Phase 5/6). 8. `hasTicColumn` → tri-state
(✅ contracts).

## 6. Decisions (resolved)

- **Old-app code in the repo:** removed; old apps are external read-only sources, harvested
  per phase. *(operator, 2026-06-12)*
- **Parity gates:** captured golden fixtures from the old apps + live deploys, not in-repo
  app builds. *(operator, 2026-06-12 — ROADMAP.md Phase 2/3 realigned accordingly)*

## 7. Review alignment

codex #1 (workspace) ✅; codex #3 / vibe CRITICAL-1 (Structure/Parquet) → Phase-3 spike +
captured fixtures; codex #6 / vibe MAJOR-2 (ui-kit purity) → harvest only verified
zero-store-ref files; codex #5 (Phase 0 critical) → reader is the foundation, fork-pin named;
review delta (harness late) → smoke tests move into Phases 3/5.
