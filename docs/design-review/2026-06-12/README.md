# Design review — mzPeak Viewer — 2026-06-12

A new overall layout was generated in Claude Design (high-fidelity prototype,
grounded in this repo) and adversarially reviewed by five reviewers — **codex**,
**vibe**, and three internal red-team passes (feasibility, consistency/a11y,
hallucination). Verdict: a strong **layout** wrapped around a throwaway **mock**
(fabricated dataset numbers, invented engine capabilities). We ported the design
and discarded the code.

## Contents
- [adversarial-review.md](./adversarial-review.md) — 29 consolidated findings (7 Blocker · 14 Major · 6 Minor · 2 Info)
- [decisions.md](./decisions.md) — Adopt / Discard / No-op / Investigate per finding
- [roadmap.md](./roadmap.md) — Waves A–C with bidirectional traceability
- [brief.md](./brief.md) — the as-sent generation prompt + wizard answers

## Shipped from this review
- **Wave A** — enriched demo cards (real fixture facts), per-view headers, ui-kit token-comment fix
- **Wave B** — persistent spectrum dock on imaging views (pixel-pick → spectrum in-place)
- **Wave C** — Summary metric tiles + TIC thumbnail, nav row icons, dark-stage contrast verified (~7.2:1, passes AA)

The raw per-adversary reports, the exported prototype handoff, and screenshots
live outside the repo (in the reviewer's local `design-reviews/` working folder),
since the handoff contains the generative tool's untrusted output.
