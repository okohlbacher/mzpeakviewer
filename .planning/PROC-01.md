# PROC-01 — Adversarial review process

Every phase of this project is **bracketed by an external adversarial review**.
This is an operator mandate carried from both source projects. It exists because
mzPeak is format-unstable and the merge is high-stakes (one bug can break two
audiences): an independent skeptic catches plausible-but-wrong plans and diffs
before they land.

Two tools are used: **codex** (`/opt/homebrew/bin/codex`) and **vibe**
(`~/.local/bin/vibe`). Both run read-only and produce a verdict line.

---

## 1. The per-phase bracket (round1 / round2)

For each phase `NN`:

```bash
# BEFORE execution — adversarial read of the phase PLAN
bash tools/codex_review.sh round1 NN

# AFTER execution — adversarial read of the phase DIFF
bash tools/codex_review.sh round2 NN --sha <phase_start_sha>
```

- The script invokes the `codex` CLI; per-phase logs land under
  `.planning/phases/NN/NN-CODEX-ROUND{1,2}.log` (gitignored).
- Copy the **verdict line** (`accept` / `accept-with-revisions` / `reject`) into the
  phase commit footer.
- The operator adjudicates any non-`accept` verdict; **escalate on `reject` or a
  substantive `accept-with-revisions`** — do not self-clear a rejection.

## 2. Major-design dual review (codex + vibe in parallel)

For milestone-level or architecture-level artifacts (like the merge roadmap
itself), run **both** reviewers in parallel and synthesize. This is the pattern that
produced this repo — both REJECTED v1; the consensus drove v2. Raw outputs are
preserved in `research/ADVERSARIAL-REVIEW-{codex,vibe}-v1.md` as a worked example.

```bash
# codex (read-only, full disk read)
codex exec --skip-git-repo-check -c 'sandbox_permissions=["disk-full-read-access"]' "<prompt>"

# vibe (read-only, bounded)
vibe -p "<prompt>" --agent auto-approve --max-turns 30 --max-price 1.50 --output text
```

Run them as background tasks and synthesize when both land. **Convergent findings
are high-signal; divergent ones need judgment.**

## 3. Writing an effective adversarial prompt

What made the roadmap review work (reuse this shape):

1. **Give the reviewer the artifact path AND repo access** so it verifies claims
   against real code, not just prose. ("You may read both codebases.")
2. **State the key facts** up front so it doesn't waste turns rediscovering them.
3. **Direct the attack** — name the specific things to stress (feasibility, phase
   ordering / circular deps, failure modes, hidden costs, what's MISSING).
4. **Demand a structured output**: a verdict line, then a **prioritized** list of
   concrete findings (most severe first), each with the flaw + a suggested fix,
   citing files. "Do not rewrite the doc."
5. **Be genuinely adversarial** — tell it to find what is wrong, under-specified, or
   dangerously optimistic, and to default to skepticism.

## 4. Verdict handling

| Verdict | Action |
|---|---|
| `accept` | proceed; record the verdict in the commit footer |
| `accept-with-revisions` | apply the revisions; if substantive, re-review; operator adjudicates |
| `reject` | **stop**; synthesize the findings, revise the artifact, re-review; operator adjudicates before proceeding |

A rejection is not a failure of the process — it is the process working. The v1→v2
roadmap rejection is the canonical example: it caught a circular phase dependency
and several factual errors that would have been very expensive to discover during
Phase 3.

## 5. Synthesis discipline

When synthesizing a multi-reviewer rejection:
- Separate **consensus** findings (both reviewers) from single-reviewer ones.
- Treat factual corrections (wrong claims about the code) as non-negotiable.
- For each finding, record the fix in the artifact's changelog so the resolution is
  auditable (see MERGE-ROADMAP.md "v1 → v2 changelog").
- Re-review the revised artifact if the changes were structural.
