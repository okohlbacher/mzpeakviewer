# Red-team review — HALLUCINATION HUNTER

Handoff: `design-reviews/mzpeakviewer-2026-06-15/handoff/review/`
Sole stated requirements: `brief.md` (no review-notes.md; Phase 2 skipped).
Repo cross-checked: `app/src/views/*.tsx`, `packages/ui-kit/src/`, `packages/core/src/`.

Verdict: the handoff is **mostly grounded in the brief**, but its core narrative device — the
per-screen **Before/After** table — repeatedly fabricates a degraded "Before" for features the
current app **already ships**, then sells the shipped behaviour back as a proposed "After." This
is the dominant defect and would mislead implementation effort. Invented APIs/tokens are minimal.
Numbers are flagged "illustrative" in the footer, which largely (not entirely) covers them.

| Severity | Area | Finding | Evidence (quote + cross-ref) |
|---|---|---|---|
| **Blocker** | Imaging "Before" — pixel-pick routing | Handoff claims the current app routes pixel-picks AWAY to Spectra, breaking spatial context; this is the headline "fix." The app already does route=false in-place. | Handoff §5 Before: *"pixel-pick that can route away to Spectra."* `wf-annotations.js:171` Before: *"picking a pixel can route away to the Spectra view, breaking the spatial context."* Repo `app/src/views/Imaging.tsx:114-115`: *"// route=false: fill the in-place spectrum dock without leaving the imaging view."* → `onPickSpectrum={(idx) => void selectSpectrum(idx, false)}`; line 640: *"Pixel-pick fills store.spectrum in-place (route=false) and shows it here."* The "before" defect does not exist. |
| **Blocker** | Imaging "Before" — docked spectrum / render bar | Handoff frames the in-place spectrum dock and a determinate render bar as new "After" work against a "blank dark stage / unframed render wait." Both already ship. | Handoff §5 Before: *"a blank dark stage; an unframed render wait."* Repo: `Imaging.tsx` imports `SpectrumPlot`, `dockOpen` state (line 141), and `IonRenderProgress` (`data-testid="ion-render-progress"`, `role="status" aria-live="polite"`, determinate `% ` + pixel count, line 727+). Already determinate and aria-live. |
| **Major** | Spectra "Before" — unlabelled axes | Handoff/annotation assert axes are unlabelled and the plot is "invisible to assistive tech." False — axes are labelled in the shipped plot. | `wf-annotations.js:114` Before: *"Axes are unlabelled; the plot is invisible to assistive tech."* Repo `packages/ui-kit/src/spectrum/SpectrumPlot.tsx:101,103,110`: `{ label: "m/z" }`, `label: "intensity"`, `axes: stageAxes("m/z", "intensity")`. |
| **Major** | Spectra "Before" — MS-level + Prev/Next + reporter pills | Handoff sells the MS-level segmented control, the "#M of N" position readout, Prev/Next, and colour-matched TMT channel pills as proposed; all four already exist. | Handoff §4 Before: *"MS-level hides in a dropdown … TMT reporters are anonymous sticks."* Repo `Spectra.tsx`: `SegmentedControl` of only present levels (lines 187-197, `MS${l}`); within-level rank "#M of N" (lines 69-80); Prev/Next buttons (lines 265-278, `aria-label="Previous/Next spectrum"`); `ChannelPills` colour-matched to peak dots (lines 6-7, 346, 377). |
| **Major** | Summary "After" — detection confidence | Handoff proposes adding "detection signals + confidence" to capabilities as if new. Summary already renders a "Detection confidence" row. | Handoff §3 After / `wf-annotations.js:81`: *"detection signals + confidence."* Repo `app/src/views/Summary.tsx:158-159`: `label="Detection confidence" value={imaging.confidence}`. |
| **Major** | A11y "Before" — keyboard pixel-picking | Cross-cutting rationale and Imaging "ready" annotation imply keyboard pixel-picking + aria-live readout is new. Already implemented. | `wf-annotations.js:161` After: *"arrow-keys move a keyboard cursor and Enter picks."* Repo `Imaging.tsx:426-435` (*"Keyboard pixel picking (a11y): arrows move a cursor cell, Enter/Space picks it"*), `onCanvasKeyDown` (585), `aria-live` readout (693). Genuinely-new content is thin; the "Before: —" dashes (annotations `shell:n4`, `imaging.rendering:n2`, `picked:n3`, `structure.footer:n3`, `column:n2`) correctly concede no prior problem, but the prose still implies novelty. |
| Minor | Component inventory — `SpectrumDock` | Listed as an `extend` of an existing component ("In-place per-pixel spectrum"), implying a named component exists. There is no `SpectrumDock` in repo; the dock is inline JSX in `Imaging.tsx` using `SpectrumPlot`. | Handoff §03 table row `SpectrumDock` / `extend`. Repo: `grep SpectrumDock` → no match; dock is `dockOpen` state + `<SpectrumPlot>` inline. MetricTile/ChannelPills correctly noted "exists in app source" (local fns in views, not ui-kit). |
| Minor | Component inventory — three "new" primitives | `RoundTripStepper`, `CapabilityBanner`, `ShareCell` are genuinely new (don't exist) and are honestly tagged `new` — not a hallucination, but note none are grounded in any brief requirement beyond the round-trip-discoverability dimension. | Repo: none exist (`grep` empty). Brief lists round-trip discoverability + capability-adaptive nav as dimensions, so the stepper/banner are defensible; `ShareCell` (parquet share bars) is a pure invention with no brief basis (Minor scope creep, not a false fact). |
| Minor | Quantitative placeholders | 310 MB, 34,840 px, 21,640, 71%/23%, #318/1684, 9/10 channels, ±5 mDa, ≤50k rows — none traceable to the brief or repo. Footer disclaims *"Numbers shown are illustrative,"* which covers the wireframes; but the open-question prose and "9/10 channels detected (±5 mDa)" read as factual within body copy. | Numbers in `wf-screens-1/2.js`, `wf-annotations.js`, Handoff §4. Handoff foot: *"Numbers shown are illustrative."* No repo source for any value. |
| Info | Lede / thesis — "users need" framing | The "central thesis" asserts a user need: *"a first-time user can open an imaging file and never realise it's possible."* This is an inferred persona claim, not in the brief — but the brief DOES name "imaging round-trip discoverability" as an improvement dimension, so it's a fair extrapolation, not a fabrication. | Handoff callout §01. Brief line 90: *"imaging round-trip discoverability."* Grounded enough to pass. |

## Categories that are CLEAN
- **Invented color tokens / palette:** none. Handoff explicitly says "No new color tokens"; `--focus-ring` (used in the a11y section) is real (`packages/ui-kit/src/styles/tokens/colors.css:122`, `0 0 0 3px rgba(59,84,218,0.28)` — a navy 3px ring, matching the "3px navy focus ring" claim). `--blue-600 #3b54da`, viridis/inferno, IBM Plex Sans/Mono all real and per-brief.
- **Invented libraries / APIs:** none material. `Button`/`Select`/`SegmentedControl`/`NumberField`/`Checkbox`/`Badge`/`StatRow`/`Panel`/`ColormapScale` all exist in `packages/ui-kit/src/primitives/`.
- **Background prefetch:** NOT a hallucination — `prefetchIonCache` is real (`packages/core/src/engine/imaging.ts:249`, "Background-prefetch the ion-image cache") and the brief wizard answer mentions it. Open Question #2 about whether it's "already wired" is honest hedging, not invention.
- **Prompt-echo:** the lede paraphrases the brief's improvement dimensions, but is labelled as the design's brief, not as independently-discovered findings — acceptable.

## Top findings (summary)
1. **The Before/After device is the core liability.** At least 6 "Before" states describe defects that
   don't exist in the shipped app — pixel-pick routing away (it's route=false), no in-place dock (ships),
   no render bar (ships, determinate + aria-live), unlabelled spectrum axes (labelled), MS-level "hidden
   in a dropdown" (it's a segmented control), TMT reporters as "anonymous sticks" (colour-matched pills
   ship), no detection confidence (ships). Implementing against these "befores" would re-build shipped work.
2. **Two Blockers** both sit on the Imaging view — the screen the brief weights most — and both invert
   reality: the redesign's marquee fixes (in-place dock, route=false, framed render) are already in
   `app/src/views/Imaging.tsx`.
3. **`SpectrumDock` is listed as an extendable component that doesn't exist** as a named component (it's
   inline JSX). MetricTile/ChannelPills are honestly flagged as "exists in app source."
4. **No invented tokens, colors, or libraries.** The design-system grounding is solid; `--focus-ring`,
   the primitives, and the prefetch engine all check out against the repo.
5. **Numbers are placeholders, disclaimed once in the footer** — acceptable for wireframes, but a few
   (9/10 channels ±5 mDa) leak into body prose as if measured.
6. **Net:** the redesign's genuinely-new value (RoundTripStepper, CapabilityBanner, capability "why"
   captions, accepted-formats link, cancellable load) is real and brief-aligned — but it is buried under
   a Before/After frame that systematically overstates the problem by denying shipped functionality.
