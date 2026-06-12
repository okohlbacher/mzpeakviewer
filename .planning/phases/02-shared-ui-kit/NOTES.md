# Phase 2 (@mzpeak/ui-kit) — build notes + review disposition

## Shipped
- Tokens: IV design-system token set (value-equal palette) + `aliases.css` (Explorer
  semantic aliases the harvested components reference) + IV imaging colormaps.
- Primitives (IV ds): Button, SegmentedControl, NumberField, Select, Checkbox, Badge,
  StatRow, ColormapScale, Panel + 11 renderToStaticMarkup parity snapshots.
- Spectrum: SpectrumPlot, ChromPlot, useUplot, chartTheme, uplotZoom, peaks (Explorer).
- Tree: TreeView (Explorer). Utils: cvTerms (+cv-terms.json), curie, format, reporters.
- `styles.css` entry: tokens + base + uPlot CSS + .mz-* components + explorer-components.
- **Style closure test**: asserts every `var()` in the bundled CSS is defined and every
  className a component emits has a rule — the self-policing parity guard.

ui-kit imports nothing from @mzpeak/contracts / reader / store (purely presentational).
typecheck clean; 19 tests (contracts 49 unaffected).

## Adversarial review (codex round2) — verdict: reject → all findings resolved
1. CRITICAL — Explorer plot/tree CSS not harvested → added `explorer-components.css`
   (.tree-*, .chart-host, .spec-tooltip). Closure test now enforces it.
2. MAJOR — "value-equal tokens" false for semantic aliases → added `aliases.css`
   (`--border-default`, `--surface-panel/-card`, `--text-heading`, `--syntax-*`,
   `--tooltip-bg`). `--text-sm` metric diff left as IV's value (documented).
3. MAJOR — `representation` is a contracts gap → added `representation?` to the wire
   `SpectrumArrays` in @mzpeak/contracts.
4. MAJOR — ChromPlot missed → harvested.
5. MAJOR — reporters.ts half-harvested → harvested (+ its test).
6. MAJOR — tests don't prove parity → added the style closure test.
7. MAJOR — Explorer extra primitives unaccounted → **DEFERRED to Phase 4** (below).
8. MINOR — uPlot CSS JS side-effect → moved into styles.css.

vibe round2 hit its 30-turn limit without a verdict (diff too broad for the budget);
re-run with a higher --max-turns next time.

## DEFERRED to Phase 4 (review #7)
Explorer's `components.tsx` has pure primitives IV's ds lacks — `PlotSpinner`, `Logo`,
`SideNav`, `TextField`, `AppHeader` — and Button/Badge VARIANTS (`quiet`, `slate`,
`muted`) absent from IV's. When the unified shell is built (Phase 4), either harvest
these pure primitives into ui-kit or map each Explorer usage to an IV ui-kit
equivalent, with compatibility tests. Tracked so no shell markup silently rewrites.
