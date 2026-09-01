• I'll start by reading the highest-priority files in parallel.

• Now the store and views.

• Now the views. Let me check sizes and read the four key ones.

• Let me check the worker entry serialization and the app worker.

• Let me verify URL-parsing claims for `localPathOf` adversarial inputs in node.

• Now let me check the grammar tests to see what's already pinned, and skim wire.ts contracts.

• Quick empirical check on `num()` fixpoint edges and `quadOf` coercion.

• One more skim — the legacy URL translation and the cache:

• Review complete. I read the full app shell + store, the contracts grammar/legacy/wire/protocol, and the core engine paths that cross layers (open, dispatch, worker entry, chrom/dia/spectrum/wavelength/scanBreakdown, EngineClient, vendored RemoteBlob). I verified parsing claims empirically in node where the WHATWG-URL semantics mattered. No P0 and no clear P1 found — the v0.9.0–0.9.2 fix code holds up well. Findings, ranked:

  ---

  ## Findings

  **1. P2 — StudyDesign's module-level SDRF cache serves the previous file's table on a same-name local open**
  `app/src/views/StudyDesign.tsx:36` + `:61` — `cacheKey = ${sourceUrl ?? "local"}::${fileName}::${sdrfMember}::${studyRunId}`, cached in a module-global that survives `reset()` and new opens. Failing sequence: open local `/a/run.mzpeak` (embedded SDRF at `sample_metadata/sdrf.tsv`, `metadata.run.id` absent) → Study tab parses SDRF-A; Start page; open local `/b/run.mzpeak` (same basename, same member path, no run id) → key is identical (`local::run.mzpeak::sample_metadata/sdrf.tsv::`) → the view serves file A's sample table, counts, and factors for file B with no refetch. *Bite judgement:* narrow but real — two same-basename local files from different directories (template pipelines, re-exports) is a genuine workflow, and the code comment's "acceptable" caveat understates it because the displayed sample metadata is simply wrong. Including the open generation in the key kills it.

  **2. P2 — Desktop pasted-path open reads the entire file into memory**
  `app/src/localFile.ts:52-55` — `readLocalFile` does `readFile(path)` (whole-file `Uint8Array`) then wraps it in an in-memory `File`. The normal file-picker path streams lazily via `Blob.slice` (per the store's own comment at `store.ts:669-672`); the pasted-path desktop open slurps. Concrete input: paste `/data/big-8GB.mzpeak` in the desktop app → ~8 GB allocation + copy → likely renderer OOM, on a file that would open in metadata-time via the picker. *Bite:* real for large files, desktop-only.

  **3. P2 — `localPathOf` silently drops a non-empty `file://` host**
  `app/src/localFile.ts:26-28` — verified in node: `file://nas-server/share/run.mzpeak` → `new URL` keeps host `nas-server`, but only `.pathname` is used → returns `/share/run.mzpeak`. On desktop this reads the wrong local path (or a confusing not-found naming a path the user never typed); on web it shows the "use Open file" message for what was a network-share URL. `file://localhost/...` is fine (WHATWG normalizes `localhost` → empty host, verified). *Bite:* user pastes a Windows UNC file URL — niche, but the failure is misleading. Non-empty, non-localhost hosts should be rejected (or mapped to `\\host\share` on Windows).

  **4. P2 — UNC paths and single-slash `file:` fall through to a bogus HTTP fetch**
  `app/src/localFile.ts:24,33-35` + `app/src/views/Idle.tsx:214`. `\\server\share\run.mzpeak` matches no branch (not `/`, not drive-letter) → `openUrl` → resolved against the viewer origin → fetch to `https://viewer/\\server\share\...` → the opaque network failure this module was written to eliminate. Same for `file:/path/run.mzpeak` (regex requires exactly `file://`). *Bite:* Windows users pasting explorer-style UNC paths — the exact audience for this feature.

  **5. P2 — `quadOf` coerces empty `roi=` fields to 0 instead of rejecting**
  `packages/contracts/src/url/grammar.ts:144-149` — `roi=1,2,,` parses as `[1,2,0,0]` because `Number("")===0`; sibling `pairOf` explicitly guards empty fields (`:124`), `quadOf` doesn't. A malformed link silently selects a rect pinned to the origin instead of being dropped. *Bite:* theoretical — needs a hand-corrupted link — but it's a one-line inconsistency in a module whose stated contract is "strict — reject rather than silently coerce."

  **6. P2 (design, stated for the record) — the share link mirrors only the ACTIVE chromatogram card**
  `app/src/urlSync.ts:248-257` — with 4 DIA fragment cards + a TIC up, the link serializes one `dia=` (the active card); the rest vanish on hydration with no notice. The link is *exact* for the active trace (mz/tol/rt/msLevel all round-trip — verified), so "honest" about what it contains, silently lossy about the workbench. Would bite a user sharing a multi-card DIA panel expecting it to survive.

  **7. P3 — smaller `localPathOf` edges** (all verified): a percent-encoded bare path (`/tmp/my%20run.mzpeak`) is *not* decoded while the `file://` form is (inconsistent; desktop not-found); a malformed `%` in a `file://` URL (`file:///tmp/100%.mzpeak`) throws in `decodeURIComponent` → `null` → bogus HTTP fetch instead of using the raw pathname; a root-relative URL (`/data/run.mzpeak`, which `openUrl` would previously have fetched fine against the origin) now hits the `startsWith("/")` branch and gets the local-path error on web. All niche.

  **8. P3 — member downloads have no open-generation guard**
  `app/src/views/Metadata.tsx:44`, `app/src/views/Structure.tsx:145,212` — a download of `mzpeak_index.json`/a member started on file A that completes after file B opened saves B's bytes under a generic filename. Narrow window, low consequence.

  **9. Comment bug worth fixing given the invariant** — `packages/core/src/adapt/browse.ts:9-11` says BrowseRow.time is "retention time in SECONDS **straight off the metadata `time` column**". The file column is minutes; the ×60 happens in `summary.ts:179`. The code is correct; the comment invites a future producer to double-convert.

  ---

  ## Numbered attack questions

  **1. `localPathOf` / Idle wiring** — findings 2, 3, 4, 7 above. Summary table (all node-verified): `file://localhost/...` ✓ correct; `file://host/...` → **host silently dropped** (finding 3); `file://C:\...` ✓ → `C:/...`; `file:/...` (1 slash) and bare UNC → **bogus HTTP fetch** (finding 4); `file:////server/...` → `//server/...` (POSIX-collapses, actually fine as UNC on Windows); `%2B`/`+` ✓; literal `?`/`#` in a `file://` URL truncates the path at the query/hash (not-found, not wrong-file). No input opens a *wrong existing file* except the host-drop case.

  **2. Store select/reselect tokens** — clean. I traced every continuation: `selectSpectrum` (success/stale/Superseded/real-error) never lets a superseded select touch `spectrumLoading`; `reselectWithSource` and the UV lane follow the same latest-owns-the-flag rule; the `spectrumPrefetchDone` re-serve can only duplicate a read of the *current* selector, never a stale one (worker gen-guard + client `phase` check; FIFO makes a stale `ionIndexReady` arrive while `phase==="loading"` and get dropped). `startChromItem`'s openSeq+loadSeq double token is sound. `ctx.scan` in the worker can never mismatch the active reader because dispatches are mutex-serialized FIFO and `open` clears it. The one thing I could not break is `spectrumLoading` sticking: the worker-crash path rejects all pending and clears the flag.

  **3. `urlSync`** — `dia=` duplicates: impossible; hydration runs once and `startChromItem` dedups by `JSON.stringify(req)`. `applyViewState` explicit-view routing: correct (`?view=` wins over the ROI convenience reroute; stale guards after every await). `currentShareUrl` diaXic honesty: see finding 6 — exact for the active card, lossy for the rest. Scan fallback: safe in practice — `scanBreakdown` is dispatched before `selectSpectrum(0)`, and worker FIFO + response FIFO guarantee `browse` is set before `hydrateFromLocation`'s continuation runs; only a scanBreakdown *failure* degrades `?scan=` to index semantics, and that already surfaces a warning notice. The cross-file contamination path (superseded hydration open resolving into a newer file's `ready` phase) is closed by the mutex: at the phase check the newer file is still `loading`, so it bails.

  **4. Grammar fixpoint** — I could not break it for any canonical query. `num()`'s exponent outputs (`1e-9`, `1e+21`) round-trip because both sides go through `URLSearchParams` (the `+` is percent-encoded); negatives and zero are exact; quantization is idempotent. `diaOf`, `chromOf("ix:…")` (kept verbatim both ways, resolved by index in `addStoredChromById`), `channelOf` colors containing `,`/`=`/`&` (re-joined after the 2nd field; encoded by `URLSearchParams`), `id:`/`ix:` canonicalization, and the view-elision rule all fixpoint. The only producer→consumer mismatch is a sub-1e-7-Da zoom (`mz=500.000000001,500.000000002` serializes to `mz=500,500`, which `ascPairOf` then rejects) — unreachable from the UI and already acknowledged in the `num()` comment. Finding 5 (`quadOf`) is the one real strictness hole.

  **5. Views** — Chromatograms DIA form validates precursor/tol/fragments and builds the ±60 s window in seconds (correct unit at the `extractChromatogram` boundary). Spectra jump-to-first-non-empty correctly skips NaN TIC (`Number.isFinite(t) && t > 0`). Wavelength matrix retry gate works (`matrixError` stops the effect loop; Retry clears it; `triedLoad` can't loop because the view unmounts on open). StudyDesign cache: finding 1. No wrong-data path found in the levelIndex/rank/absoluteOf navigation math (including the -1 MSLEVEL_ABSENT bucket).

  **6. Cross-layer units/contracts** — clean. Every MS time crosses minutes↔seconds exactly once: `summary.ts:179` (rows → seconds), `browse.ts:145` (window s→min in), `browse.ts:163` (points min→s out), `browse.ts:194` (stored chrom min→s), `wavelength.ts:200,333`. `cheapTic` filters seconds against seconds; `PeakChromMenu` and `stats.rtRange` are seconds end-to-end; the vendored `extractXIC` reads the `time` child under the same name in both layouts (verified against `COL`/`COL_FLAT`). Nothing in `app/` reads a field the wire contract doesn't guarantee. Also verified: all remote parquet/member reads (including hyparquet footer/column reads in `structure.ts:187,212`) go through `RemoteBlob._read` → `chainRead`, with the worker mutex as a second, stronger serialization layer — no bypass found.

