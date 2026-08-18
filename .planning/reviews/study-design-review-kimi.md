• I'll read the cited files to verify the plan's claims.

• Review complete. I read every file the plan cites (studyMeta.ts, sdrf.ts, contracts store.ts + wire.ts + url/grammar.ts, app store.ts, Summary.tsx, App.tsx, urlSync.ts, gunzip.ts) and checked the plan's claims against them.

  # Review: "Study design" sidebar tab plan

  ## Findings (ranked)

  ### F1 — HIGH, real: the wiring list omits `VALID_VIEWS` in the URL grammar
  The plan says "add 'study' to `View` union + `ALL_VIEWS` (contracts), `?view=study` deep link (urlSync)". But view validation for deep links is a **separate hardcoded Set** at `packages/contracts/src/url/grammar.ts:61-75`, independent of `ALL_VIEWS` (`packages/contracts/src/store.ts:34`). `resolve()` rejects unlisted views at grammar.ts:321 (`view-unknown` notice → falls back to `inferView` → "summary").

  Concrete failing input: `?file=mtbls1129.mzpeak&view=study` → notice `Unknown view "study"`, lands on Summary. The plan's wiring list will produce a broken deep link. `VALID_VIEWS` must be updated; `viewAllowedInMode` (grammar.ts:222-227) needs no change (`study` falls through to `return true`).

  ### F2 — HIGH, real: plan's data flow omits gzip handling
  The plan says "fetch the SDRF member once via `engine.archiveMemberBytes` → `parseSdrf`". The only existing app-side precedent — `SdrfTable` at `app/src/views/Summary.tsx:350-352` — decodes with a bare `TextDecoder` and **does not gunzip**. But gzipped SDRF members are real: `app/src/gunzip.test.ts:20` uses `sample_metadata/sdrf.tsv.gz`, and core's `memberText` (studyMeta.ts:154-162) sniffs `0x1f8b` for exactly this reason. Copying the Summary pattern into the new view breaks on every `.sdrf.tsv.gz` member (garbage columns). The plan must specify: sniff magic bytes or suffix, then `gunzipBytes` (app/src/gunzip.ts:7 — the helper already exists). Note this is also a latent bug in today's Summary `SdrfTable`; the move is the chance to fix it, and the plan should say so explicitly.

  ### F3 — MEDIUM, real: truncated reads silently produce wrong aggregates
  `engineArchiveMemberBytes` returns `{bytes, truncated}` (packages/core/src/engine/structure.ts:180-183). The plan targets "SDRF up to ~10k rows × ~40 cols" — that can exceed the 8 MB cap. `SdrfTable` ignores `res.truncated` (Summary.tsx:350-353); studyMeta.ts:179 treats truncation as fatal for channels. If the new view copies the Summary pattern, header-strip counts (`N samples · M runs`) and all aggregates become silently wrong on a truncated member. The plan must state: on `truncated`, show a warning and mark aggregates partial (or raise the cap).

  ### F4 — MEDIUM, real: provenance chips have no data source
  The header strip promises "sha256 first-12, embed_scope, precedence" chips. The store only surfaces `sdrfMember` (a bare string — wire.ts:407, store.ts:415); `StudyMeta` (wire.ts:392-408) carries no sha256/embed_scope; `archiveMemberBytes` returns bytes only. Getting the sha256 requires either extending `StudyMeta`/`engineStudyMeta` (a contracts change the plan doesn't list) or a second app-side fetch of `mzpeak_index.json` like Metadata.tsx:42 (up to 16 MB just for chips). As written, section 1 of the view is unimplementable without plumbing the plan never mentions. Pick one and say which.

  ### F5 — MEDIUM, real: pin-before-cap ordering unspecified
  "this-run rows pinned to top" + "render cap (SDRF_MAX_ROWS keep)" + "filter over capped rows only". If capping precedes pinning, this-run rows past row 500 vanish from the table they're supposed to anchor. Required order: partition (this-run first) → cap. Also, "filter recomputes over capped rows only" makes the filter actively misleading on a 10k-row file (false "no results" for samples beyond the cap) — at minimum the count note must state the filter's scope; better: filter the parsed set, then cap the render.

  ### F6 — MEDIUM, real: deep link to a gated-away tab has no defined behavior
  Gating hides the tab until `sdrfMember`/`channels` arrive async (store.ts:413-416, off critical path, ~1s+). But `?view=study` sets `view` directly (urlSync.ts:65) regardless of gating — for a file with **no** study data, the user lands on a view whose nav entry never appears. The plan gates the *tab* but never specifies the *view's* empty state. The render branch must handle "no study data" explicitly. (Cross-file staleness is fine — `INITIAL_OPEN_STATE` resets `view: "summary"`, store.ts:327/620.)

  ### F7 — LOW, real on mislabeled data: label-scheme derivation (Q4)
  Counting distinct `comment[label]` values fails on:
  - **TMT131 vs TMT131N/C aliasing** — they share reporter m/z (REPORTER_MZ, studyMeta.ts:21); one misspelled row turns a 10-plex into "11 distinct → TMT11".
  - **SILAC/label-free rows in the same column** — core already handles this by resolving through `reporterMzFor` and skipping nulls (studyMeta.ts:197-198); the app-side derivation must do the same exclusion before counting, or SILAC labels inflate the plex count.
  - **Mixed plexes across fractions** — study-wide distinct count ≠ per-run plex. Derive the scheme from *this run's* rows, show study-wide separately.

  Better rule: canonicalize through the existing `REPORTER_MZ` table (uppercase, strip `[\s_-]` — studyMeta.ts:38), count distinct *resolved* labels among this-run rows, classify by (count, TMT vs TMTPRO vs ITRAQ prefix).

  ### F8 — LOW, theoretical: no column cap (Q8)
  Caps present in the plan: 8 MB bytes, 500 rendered rows. Missing: a column cap. Pathological input (500 cols × 500 rows after filtering = 250k nowrap cells) will stall render. Add a rendered-column cap or accept-and-document. Aggregation itself (O(r×c) Sets) is fine at 10k×40.

  ## Answers to the reviewer's questions

  - **Q1**: Acceptable — it's the same pop-in the existing StudyPanel already has (same studyMeta call feeds both, store.ts:413-416). But note this is the first tab gated on a worker round-trip rather than synchronous capabilities, and the fallback path parses up to 8 MB of TSV in the worker (studyMeta.ts:178-181), so pop-in latency grows with SDRF size. No skeleton needed; do not reserve space — most files have no study data (per plan's own constraint).
  - **Q2**: Fine. No e2e test references `sdrf-table` or the study panel (grep of app/e2e: zero matches), so nothing breaks. Keep StudyPanel's accession/title/channels as-is; shrinking further isn't needed. The "browser caches the range-read" claim holds only for remote files — local `openFile` has no HTTP cache, but the refetch is cheap; fine.
  - **Q3**: Fine, right default — provided the toggle shows "N constant columns hidden" as an always-visible affordance. Least-surprise is satisfied by one-click reveal.
  - **Q4**: See F7.
  - **Q5**: Count pills are adequate for v1; a factor×level matrix is better for multi-factor studies (MTBLS1129) but not worth blocking on. Fine.
  - **Q6**: Export from core. `runKey`/`decodeXmlId` are module-private (studyMeta.ts:142-152), and the extension list (`.raw|.d|.wiff2?|mzml|mzxml|.mzpeak`, studyMeta.ts:150) is exactly the kind of thing that drifts — if the converter adds `.mzmlb`, one side gets updated and this-run pinning silently stops matching. The app already imports engine ops from core; exporting `runKey` is trivially better than duplicating ~10 lines. Also specify: when 0 rows match this run, pin **nothing** and show "this run: 0 rows" — do not replicate core's `collect(false)` study-wide fallback (studyMeta.ts:217-218), which is correct for channels but wrong for row highlighting.
  - **Q7**: The aggregate list misses the first things a proteomics user scans for: `comment[modification parameters]` (fixed/variable mods), `comment[cleavage agent]`, and `comment[enrichment process]`. Column classification already covers `comment[...]`, so adding these to the overview cards is cheap. Also handle SDRF "not annotated"/"NT" sentinels so they don't appear as levels.
  - **Q8**: See F3 (truncation) and F8 (column cap). Otherwise fine.
  - **Q9**: Mostly fine. Real pitfalls: (a) sticky first column needs explicit `background` + `z-index` on **body** cells, not just the header (Summary.tsx:405 sets background only on `th`) — otherwise scrolled content bleeds through; (b) cap must apply after filtering (render ≤500 matches), not filter over the pre-capped set — see F5. No React-19-specific hazard in the combination.

  ## Plan-text errata
  - "VIEW_HEADERS (~line 665)" — the actual name is `VIEW_META` (App.tsx:664).
  - "SDRF_MAX_ROWS=___" — it's 500 (Summary.tsx:16).
  - Sidebar hardcoding at App.tsx:324 verified accurate; gating fields (`channels`, `studySamples`, `sdrfMember`) exist as described (store.ts:139-147).

  ## Verdict
  Direction and data flow are sound; the two blocking gaps are the `VALID_VIEWS` omission (F1) and gzip handling (F2) — both will fail on first real use if implemented exactly as written. F3–F6 need one-line decisions in the plan before implementation.

