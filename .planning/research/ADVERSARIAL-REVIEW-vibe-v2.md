verdict: reject

---

## CRITICAL

**CRITICAL-1: Phase 3 engine migration is under-scoped for Explorer's main-thread architecture**
The roadmap claims Phase 3 will "rewrite all Explorer data access as messages" but fails to account for Explorer's **non-serializable main-thread state**: `src/reader/parquetDeep.ts:64` uses a `WeakMap<object, Map<string, Promise<FileMetaData>>>` keyed by the Reader, and `src/state/store.ts:30-32` holds a module-global `reader: Reader | null` with live Arrow/WASM handles. Arrow tables and WASM handles **cannot** cross the worker boundary via structured clone. The roadmap's §1.1 correctly states "Arrow/WASM handles NEVER cross the boundary" but doesn't explain how Explorer's existing WeakMap caching and dynamic hyparquet imports (which depend on the live Reader) will be reconstructed in the worker.
**Fix:** Phase 3 must explicitly address migrating or replacing the WeakMap cache, the dynamic hyparquet import flow, and the module-global reader reference. Cite: mzPeakExplorer/src/reader/parquetDeep.ts:64, mzPeakExplorer/src/state/store.ts:30-32.

**CRITICAL-2: Imaging detection parity is NOT achieved by standardizing on probeIsImaging alone**
The roadmap §2 claims to standardize on IV's `probeIsImaging` 3-signal semantics. However, Explorer's `src/reader/imaging.ts:53-56` uses **1-signal detection** (`metadata.imaging.is_imaging` only) and returns `null` when absent. IV's `src/reader/stats.ts:227-268` probes THREE sources: promoted IMS columns, CV params, OR the metadata flag. The roadmap's CTR-03 mentions `probeIsImaging` 3-signal semantics but doesn't specify that Explorer's 1-signal `readImaging` must be replaced. **This creates a detection gap**: a file with IMS position columns but no `is_imaging` flag would be detected as imaging by IV but NOT by Explorer, breaking the "detection-parity tests are an acceptance criterion" claim.
**Fix:** Explicitly replace Explorer's `readImaging` with `probeIsImaging` in Phase 1 contracts. Cite: mzPeakExplorer/src/reader/imaging.ts:53-56 vs mzPeakIV/src/reader/stats.ts:227-268.

**CRITICAL-3: URL conflict matrix is incomplete and has ambiguous precedence**
MERGE-ROADMAP.md §3.2 states `scan` > `px` > `spectrum` but **omits the interaction with `ion`**. A link with `?scan=5&ion=445.1` in an imaging file: does it select spectrum 4 (after scan→spectrum translation) AND render ion image at 445.1? The matrix doesn't say. Similarly, `?px=10,20&ion=445.1` — does px select a spectrum AND ion render? The conflict matrix in §3.2 is incomplete. Explorer's current behavior (MERGE-ROADMAP.md:191-192) says "both applied; the data view shows first, the spectrum stays selected" but this isn't in the matrix.
**Fix:** Complete the conflict matrix with all pairwise interactions. Cite: MERGE-ROADMAP.md:187-188.

**CRITICAL-4: Legacy redirect shim is underspecified for query preservation**
MERGE-ROADMAP.md §3.4 states: "redirect mechanism is per-target" with a client-side shim for GitHub Pages. However, the shim approach isn't specified for mzpeak.org. The claim that "query string explicitly carried" is not sufficient — a client-side shim using `location.replace` **cannot** preserve the query string when redirecting from `/IV/?file=X&scan=5` to `/view/?file=X&spectrum=4` because the shim itself must parse and translate the query. The roadmap doesn't specify which params are translated vs passed through, creating risk of link breakage.
**Fix:** Explicitly list all param translations (scan→spectrum, tol→ion, etc.) and which are passed through unchanged. Cite: MERGE-ROADMAP.md:209-214.

---

## MAJOR

**MAJOR-1: Phase 0 has no documented fallback if HUPO-PSI/mzpeakts#1 stalls or is rejected**
ROADMAP.md:38 states fallback is "pinning to the fork commit" but doesn't specify: (a) which fork, (b) for how long, (c) who decides to cut bait. Phase 0 is marked "low risk" but an external PR in another org is a **schedule dependency** with no SLA. The v1→v2 changelog doesn't address this.
**Fix:** Add explicit fallback criteria and timeline. Cite: ROADMAP.md:38, MERGE-ROADMAP.md:236-240.

**MAJOR-2: ui-kit extraction (Phase 2) has hidden dependencies on store types**
MERGE-ROADMAP.md:254-255 claims ui-kit components are "purely presentational" but IV's `SpectrumPanel` (src/ui/SpectrumPanel.tsx) uses `useStore` directly for `selectedSpectrum`, `colormap`, `scale`, etc. Explorer's `SpectrumPlot.tsx` similarly depends on store state. Extracting these into ui-kit would require either: (a) passing all data as props (breaking change), or (b) ui-kit depending on store types from contracts. The roadmap's KIT-02 says "no reader/store/imaging assumptions" but doesn't address how state-bound components become presentational.
**Fix:** Clarify the prop interface for each extracted component or acknowledge ui-kit will need store types from Phase 1. Cite: MERGE-ROADMAP.md:254-256.

**MAJOR-3: Worker boundary for large member reads is hand-waved**
MERGE-ROADMAP.md §1.1 claims "Raw archive-member downloads (up to 256 MB) do not round-trip as structured-cloned worker results" and will use "transferable ArrayBuffer or the shell fetches the byte range directly." But Explorer's `src/state/store.ts:927-934` `getArchiveMemberBytes` already caps at 256 MB and returns `Uint8Array`. The roadmap doesn't specify: (a) which messages will return transferable buffers, (b) whether the worker or shell handles the 256 MB cap, (c) what happens for members >256 MB in the unified app.
**Fix:** Specify per-message transfer rules for archive member reads in Phase 1 contracts. Cite: MERGE-ROADMAP.md:78-80.

**MAJOR-4: Capability gating for chromatograms is underspecified**
MERGE-ROADMAP.md §2 states Chromatograms are shown when `numChromatograms>0 OR a TIC column exists`. But Explorer's `src/ui/ChromatogramsTab.tsx` gating isn't visible in the provided docs, and the roadmap doesn't specify WHERE this capability comes from in the unified store. IV doesn't have a chromatograms tab at all. The unified `hasTicColumn` capability isn't defined in the contracts.
**Fix:** Define `hasTicColumn` detection and its source in Phase 1 contracts. Cite: MERGE-ROADMAP.md:106-108, CTR-03.

**MAJOR-5: Phase 3 "parity is the gate" but no test fixtures are defined**
ROADMAP.md:72-73 requires "golden-output parity tests compare new-engine results to the old main-thread/worker outputs for an imaging fixture AND an LC fixture." The roadmap doesn't specify WHICH fixtures, WHERE they live, or HOW the golden outputs are captured/maintained. Without explicit fixtures, "parity" is untestable.
**Fix:** Define the test fixtures and golden output capture mechanism in Phase 1. Cite: ROADMAP.md:72-73.

---
## MINOR

**MINOR-1: Phase ordering diagram is wrong**
MERGE-ROADMAP.md:303 states `0 → 1 → {2, 3} → 4 → 5 → 6` but ROADMAP.md:23 states `0 → 1 → {2, 3} (2 and 3 both depend only on 1; can overlap) → 4 → 5 → 6`. However, Phase 2 (ui-kit) extraction requires the contracts from Phase 1, but also requires both apps to consume the ui-kit "behavior unchanged" — which means both apps must still be buildable. If Phase 0 (reader convergence) hasn't completed, the two apps can't both build against one reader, so Phase 2 implicitly depends on Phase 0 too. The dependency graph has a hidden edge: 2 also depends on 0.

**MINOR-2: a11y acceptance criteria are not testable as stated**
MERGE-ROADMAP.md:134-139 defines a11y acceptance criteria but doesn't specify the test mechanism. "Current code uses div role=button with click-only" implies the tests need to verify keyboard navigation, but no test IDs or automation approach is specified.

**MINOR-3: "Low-risk" labels are inconsistent**
MERGE-ROADMAP.md:240 labels Phase 0 "low (gated on PR merge; fallback = fork pin)" but Phase 3 is "HIGH" — yet Phase 0 is a **hard prerequisite** blocking all subsequent phases. If Phase 0 fails, the entire project stalls. The risk labeling doesn't reflect blocking nature.

**MINOR-4: Missing phase for performance validation**
No phase explicitly owns "performance + memory budgets for worker round-trip vs old main-thread reads" until Phase 6. But Phase 3 delivers the engine — if it has performance regressions, they're baked in. Performance budgets should be a gate for Phase 3, not Phase 6. DEP-02 in Phase 6 is too late.

**MINOR-5: URL grammar `px=` param is not defined in Explorer**
The `px=` param (MERGE-ROADMAP.md:160) is "NEW, imaging-clear" but Explorer has no equivalent. The roadmap doesn't specify how Explorer-style links with pixel coordinates would be constructed or parsed. The legacy IV doesn't have `px=` either — it's a new feature, not a unification.

**MINOR-6: Override UX location is underspecified**
MERGE-ROADMAP.md:125-127 states the detection override "lives in MSI ▸ Grid (and in Summary when ambiguous)" but doesn't specify the UI mechanism (checkbox? button? persistence?) or how the override interacts with URL params.


_Raw vibe CLI output, 2026-06-12. Verdict: reject (see SYNTHESIS for disposition)._
