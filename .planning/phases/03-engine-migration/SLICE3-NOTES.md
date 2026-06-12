# Phase-4 shell + imaging-render slice — review disposition

Dual review. **codex: `accept-with-revisions`** (slice fundamentally sound) + **vibe:
`reject`** — strongly convergent. All actionable findings fixed in parallel (2 agents:
engine + app). 163 unit + 5 e2e green.

## Fixed
- **ion-image source** (codex MAJOR / vibe C3): `engineRenderIonImage` read intensity via
  representation-routed `reconstructSpectrum` (centroid→peaks); IV always sums `spectra_data`
  point intensity. Now reads the data-array source directly (centroid fallback only when no
  data arrays). The golden parity test is now NON-circular (hand-sums raw data-array bytes,
  not the routed read).
- **store stale-async race** (codex MAJOR / vibe C1/C7): `openFile` fired scanBreakdown +
  select(0) without a guard → an old file's promise could clobber a new file's state. Added a
  monotonic `openSeq` checked before every post-open `set()` (+ in selectSpectrum/loadChrom).
- **ticColumn boundary** (codex MAJOR): the engine computed `ticColumn` but `EngineClient`
  dropped it and the store re-guessed via `browse.tic.some(>0)` (an all-zero TIC read as
  absent). `EngineClient.scanBreakdown()` now returns `ticColumn`; the store writes it to the
  capability model.
- **mean/ROI honesty** (codex MAJOR / vibe C3/C5): documented as SAMPLED (id `mean-sampled`/
  `roi-mean`); ROI now uniform-subsamples the sorted set (was `slice(0,100)` arbitrary drop).
  Full N/M count-reporting deferred to when the mean/ROI UI lands (TODO).
- **roving tabindex** (codex MINOR / vibe C2): built from VISIBLE tabs only (respects accordion
  expanded state) + auto-expands the accordion holding the active tab.
- **focus-visible** (vibe M3): tab buttons get a `--focus-ring` outline on `:focus-visible`.
- **e2e strength** (codex MINOR / vibe C4/M1): added a narrow-window render + a two-pixel
  determinism assertion (click cell (0,0) vs (2,2) → different spectrum metadata), plus
  narrow + empty-window golden assertions in the engine.

## Dismissed (verified false positive)
- vibe C1/C9 "pixel-pick wrong for non-origin grids": paint and pick both use the same
  LOCAL `y*width+x` coordKey (origin is display-only in the readout), so the pick is correct
  regardless of `originX/Y`. codex did not flag it; examined and sound.

## Deferred (polish, low risk — documented)
- vibe M2: separate `tablist` per accordion (ARIA purity) — current single tablist works with
  the visible-only roving fix; refactor later.
- codex MINOR 5: optical/overlay ViewRouter placeholders are dead routes (no nav tab emits
  them); harmless until the optical view lands.
- vibe m1/m2: IonImage canvas dim redundancy + negative-tol input (UI already disables Render).
