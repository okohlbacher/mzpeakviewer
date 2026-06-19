# Chromatograms view — managed multi-chromatogram list (design)

## Goal
Turn the Chromatograms view from a single-plot "last loaded" surface into a **managed list**
of chromatograms: the file's **stored** chromatograms + user-**generated** (in-memory)
TIC/XIC traces. Each is a card with **independent zoom + resize**. Two actions:
**“+ add TIC”** and **“+ add XIC”** (for an m/z ± tol and optional RT range) append
in-memory traces. Hierarchical: a *Stored* group (from the file) and a *Generated* group.

## Ground truth (what exists)
- Engine already extracts every mode: `engineExtractChrom({mode})` → tic / xic / xicRange /
  diaXic / stored; `engineChromatogramList()` returns the file's stored chromatogram
  metadata (`ChromatogramInfo[]`).
- Store today: a **single** `chrom: ChromatogramSeries | null` + `chromReq` + `loadChrom(req)`,
  surfaced by one `ChromPlot`. `ChromPlot` (ui-kit) is single-series, fixed `HEIGHT=200`,
  with wheel-zoom + middle-drag pan + double-click reset (so **per-instance zoom already
  works** — N independent plots each zoom independently).
- `urlSync` round-trips one chromatogram via `chromReq` (`?tic` / `?xic` / `?chrom=`).

## Design

### State (store) — a list, not a single trace
Replace the single `chrom` with:
```ts
type ChromItem = {
  itemId: string;              // stable client id (monotonic "c1","c2"… ; stored use "stored:<id>")
  source: "stored" | "generated";
  req: ChromRequest;           // how to (re)compute it
  label: string;               // "TIC", "XIC 445.12 ± 0.01", stored id, …
  series: ChromatogramSeries | null;
  loading: boolean;
  error: string | null;
  height: number;              // px plot height (resize), clamped [120, 600], default 220
};
chromList: ChromItem[];
```
Actions: `addTic(rt?)`, `addXic(mz, tolDa, rt?)`, `addStoredChrom(id)`, `removeChrom(itemId)`,
`setChromHeight(itemId, h)`, `clearGeneratedChroms()`. Each add appends an item (loading=true)
then fills `series` from `engine.extractChrom`. **In-mem only**: `chromList` lives in the store
(persists across tab switches), is **reset on file open**, and is NOT written to the file.

**Per-item async race:** generating several XICs at once means the single `currentChromSeq`
guard is insufficient. Guard each load by `(itemId, currentOpenSeq)` — commit a result only if
the item still exists and the file hasn't changed.

**Dedup:** adding a stored chrom already in the list is a no-op (scroll to it). Identical
generated traces are allowed (the user may want two zoom states) — or dedup by req; decide.

### View (hierarchical)
- **Toolbar:** `+ add TIC` (optional RT min/max), `+ add XIC` (m/z, ± tol, RT min/max), and a
  collapsible **Stored chromatograms** table (the file's, from `chromatogramList`) where each
  row has a `+` to add it to the list. "Clear generated" to empty the Generated group.
- **List:** two collapsible groups — **Stored (n)** and **Generated (m)** — each a stack of
  **cards**. A card = header (label · point count · `−` remove for generated) + a `ChromPlot`
  + a **resize handle** (drag the bottom edge to change height). RT-click still selects the
  nearest spectrum.
- Empty state: "No chromatograms yet — add a TIC or XIC, or pick a stored one."

### ChromPlot change
Add an optional `height?: number` prop (default keeps 200) so each card resizes independently.
No other change — zoom/pan/reset already per-instance.

### Resize UX
A 6px drag handle at the card's bottom edge: `pointerdown` → track `pointermove` delta →
`setChromHeight(clamp(120, 600))`; `pointerup`/`pointercancel` to release. Keyboard: ↑/↓ on a
focused handle nudges ±20px (a11y).

### Deep-link / share (keep it small)
The list is session-only. On hydrate, a `?xic=`/`?chrom=` link **adds one item**.
`currentShareUrl` emits the **first generated** item (or none) so existing single-trace links
still round-trip. Full multi-trace share is out of scope (follow-up).

### DIA fragment extractor
Leave the existing DIA peak-group extractor (separate, view-local `MultiChromPlot`) as a
distinct sub-feature; it does not enter the list.

## Phased plan
- **P0** store: `chromList` + actions + per-item race guard + reset-on-open; `ChromPlot` height prop.
- **P1** view: toolbar (add TIC/XIC + stored table with `+`), the two-group card list, resize handle.
- **P2** urlSync: hydrate adds one item; emit first generated; targeted tests. (small)

## Verification
- Typecheck + build; unit-test the store list reducers (add/remove/height/dedup/reset) and the
  per-item race guard (stale file open drops a result).
- Live: open the Bruker demo → add TIC, add XIC (m/z), pick a stored chrom; zoom one card
  without affecting others; resize a card; remove a generated card; switch tabs + back (list
  persists); open another file (list resets).

## Risks / open questions (for adversarial review)
- Many `uPlot` instances at once — render cost; cap the list and/or only mount the plot for
  expanded cards?
- Per-item async correctness with concurrent generation + a mid-flight file switch.
- Memory of many in-mem series (each is RT-length f32 — small; the XIC read cost is the real
  one, already cached by the engine).
- Replacing the single `chrom` breaks `urlSync`/`chromReq` + the existing DIA view's reliance
  on store state — migration must keep both working (or keep `chrom` as a derived "primary").
- Resize handle pointer-capture cleanup (listeners removed on unmount / pointerup); clamp.
- Stored-chrom dedup vs allowing duplicate generated traces.
- Does "hierarchical" mean nested groups, or just labelled sections? (assumed: two groups.)

---
# v2 — review responses (codex + vibe) + peak→XIC + Settings

## Resolutions to the adversarial review
- **Compat shim, not removal.** Keep `chrom`/`chromReq` as DERIVED from the *active* item
  (`activeChromItemId`); `loadChrom(req)` = add-or-replace the active item. `urlSync` hydrate
  adds the active item; `currentShareUrl` emits the **active** item (incl. stored). Keep the
  `?tic` / `?xic` / `?chrom=` round-trip tests green.
- **Per-item load token.** Each item has a monotonic `loadSeq`; a generation captures
  `(itemId, loadSeq, openSeq, reqKey)` and commits only if the item still exists AND all match.
- **Cancellation = best-effort stale-drop for v1** (worker is serialized; true preemption is the
  deferred "cooperative abort" task). Dropped on remove/clear/open. **Cap generated items at 12**
  to bound work + memory; adding past the cap evicts the oldest or is refused with a notice.
- **Lazy-mount + preserved zoom.** Cards are collapsible; the `ChromPlot` mounts only when the
  card is expanded. Per-item `xRange` is stored on zoom/pan/reset and restored on remount, so
  zoom survives collapse/unmount (zoom otherwise lives inside uPlot). `ChromPlot` gains
  `onZoomChange` + a controlled `zoom` (mirroring `SpectrumPlot`).
- **Resize via `setSize`, not rebuild.** `ChromPlot` gains `height`; a height change calls
  `u.setSize({width,height})` (no data rebuild → zoom preserved). Resize handle:
  `setPointerCapture` + `lostpointercapture`/`pointercancel` + effect-teardown cleanup +
  `touch-action:none` + continuous clamp [120,600] + throttle; `role="separator"` +
  `aria-valuemin/now/max` + ↑/↓ keyboard nudge.
- **Stored identity by INDEX (+id label).** Items key on the stored chromatogram's stable index;
  dedup on index. (id kept only for display.)
- **Reset map.** `chromList`, counters, `activeChromItemId`, expanded/zoom state, and pending
  loads are all cleared/cancelled in `openFile` / `openUrl` / `reset`.
- **RT semantics: seconds internally.** Validate `finite && min < max`; clamp to the run's RT
  bounds; surface a per-item error otherwise. (UI may display minutes; convert at the boundary.)
- **DIA guard.** The existing DIA extractor keeps its own open-seq/load token and clears on open;
  it stays separate from `chromList`.
- **Pick behavior per source.** Generated TIC/XIC RT-click → nearest spectrum; stored → only when
  a valid time mapping exists, else no-op.
- **Data path.** Pass `ChromatogramSeries` typed arrays to a memoized `ChromCard` keyed by
  `itemId`; avoid per-render `{time,intensity}[]` rebuilds.

## New: right-click a peak → MS-level-limited XIC
In the Spectra view, **right-clicking a peak** (MS1 or MS2 spectrum) opens a small context
popover at the cursor: the resolved peak m/z, an **RT range** (pre-filled to the shown
spectrum's RT ± the RT-window setting, clamped to run bounds, editable as min/max), and an
**m/z tolerance** (pre-filled from Settings). "Create" → switches to the Chromatograms view and
adds a **generated XIC** computed over `mz ± tol`, **limited to the MS level of the shown
spectrum** and the chosen RT range.
- `SpectrumPlot` gains `onPeakContextMenu(mz, clientX, clientY)` — `preventDefault()` the native
  menu, resolve nearest peak via the existing `nearestPeakIndex`.
- **MS-level-limited XIC = new engine capability.** Extend the `xic` `ChromRequest` with an
  optional `msLevel?: number`; the engine post-filters the summed points to spectra whose
  `browse.msLevel === msLevel` (same mechanism as the TIC's MS1 filter / DIA's member filter).
  MS1 peak → MS1-only XIC; MS2 peak → MS2-only XIC.
- The XIC tol + RT are **adjustable later** on the card / add-XIC form (re-extract on change).

## New: Settings (browser-persisted defaults)
- A `settings` store slice persisted to **localStorage** (`mzpeak.settings` key):
  `xicTolDa` (default **0.1**), `xicRtHalfMin` (default **2**). Loaded on store init, written on
  change (guarded for SSR/no-storage). These seed the peak→XIC popover + the add-XIC form.
- A minimal **Settings** surface (gear button in the top bar → small popover, mirroring the
  About/Share popovers) with the two numeric fields + reset-to-default. No new sidebar entry.

## Phased plan (v2)
- **P0** contracts/engine: `xic.msLevel`; store `settings` slice + localStorage; `chromList`
  model + actions + per-item load token + reset/cancel map; derived `chrom`/`chromReq` shim.
- **P1** ui-kit: `ChromPlot` `height` + `zoom`/`onZoomChange` (setSize path); Settings popover.
- **P2** views: Chromatograms multi-card list (collapsible groups, lazy-mount, resize handle,
  add TIC/XIC, stored `+`); Spectra right-click-peak popover → addXic(msLevel) → route to chrom.
- **P3** urlSync active-item round-trip; unit tests (store reducers, race guard, msLevel xic,
  settings persistence) + the existing chrom deep-link tests.
