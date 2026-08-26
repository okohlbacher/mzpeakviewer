# Adversarial PONYTAIL (over-engineering) + UI-QUALITY review — mzpeakviewer @ 3f139f7

Two-part review. Scope: `app/src`, `packages/core/src`, `packages/contracts/src`,
`packages/ui-kit/src`. Not vendor/, dist/, node_modules/.

## Part 1 — PONYTAIL AUDIT (the lazy-senior-dev lens)
Hunt over-engineering and bloat. The best code is the code never written. Rank a list of
what to DELETE, SIMPLIFY, or replace with stdlib/platform features:
- speculative abstractions (interfaces with one impl, config for constants, dead flags)
- dead code / unused exports / unreachable branches / vestigial fields
- duplicated logic that should be one function (across app<->core<->ui-kit)
- hand-rolled code a platform API covers
- over-defensive guards for impossible states (vs boundary validation, which must stay)
- premature perf machinery with no measured need
DO NOT flag: input validation at trust boundaries, error handling preventing data loss,
accessibility, the deliberate `ponytail:` marked shortcuts.
For each item: file:line, what to delete/simplify, estimated LOC saved, risk.

## Part 2 — UI QUALITY (code-level assessment)
Assess app/src/views/*.tsx + packages/ui-kit/src for:
- consistency: spacing/typography/color tokens vs hardcoded values; component reuse vs
  copy-pasted style objects (count the inline style duplication — is a styled primitive
  warranted by the ladder, or is inline fine?)
- a11y: focus management, aria patterns, keyboard reach of every interactive control,
  color-only signaling
- state/UX correctness: loading/empty/error states for EVERY async view, layout shift,
  scroll containment, dark-mode/token discipline
- error surfaces: are failures visible+actionable or silent?
Rank issues; separate "polish" from "real usability defects"; cite file:line.

## Contract
- file:line for every claim. Severity + would-a-user-notice.
- "fine" in one line where fine. REVIEW ONLY — do not modify any file.
