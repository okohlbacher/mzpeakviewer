# Adversarial review — mzPeakViewer design handoff — 2026-06-15

## Summary

**19 consolidated findings: 3 Blocker, 9 Major, 5 Minor, 2 Info.**
Adversaries run: **internal ×3** (Feasibility, Consistency/A11y, Hallucination) **+ external
`codex` (OpenAI Codex CLI 0.137.0, read-only)** — a true multi-model pass. `vibe` (Mistral)
was attempted twice but produced no usable output (turn-limited; not counted). codex
**independently corroborated** the central theme (stale "Before", nav fidelity, a11y
spans-not-buttons, AA contrast, no-reflow, the "Material blue #1565c0" contradiction) and
added 3 verified findings (F-17 to F-19). Every codex Blocker/Major cited here was spot-checked
against the repo. **Severity note:** codex rated the stale-"Before" and a11y-artifact items
**Major**, where the internal review rated three of them **Blocker** — recorded as a severity
disagreement (§ below), resolved by keeping the internal Blocker rating since "the wireframe
demonstrates the opposite of its own a11y claims" and "drops a shipped nav tab" make those
sections unbuildable-as-written.

**Headline:** the handoff is *technically* well-grounded — correct stack (React 19 +
zustand + inline styles + `@mzpeak/ui-kit` tokens + Canvas 2D + uPlot + Web Worker), real
tokens (`--blue-600 #3b54da`, IBM Plex, `--focus-ring`, `--ink #0e1216`), real ui-kit
primitives, no invented frameworks/APIs. Its **weakness is the review value itself**: the
per-screen *Before → After* device repeatedly fabricates a degraded "Before" for behaviour
the current app **already ships**, so a team implementing it would rebuild existing
functionality. Separately, the wireframe **artifact contradicts its own accessibility
claims** (non-focusable controls), **drops a shipped nav tab**, and has **AA contrast
failures**. All three adversaries independently hit the stale-"Before" theme.

## Findings

| ID | Sev | Area | Finding | Evidence | Raised by | Verified |
|----|-----|------|---------|----------|-----------|----------|
| F-01 | Blocker | Hallucination | Imaging "Before" **inverts reality**: claims pixel-pick "routes away to Spectra, breaking spatial context" and a "blank/unframed render wait" — the app already does in-place `route=false` with a docked spectrum AND a determinate render bar (pixel count + `aria-live`). | handoff `wf-annotations.js` (Imaging before) vs `app/src/views/Imaging.tsx:114-115,188,554,639-640` (`IonRenderProgress`, `dockOpen`, `onPickSpectrum(idx,false)`) | hallucination, feasibility | yes — repo read |
| F-02 | Blocker | A11y / Consistency | Wireframe **demonstrates the opposite of its a11y claims**: flow steps, demo buttons, sidebar tabs, segmented controls, member/column rows and the drop-zone are non-focusable `<span>`/`<div onclick>` with no role/tabindex/key handlers, while §04 + per-screen notes advertise `role=button`+Enter/Space, a real `role=tablist`+roving tabindex, rows-as-buttons, and keyboard pixel-picking. | handoff `wf-screens-1.js` / `wf-screens-2.js` (spans w/ onclick) vs its own annotation text; real app does implement these (`App.tsx:181-219`, `Imaging.tsx:421-441`) | consistency | yes — artifact read |
| F-03 | Blocker | Consistency / Feasibility | **Nav fidelity broken**: the wireframe sidebar omits the shipped **Overlay** MSI tab and mis-states optical gating, yet the handoff says it "retains" the real capability-gated nav. Can't be built "as described" without diverging from the real shell. | handoff `wf-screens-1.js:144-152` vs `app/src/App.tsx:354-359` (Overview, Ion, RGB, Optical, Overlay, Grid; Optical+Overlay gated on `hasOptical`) | consistency | yes — repo read |
| F-04 | Major | Hallucination / Feasibility | Stale "Before" on **Spectra**: axes claimed "unlabelled" (real plot labels via `stageAxes("m/z","intensity")`); MS-level "hidden in a dropdown" (real UI is a `SegmentedControl`); TMT reporters "anonymous sticks" (colour-matched `ChannelPills` ship). | `app/src/views/Spectra.tsx`, ui-kit `ChannelPills` vs handoff Spectra before/after | hallucination, feasibility | yes — repo read |
| F-05 | Major | Hallucination / Feasibility | Stale "Before" on **Summary**: "detection confidence" proposed as new — Summary already renders it; metric tiles already exist. | `app/src/views/Summary.tsx:157-160` (`imaging.confidence`) vs handoff | hallucination, feasibility | yes — repo read |
| F-06 | Major | Feasibility | Stale "Before" on **Start page** (all four counts wrong): determinate `DownloadProgress`, `role=button`+keyboard drop-zone, the `.mzpeak` sub-line, the mzpeak.org/examples link, and distinct cloud/download buttons already exist. | `app/src/views/Idle.tsx:168-203,294-317` + `brief.md` corroborates | feasibility | yes — repo read |
| F-07 | Major | Feasibility | Stale "Before" on **Structure**: the manifest→`mzpeak_index.json` cross-link and the ≤50k sampled column histogram are presented as new — both already exist. | `app/src/views/Structure.tsx` | feasibility | yes — repo read |
| F-08 | Major | A11y | **Three AA contrast failures**, on meaningful UI, computed from the real token hexes: success-green `#2e9e5b` small text **3.4:1** (incl. the tag literally labelled "A11y"); gray-400 `#9aa4ad` placeholders/captions/axis labels **2.5:1**; gray-500 hint on the `#0e1216` stage **4.0:1**. (Accent/active blue, warning amber, on-stage readout all PASS.) | `_ds/tokens/colors.css` + `wf.css`; ratios vs WCAG 1.4.3 (4.5:1 normal text) | consistency | yes — computed |
| F-09 | Major | Consistency | **Token self-contradictions**: the exported DS `colors.css` header credits a "Material blue (#1565c0)" accent that appears nowhere (real accent `#3b54da`); the headline file is "Q Exactive HF Orbitrap" on Summary but framed as a QTOF-class card on Start; one m/z range shown at three precisions; a 10-colour TMT palette + inline literal hexes break the doc's own "No new color tokens" pledge. | `_ds/.../tokens/colors.css` header; `wf-screens-*.js` | consistency | yes — artifact read |
| F-10 | Major | Responsive | **No responsive story**: the product mock is a fixed ~1160px frame `transform:scale`d to fit (shrinks text, doesn't reflow); the only `@media` rules in the package are the handoff document's own chrome → WCAG 1.4.10 Reflow unaddressed, despite the brief flagging desktop-first density. | `wf.css`, `review/*.html`; brief "desktop-first" | consistency | yes — artifact read |
| F-11 | Minor | Feasibility | `ColormapScale` tagged "extend" but the Imaging legend uses a `colormapGradientCss` helper, not that primitive. | `Imaging.tsx:290,610` vs handoff component inventory | feasibility | yes |
| F-12 | Minor | Feasibility | "Percentile clip" listed as a kept control, but it's hardcoded `0.99` with no UI control. | `Imaging.tsx:284,309` | feasibility | yes |
| F-13 | Minor | Hallucination | `SpectrumDock` listed as an extendable named component — no such component exists (it's inline JSX in `Imaging.tsx`). | repo grep (no `SpectrumDock`) | hallucination, feasibility | yes |
| F-14 | Minor | Hallucination | Placeholder numbers (310 MB, 34,840 px, 71%/23%, 9/10 ±5 mDa) are disclaimed once as "illustrative" in the footer, but a few leak into body prose as if measured. | `review/*.html` footer + body | hallucination | yes |
| F-15 | Info | Feasibility | **Clean:** architecture fit is correct (no phantom CSS framework / component library); `#3b54da`, IBM Plex, `--focus-ring`, `--ink` verified exact; ui-kit "reuse" primitives all exist; the 3 "new" primitives correctly don't exist yet. | `packages/ui-kit/src/styles/tokens/colors.css`, `primitives/` | feasibility, hallucination | yes |
| F-16 | Info | Hallucination | **Mostly clean:** the background-prefetch idea is real (`prefetchIonCache` shipped in `c133e2f`), but codex flags the COPY as imprecise — "warming common m/z windows / Ion image ready · prefetched" overstates it: the prefetch warms the whole decoded-spectra cache (enables ANY m/z), it doesn't pre-warm specific windows, and it starts silently (no "ready" signal in the real worker yet). | `packages/core/src/engine/imaging.ts` `prefetchIonCache`; worker starts it silently (`engine.worker.ts`) | hallucination, codex | yes |
| F-17 | Major | DS / Deployment | **Exported design system fetches Google Fonts at runtime** — `_ds/.../tokens/fonts.css:27` does `@import url("https://fonts.googleapis.com/css2?family=IBM+Plex…")`, and the redesign HTML links it. The real app self-hosts via `@fontsource` precisely because it must work offline / on GH Pages and uploads nothing. Adopting the exported DS literally breaks that constraint (and the "nothing leaves your browser" promise). | `handoff/_ds/.../tokens/fonts.css:27` + `handoff/review/mzPeak Viewer Redesign.html:7` vs `app/src/App.tsx:18-21` (`@fontsource`) | codex | yes — grep verified |
| F-18 | Minor | Plan no-op | Plan step "add a `dot` capability variant to `Badge`" is already shipped → no-op. | `packages/ui-kit/src/primitives/Badge.tsx:6-7` (`dot?: boolean`) | codex | yes — repo read |
| F-19 | Major | Component inventory | `MetricTile` and `ChannelPills` are listed as reusable components, but both are private view-local functions, not exported ui-kit primitives (same class of error as F-13's `SpectrumDock`). | handoff component inventory vs `app/src/views/Summary.tsx:282`, `app/src/views/Spectra.tsx:377`; not in `packages/ui-kit/src/primitives/index.ts` | codex | yes — repo read |

## Adversary disagreements and how they were resolved

Strong convergence, not conflict — across **four** adversaries (3 internal + codex).
- Internal Feasibility reported **no Blockers** (architecture is sound); Consistency and
  Hallucination raised Blockers — a **different lens** (the *artifact contradicting reality
  and itself*, not the buildability of the stack). Both true at once: the stack is buildable;
  the review narrative + wireframe markup are not trustworthy as written.
- **Internal vs codex severity:** codex rated the stale-"Before" (F-01/F-04–F-07) and the
  a11y-spans-not-buttons (F-02) items **Major**; the internal review rated F-01/F-02/F-03
  **Blocker**. Resolved by checking the artifact directly (not averaging): F-02 "the wireframe
  is the *opposite* of its a11y claims" and F-03 "a shipped nav tab is dropped while claiming
  fidelity" make those sections unbuildable-as-described → kept at Blocker. The severity gap is
  cosmetic; the two models agree on the *substance* and the evidence.
- codex independently raised F-17/F-18/F-19 (Google-Fonts offline violation, Badge-dot no-op,
  MetricTile/ChannelPills not-exported); all spot-checked true against the repo.
- **vibe** (Mistral) produced no output across two attempts (turn-limited) — not counted; the
  bundled script also used a stale codex flag (`--ask-for-approval`, removed in 0.137.0), so
  codex was re-run by hand with the repo's working PROC-01 form. See `reviews/external-status.txt`.

## What was NOT reviewed (scope honesty)

- **One external adversary** (codex) ran and corroborated; **vibe did not** (turn-limited, no
  output) — so this is a 4-lens review (3 internal + codex), not the full codex+vibe pair.
- **No runtime testing** of the exported wireframes and **no pixel/visual diffing** against the
  live app — contrast was computed from token hexes, not measured on rendered pixels.
- The handoff is **mid-fi wireframes** (the chosen fidelity), so production-CSS adherence and
  real-component wiring were intentionally out of scope for the generator and for this review.

## Net recommendation

The redesign's **forward-looking ideas are usable** (the token grounding is solid and a few
genuinely new proposals exist), but **the "Before" columns must be re-baselined against the
current `app/src/views/*`** before any of it drives implementation — otherwise it will scope
rework of already-shipped features. Fix the three Blockers in the artifact (a11y markup, the
Overlay nav tab, the inverted Imaging "Before"), the AA contrast on the success/muted tiers
(F-08), and add a real reflow story (F-10). The architecture claims (F-15/F-16) need no action.
