# PLAN: "Study design" sidebar tab (SDRF display) — mzpeakviewer

Repo: ~/Claude/mzPeakViewer, HEAD 7a5185e (clean tree). React 19 + TS, zustand store,
worker engine. Review the PLAN below against the existing code; do not modify files.

## Context (what exists today)

- mzPeak archives from `mzpeak-convert --sdrf` embed the study's SDRF TSV as an archive
  member (`sample_metadata/sdrf.tsv`), referenced by index `metadata.sample_metadata.member`
  (+sha256). `metadata.study.dataset_accession` and (sometimes) `title` exist.
  `metadata.sample_list` is EMPTY on current corpus files (converter gap); the engine
  (v0.8.5) derives isobaric channels from the SDRF TSV itself (packages/core/src/engine/
  studyMeta.ts — `sdrfChannelsFallback`, run matched via `comment[data file]` vs
  `metadata.run.id` with XML-id decode; reagent table for reporter m/z).
- Store (app/src/store.ts): `channels: ChannelAssignment[]`, `study`, `studySamples`,
  `sdrfMember: string | null` — filled asynchronously post-open.
- Summary view (app/src/views/Summary.tsx:261-431) has a `StudyPanel`: accession/title
  rows, channel badges, sample_list matrix (empty on corpus), and a lazy `<details>`
  `SdrfTable` that fetches the member via `engine.archiveMemberBytes` + `parseSdrf`
  (app/src/sdrf.ts — trivial TSV split) and renders a flat, capped table.
- Sidebar tabs are hardcoded in app/src/App.tsx (~line 324): Summary, Spectra,
  Chromatograms (gated), UV/VIS (gated), IMS (gated), IMAGING accordion (gated),
  ADVANCED accordion (Metadata/Structure). View ids in packages/contracts/src/store.ts
  `View` union + `ALL_VIEWS`; deep link `?view=` handled in app/src/urlSync.ts;
  per-view headers in App.tsx `VIEW_HEADERS` (~line 665).
- Test examples: LFQ = v09/sdrf-examples/MTBLS1129 (label-free), TMT10 =
  v09/sdrf-examples/PXD011799 (480 rows × ~31 cols; 10 rows per run).

## Proposed change

### New sidebar tab "Study design" (view id "study")

Gating: shown when `sdrfMember != null || channels.length > 0 || (studySamples?.length ?? 0) > 0`.
Placement: after Chromatograms/UV-VIS/IMS group, before IMAGING; always above ADVANCED.
Wiring: add "study" to `View` union + `ALL_VIEWS` (contracts), `?view=study` deep link
(urlSync), `VIEW_HEADERS`, TabButton + render branch in App.tsx.

### Data flow

On first mount, fetch the SDRF member once via `engine.archiveMemberBytes` (existing op,
8 MB cap) → `parseSdrf` → derive a `SdrfDesign` model in a NEW pure module
`app/src/sdrfDesign.ts` (unit-testable, no React):

- Column classification by SDRF convention: `source name`, `characteristics[...]`,
  `assay name`, `comment[...]`, `factor value[...]`, technology/vendor extras.
- Aggregates: distinct source names (#samples), distinct assay/data files (#runs),
  organism / organism part / disease / cell type distributions, instrument(s),
  label scheme derived from distinct `comment[label]` values (label free / TMT6/10/11/
  16/18-plex / iTRAQ4/8 via count+prefix), fraction count (`comment[fraction identifier]`),
  technical/biological replicate counts.
- Factors: for each `factor value[x]` column → level→count distribution.
- This-run rows: `comment[data file]` basename (ext stripped, XML-id decoded) equals
  `metadata.run.id` key — SAME normalization as core studyMeta.ts runKey (duplicated
  ~10 lines app-side, or exported from core — reviewer input wanted, Q6).
- Varying vs constant columns: a column with 1 distinct value across rows is "constant"
  (SDRF is wide + highly redundant; PXD011799 has ~31 cols, most constant).

### View sections (app/src/views/StudyDesign.tsx), top→bottom

1. **Header strip** — accession linkified (PXD→proteomexchange, MTBLS→MetaboLights),
   title, provenance chips (member path, sha256 first-12, embed_scope, precedence),
   `N samples · M runs · this run: k rows`.
2. **Design overview cards** — samples, runs, label scheme, fractions, replicates,
   organism/part/disease/instrument (top values + "+n more").
3. **Experimental factors** — one block per `factor value[x]`: factor name + level
   distribution as count pills (e.g. `disease: normal ×240 · tumor ×240`). If none:
   explicit "No factor value columns — design not annotated".
4. **Channel map** (isobaric only) — table: channel · reporter m/z · sample (source
   name) · per-channel factor values; rows for THIS run highlighted; links the pills
   in Spectra to the design.
5. **Sample table** — the full SDRF: sticky header + first column, this-run rows
   pinned to top + tinted, free-text filter box, "hide constant columns" ON by default
   (toggle reveals all), column-class tint (characteristics / comment / factor value),
   render cap (existing SDRF_MAX_ROWS=___ keep) with count note, horizontal scroll.

### Summary view

Keep StudyPanel but drop its embedded SdrfTable `<details>`; add "Open Study design →"
button (setView("study")). No data duplication: the tab refetches lazily (engine op is
range-read + cached by the browser).

### Tests

Unit-test `sdrfDesign.ts` pure helpers (classification, factor extraction, label-scheme
derivation, varying-column detection, run matching) with LFQ-like + TMT10-like fixtures.
No e2e in this pass.

## Invariants / constraints

- All SDRF content is UNTRUSTED text → render as text nodes only (React default), never
  dangerouslySetInnerHTML; linkify ONLY the accession via an allowlist (PXD\d+, MTBLS\d+).
- The worker boundary: view fetches bytes via the existing archiveMemberBytes op; no new
  engine ops, no mzpeakts changes.
- Tab must NOT appear for files without study data (most corpus files) and must not
  flicker in after open (channels/sdrfMember arrive async ~1s post-open — acceptable?
  Q1 below).
- SDRF up to ~10k rows × ~40 cols must stay responsive (aggregation O(r×c) once;
  render capped; filter recomputes on keystroke over capped rows only).
- Old-format files (no SDRF) unaffected; typecheck + existing 203-test suite stay green.

## Questions for the reviewer (attack these specifically)

Q1. Gating on async-arriving store fields: tab pops in ~1s after open. Acceptable, or
    should the nav reserve/skeleton it? Alternative gating ideas?
Q2. Moving the SDRF table out of Summary (leaving a link) — breaking anyone's workflow
    or fine? Should StudyPanel shrink further?
Q3. "Hide constant columns by default" — right default for comprehensibility, or does
    hiding verbatim SDRF columns violate least-surprise for SDRF-literate users?
Q4. Label-scheme derivation from distinct comment[label] values — failure modes
    (mixed plexes across fractions? TMT131 vs TMT131N aliasing? SILAC?). Better rule?
Q5. Factor display as count pills vs a factors × levels design matrix — which is more
    informative for real studies (MTBLS1129 has multiple factors)?
Q6. Run-key normalization duplicated app-side vs exported from @mzpeak/core — which,
    given the app already imports engine ops from core? Any drift risk?
Q7. What would a proteomics/SDRF-literate reviewer expect that this plan MISSES
    (enrichment, modification parameters, instrument per run, cleavage agent…)?
Q8. Perf/DoS: any blowup path with a pathological SDRF (100k rows, 500 cols, no
    factor cols, all-distinct values)? Where must caps go?
Q9. A11y/UX of the plan's table (sticky first column + row pinning + filter) — any
    React 19 / CSS pitfalls in the described combination?

## Review contract

- Cite file:line for claims about existing code; give concrete failing inputs.
- Rank findings by severity; say for each whether it bites on real data or is theoretical.
- If a section is fine, say "fine" and move on — no padding.
- REVIEW ONLY: do not modify any file.
