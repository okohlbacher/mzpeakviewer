# Implementation roadmap — from the adversarial review

Source: [adversarial-review.md](adversarial-review.md) (4 lenses: 3 internal + codex).
Traceability: every task cites finding IDs; every accepted finding lands in exactly one bucket.

**Framing the review correctly:** the handoff was a redesign of the *existing* app, but its
per-screen *Before → After* device fabricated a degraded "Before" for behaviour already
shipped. So **most findings are NOT app bugs** — they are reasons the handoff must not be
adopted literally. Only a few findings map to real app work.

## A. DONE this session (real-app fixes harvested from the review)

| Task | Effort | Findings | Acceptance | Status |
|---|---|---|---|---|
| **Surface prefetch readiness** — worker emits `ionIndexReady` when the background warm completes; store captures it (`ionCacheReady`); Imaging ion view shows a "Ion images ready · instant" chip. Copy corrected per codex (it warms the *whole* spectra cache → any m/z is instant; it does NOT pre-warm "common m/z windows"). | S | F-16 (codex copy nit) + the redesign's one genuinely-new, valid idea | Chip is absent on open, appears after warm; verified in-browser (~37s). | ✅ committed |
| **AA contrast: `--text-faint`** — was `--gray-400` (#9aa4ad, ~2.5:1 on white), failing WCAG AA for captions/hints/footnotes. Pinned to `--gray-500` (#6b757e, ~4.7:1). Neutral chrome, not brand. | S | F-08 (partial) | `--text-faint` text ≥ 4.5:1 on white; structural closure test still green. | ✅ committed |

## B. Operator-approved + DONE (touched the design-system brand)

| Task | Effort | Findings | Acceptance | Status |
|---|---|---|---|---|
| **AA contrast: `--success` as text** — darkened `#2e9e5b` (~3.4:1) → `#1a8249` (~4.9:1 on white), still a recognizable mass-spec green. Improves the "yes" capability text, success badges, and the ion-cache-ready chip. | S | F-08 | success-as-text ≥ 4.5:1; suite green. | ✅ approved 2026-06-15, committed |
| **AA contrast: stage hint text** — the imaging EmptyState placeholder on the dark `--ink` stage used `--text-muted` (~4.0:1) → switched to `--text-on-stage` (#e7edf2, ~13:1). | S | F-08 | on-stage text ≥ 4.5:1. | ✅ approved 2026-06-15, committed |

## C. HANDOFF-ARTIFACT ONLY — do NOT change the app; reasons not to adopt the handoff literally

| Finding | Why it's not an app fix |
|---|---|
| F-17 Google-Fonts `@import` in exported `_ds/fonts.css` | The **real app already self-hosts via `@fontsource`** (App.tsx) for offline/GH-Pages/privacy. The hazard is *adopting the exported DS verbatim* — don't. |
| F-02/F-03 non-focusable spans, dropped Overlay nav tab | Defects in the *wireframe mock*; the **real app** has a real `role=tablist` + the Overlay tab (App.tsx). Nothing to fix in the app. |
| F-13/F-19 `SpectrumDock`/`MetricTile`/`ChannelPills` "components" | They're view-local functions *by design*; the handoff mislabeled them as reusable. No app change. |
| F-10 no responsive reflow | The app is intentionally desktop-first dense; the *wireframe* lacked reflow. Revisit only if mobile becomes a goal. |

## D. DISCARD — stale "Before" (proposes already-shipped features as new)

F-01 (Imaging render bar + docked in-place spectrum + keyboard picking), F-04 (Spectra axes/MS-level segmented control/TMT pills), F-05 (Summary detection confidence + metric tiles), F-06 (Start states/links/progress), F-07 (Structure manifest cross-link + sampled histogram), F-18 (Badge `dot`), F-09 partial (instrument label). **All already shipped** — verified against `app/src/views/*`. No work.

## E. Follow-ups (not from this review; previously logged)

- ✅ **E2 — LC/DDA MS0/1 spectrum prefetch** (commit `74a0075`): new `spectra_peaks` bulk
  stream + `prefetchSpectrumCache` warms the spectrum LRU with MS0/1 only (skips MS2),
  representation-routed. Verified on TMT: cached 10,305 MS1 (113 MB), skipped 21,093 MS2,
  first MS1 select 14 ms vs ~448 ms cold. Honors the original "prefetch MS0/1, never MS2" ask.
- ◻ **E1 — parallel HTTP/2 reads + `AbortSignal` true-interrupt** — BLOCKED on a cross-repo
  change: it modifies the pinned `vendor/mzpeakts` submodule (separate repo + push policy),
  and was explicitly deferred earlier. Not done; needs per-repo authorization to touch mzpeakts.
- ◻ **E3 — `Timing-Allow-Origin` on the CDN** — server/ops task on data.mzpeak.org (BunnyCDN
  pull-zone), not in this repo. Would let the app self-measure range-read timing (Resource
  Timing `nextHopProtocol`/durations are currently hidden cross-origin).

## Traceability check
- Findings with a decision: F-01–F-19 (all). Buckets: A (2), B (1: F-08 split), C (5), D (8), E (0).
- F-08 spans A (text-faint, done) + B (success, stage — operator). F-16 → A. No accepted finding is unassigned; no task cites a non-existent finding.
