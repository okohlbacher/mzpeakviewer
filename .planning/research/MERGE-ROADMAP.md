# Roadmap v2 — Unify mzPeakIV + mzPeakExplorer into one app

**Status:** SYNTHESIZED after adversarial review (codex + vibe both REJECTED v1).
**Date:** 2026-06-12
**Supersedes:** v1 (single-file history in git). This version incorporates the
review findings; the v1→v2 changelog is at the end.

> Goal: ONE browser app that opens any `.mzpeak` and adapts to it. The general
> explorer (Summary / Spectra / Chromatograms / metadata / parquet structure) is
> always on; the imaging (MSI) visualization layer activates **only** for imaging
> files. Replaces the two separately-deployed apps (`/view/` Explorer, `/IV/`
> imaging viewer) and ends duplicated reader / design-system / deploy maintenance.

---

## 0. What the adversarial review changed (read this first)

Both reviewers rejected v1 on two structural errors and a set of factual ones:

1. **Circular phasing.** v1 migrated the engine (old Phase 2) before deciding the
   contracts (store shape, view state, deep-link replay, protocol superset) that
   the engine must satisfy. **Fix:** a *contracts-first* phase (types + spec +
   tests, zero behavior change) precedes any migration.
2. **Engine migration under-scoped.** Explorer has **no worker**; its Structure
   path uses live `reader.store`, parquet handles, Arrow vector type inspection, a
   `WeakMap` keyed by the reader, and dynamic `hyparquet` reads. Workerizing it is
   a full rewrite of Explorer's data access into messages — its own phase with
   parity/golden tests.
3. **"Worker owns everything" overstated.** `location`/`sessionStorage`, cache
   *policy*, object-URL creation, downloads, and `alert` are main-thread UI
   concerns. The boundary is drawn in §1.
4. **`scan` semantics differ.** IV `?scan=N` = 1-based displayed index; Explorer
   `scan` = native scan number. v1's "near-identity redirect" was wrong; legacy
   IV `scan=N` → `spectrum=N-1` (§3.4).
5. **Capability gating, not a boolean.** Imaging files can have chromatograms;
   nav is gated on real capabilities (`isImaging`, `numChromatograms>0`,
   `hasOptical`) with a mis-detection override (§2).
6. **Static-host redirects need real mechanism** (§3.4); **clone/transfer/paging/
   cancellation** need per-message rules (§1.2); **detection parity, a11y, and
   cross-mode notice UX** are now explicit acceptance criteria; **savings reframed**
   (§6).

---

## 1. Target architecture

```
┌──────────────────────── main thread (UI + browser policy) ────────────────────┐
│ Unified shell (Explorer base) · adaptive capability sidebar · ONE zustand store │
│ deep-link resolver/replay · view state · settings policy · uPlot · Canvas paint │
│ DOM-bound ops: object URLs, downloads, new tabs, sessionStorage, window.location │
│ lazy-loaded MSI chunk (Canvas heatmap / optical decode / multi-channel / TIFF)  │
└───────────────────────────────┬─────────────────────────────────────────────────┘
                                 │  typed protocol (request/response, transfer lists)
┌───────────────────────────────▼─────────────────────────────────────────────────┐
│ @mzpeak/core — ONE Web Worker engine                                              │
│ • owns the mzpeakts Reader (Arrow/WASM handles NEVER cross the boundary)          │
│ • scheduler (priority/background lanes) + LRU spectrum-cache STORAGE, in-worker   │
│ • reads & compute as messages: open/close, scanBreakdown, selectSpectrum,         │
│   extractChrom(TIC/XIC/stored), archiveList, parquetFooter, deepColumn,           │
│   sampleColumn, studyMeta, renderIonImage, renderMultiChannel, meanSpectrum(ROI), │
│   opticalImage, grid; each with explicit cancellation + transfer rules            │
│ • returns plain typed arrays / ImageData / plain JSON only                        │
└──────────────────────────────────────────────────────────────────────────────────┘

@mzpeak/ui-kit — design tokens + PURELY PRESENTATIONAL components (spectrum plot,
metadata JSON tree, structure/parquet inspector view, cv/format utils). No reader,
no store, no imaging assumptions. (Data-bound widgets like the file loader are
wired in the shell, not here.)
```

### 1.1 Boundary — what is NOT in the worker (review #2, #4)

Stays on the main thread: view/tab state; settings *policy* (read `location`/
`sessionStorage`, decide preload/cacheMB — the worker only enforces the cache
*budget* it's told); deep-link parse/replay/orchestration; all DOM/browser ops
(object URLs, `<a download>`, `window.open`, notices). **Raw archive-member
downloads (up to 256 MB) do not round-trip as structured-cloned worker results** —
the worker streams/returns a transferable `ArrayBuffer` (or the shell fetches the
byte range directly), never a cloned copy.

### 1.2 Clone / transfer / cancellation rules (review #10)

Every protocol message declares: (a) **transfer vs clone** — large typed arrays
(spectra, ion-image `ImageData`, member bytes) use `postMessage` transfer lists,
never deep clone; (b) **size cap + paging** — member reads and deep-column samples
are capped and paged; (c) **cancellation** — every long read carries a request id
and is abortable (supersedes Explorer's "wait for one in-flight read" model);
(d) **buffer ownership** — buffers the worker must retain (cache) are cloned on the
way out, transferred only when single-use. Single open file per worker session;
`open` implies `close` of the prior reader (multi-file is out of scope — stated, not
assumed).

---

## 2. Sidebar information architecture (capability-gated)

A grouped, **capability-adaptive** rail. Gating is by detected capabilities, not a
single `isImaging` flag (review #5, #8). A single `view` id is the active selection.

```
ALWAYS
  ▸ Summary                      (overview readout incl. imaging block)
  ▸ Spectra                      (per-spectrum / per-pixel spectrum)

  ▸ Chromatograms                shown when numChromatograms>0 OR a TIC column exists
                                 (INDEPENDENT of imaging — an MSI file with stored
                                  chromatograms still shows this)

  ▾ Advanced            ◀ accordion, collapsed by default (auto-expands on deep link)
      • Metadata               (deep JSON / CV-aware tree)
      • Structure              (parquet inspection: members, row-groups, columns)

IMAGING (when isImaging)
  ▾ Imaging (MSI)       ◀ accordion, expanded by default in imaging mode; lazy chunk
      • Ion image              (default = TIC spatial overview; single + multi-channel)
      • Optical                (shown only when hasOptical)
      • Overlay                (shown only when hasOptical; ion ⊕ optical blend)
      • Grid                   (grid diagnostics + the imaging-detection override)
```

**Capability inputs:** `isImaging` (standardized on IV's `probeIsImaging`
3-signal semantics — promoted IMS columns OR CV params OR `metadata.imaging`,
review #6), `numChromatograms`/`hasTicColumn`, `hasOptical`. A **detection
override** lives in MSI ▸ Grid (and in Summary when ambiguous): a file with IMS
position columns but no `metadata.imaging` flag, or vice-versa, can be force-on /
force-off, with the discrepancy surfaced. Detection-parity tests are an acceptance
criterion.

**Shared routing:** clicking a pixel in **Ion image**, or committing an **ROI**
rectangle, selects/derives a spectrum and routes to **Spectra** — preserving IV's
file→image→pixel→spectrum loop.

**Accessibility (acceptance criteria, review #9, #11):** the rail is a proper
`tablist`/`tab`/`tabpanel` with roving `tabindex`; accordions are
`button[aria-expanded]` controlling a region; Enter/Space/Arrow keys work;
deep-link targets auto-expand their accordion and move focus to the active tab.
(Current code uses `div role=button` with click-only — this phase fixes that, it
does not inherit it.)

**Old → new placement** (unchanged from v1): Summary→top; Spectra→top;
Chromatograms→top (capability-gated); Metadata→Advanced; Structure→Advanced; IV
`overview`→default of MSI▸Ion image; IV `ion`/`multi`→MSI▸Ion image;
`optical`→MSI▸Optical; `blend`→MSI▸Overlay; GridDiagnostics→MSI▸Grid; Settings→gear.

---

## 3. Unified URL / deep-link grammar

### 3.1 Parameters

**Global**

| Param | Value | Meaning |
|---|---|---|
| `file` (alias `url`) | absolute `http(s)` URL | dataset (CORS + byte-range); URL-encode if it has `?`/`&` |
| `view` (alias `tab`) | `summary\|spectra\|metadata\|structure\|chromatograms\|ion\|optical\|overlay\|grid` | active view; authoritative |
| `scan` | integer | spectrum by **native scan number** (Explorer semantics; stable) |
| `spectrum` | integer | spectrum by **0-based index** (fallback) |
| `px` | `x,y` | imaging **pixel** by grid coords → its spectrum (NEW, imaging-clear) |
| `ms` | integer | MS-level filter |
| `mz` | `lo,hi` | spectrum-plot zoom |
| `preload` | `0\|1` · `cacheMB` (alias `cache`) | settings |

**LC-MS** (ignored + info notice on imaging-only files)

| Param | Value | Meaning |
|---|---|---|
| `chrom` | `tic \| id:<id> \| ix:<index>` | TIC, or stored chromatogram by **id** or **index** (disambiguated — review #6) |
| `xic` | `mz,delta` · `xicmz` `lo,hi` · `rt` `start,end` | XIC + RT window → chromatogram |

**Imaging (MSI)** (ignored + info notice on non-imaging files)

| Param | Value | Meaning |
|---|---|---|
| `ion` | `mz[,tol]` | ion image at `mz` ± `tol` Da → spatial map (legacy alias: `ion=mz` + `&tol=`) |
| `ch` (repeatable) | `mz,tol,color` | multi-channel ion image; one `ch=` per channel, order = z-order (NEW — avoids the `;`-delimiter collision of v1) |
| `roi` | `x0,y0,x1,y1` | ROI rect (grid coords) → mean spectrum |
| `optical` | `<index\|name>` | select optical image (resource) |
| `overlay` | `0\|1` | toggle overlay/blend (view = overlay; `optical` selects the resource — view vs resource separated, review #6) |

### 3.2 Conflict matrix + canonicalization (review #6)

- **`view`/`tab` is authoritative.** When absent, infer (§3.3).
- **`ion` vs `xic`** — same m/z input, different output view; each valid only in its
  file mode; the other is ignored + notice.
- **`scan` vs `spectrum` vs `px`** — `scan` > `px` > `spectrum`. Exactly one selects
  the spectrum; the rest are dropped (logged).
- **`optical` (resource) vs `overlay`/`view=optical` (view)** — independent; a link
  may carry both.
- **Mixed spectrum + chromatogram/imaging** — both applied; the data view shows
  first, the spectrum stays selected (matches Explorer today). Canonical serialized
  order is fixed so Share-view links are stable.
- A **regression corpus** of mixed-mode links is a Phase-5 acceptance gate.

### 3.3 View inference (when `view`/`tab` absent)

1 explicit `view`/`tab`; 2 imaging file: `ch` > `ion` > `roi` > `overlay`/`optical`;
3 LC file: `xicmz` > `xic` > `chrom`; 4 else `scan`/`px`/`spectrum` → spectra; 5 else summary.

### 3.4 Link stability (review #3, #7 — corrected)

Param **names** are preserved, but two real translations exist:
- **Legacy IV `scan=N` is a 1-based index, not a native scan number** → the `/IV/`
  shim rewrites `scan=N` → `spectrum=N-1`. Unified `scan` keeps Explorer's
  native-number meaning.
- **Legacy IV `&tol=`** folds into `ion=mz,tol`.

**Redirect mechanism is per-target (static hosts can't do query-preserving 301s):**
- **mzpeak.org** (rsync server): server-level redirect *or* a published `/IV/index.html`
  client-shim — whichever the host supports; query string explicitly carried.
- **GitHub Pages** (`okohlbacher.github.io/mzPeakIV/`, no server config): a committed
  `/IV/index.html` **client-side redirect shim** that reads `location.search`,
  applies the legacy translation, and `location.replace`s to `/view/`.
- Query-preservation + translation are covered by redirect tests (Phase 5).

| Old link | Resolves via |
|---|---|
| `/IV/?ion=445.1&tol=0.1&scan=2` | shim → `/view/?ion=445.1,0.1&spectrum=1` |
| `/IV/?optical=0` | shim → `/view/?optical=0` (view inferred = optical) |
| `/view/?file=…&xic=445,0.1&tab=spectra` | identity (`tab`→`view` alias) |

### 3.5 Cross-mode notice UX (review #8)

A **non-blocking, dismissible info banner** (not the error banner) below the top
bar: e.g. *"This link asked for an ion image, but this file isn't imaging —
showing Summary."* Severity = info; auto-dismiss optional; never blocks the
fallback view.

---

## 4. Phased roadmap (reordered: contracts before migration)

MVP vertical slices; each bracketed by PROC-01 codex round1 (plan) + round2 (diff).

### Phase 0 — Reader convergence  *(prerequisite; in flight)*
One vendored `mzpeakts` with aux-arrays **and** Numpress Linear (land
HUPO-PSI/mzpeakts#1), single consumption style (submodule), reconcile
`DataArrays`/`Reader` type deltas, both apps green. **Deliverable:** identical
reader, no local patches. **Risk:** low (gated on PR merge; fallback = fork pin).

### Phase 1 — Unified contracts  *(NEW — breaks the circularity)*
**Types + spec + tests, ZERO behavior change.** Define: the **superset worker
protocol** (every IV imaging message + every Explorer browse/archive/parquet/scan/
chrom/study message), with per-message clone/transfer/cancellation annotations
(§1.2); the **unified store shape** + view-state model; the **capability model**
(§2); the **URL grammar + conflict matrix + canonicalization** (§3) as a pure
parse/serialize module with unit tests (incl. legacy `/IV/` translation). No engine
or UI migration yet. **Deliverable:** `@mzpeak/contracts` (protocol types, store
types, url module) + a spec doc + passing parser/canonicalization tests. **Risk:**
low; **this is the keystone** the engine and shell are built against.

### Phase 2 — Shared ui-kit  *(presentational only)*
Monorepo workspace; `@mzpeak/ui-kit` = design tokens + **purely presentational**
components (uPlot spectrum plot, metadata JSON tree, structure/parquet inspector
*view*, cv/format utils). Data-bound widgets (file loader) excluded — wired later in
the shell. Both existing shells consume the tokens/components, behavior unchanged.
**Deliverable:** one design system + shared presentational components; both apps
visually identical; tests green. **Risk:** low.

### Phase 3 — Engine migration `@mzpeak/core`  *(the hard phase; its own slice)*
Implement the Phase-1 protocol as ONE worker engine: owns the reader; scheduler +
cache STORAGE in-worker; **rewrite all Explorer data access** (archiveList,
parquetFooter, deepColumn, sampleColumn, scanBreakdown, XIC/stored chrom, studyMeta)
as messages with cancellation/transfer/paging; merge IV's imaging handlers. Both
shells call the engine via thin adapters. **Parity is the gate:** golden-output
tests compare new-engine results to the old main-thread/worker outputs for both an
imaging and an LC fixture. **Deliverable:** both apps' data paths run through the
single worker; imaging + LC e2e green; lazy-read + cache behavior preserved.
**Risk:** HIGH. **Mitigation:** behind unchanged UX; golden + e2e guards; the
"file→ion-image→spectrum must always work" invariant under e2e.

### Phase 4 — Unified shell + capability sidebar
Explorer-based shell with the §2 capability-gated rail (Advanced accordion =
Metadata+Structure; Chromatograms capability-gated; MSI accordion isImaging-gated,
**lazy-loaded**); merge the two zustand stores into the Phase-1 shape; wire
pixel→spectrum + ROI→spectrum; implement the §2 a11y acceptance criteria + the
detection-override UI. **Deliverable:** one app adapting nav to capabilities;
imaging UI lazy-loaded; both demo files fully navigable; a11y tests pass. **Risk:**
medium.

### Phase 5 — Unified URL resolver + link stability
Wire the Phase-1 url module into the shell (parse → replay; serialize ← Share-view);
implement the §3.2 conflict resolution, §3.4 per-target redirect shims (incl. the
`scan=N→spectrum=N-1` legacy translation), §3.5 notice UX; ship the **old-link
regression corpus** + redirect/query-preservation tests. **Deliverable:** one
resolver; old IV + Explorer links resolve; Share-view round-trips. **Risk:** medium.

### Phase 6 — Safety harness + single deploy + decommission
**Before** flipping deploys: compatibility harness (golden engine outputs, imaging+LC
e2e, redirect tests, worker-cancellation tests, **performance + memory budgets** for
worker round-trip vs old main-thread reads), and a **rollback path** that keeps the
old `/IV/` and `/view/` artifacts deployable during a canary window. Then collapse
the combined-site build to one section (unified app at `/view/`, `/IV/` shim),
consolidate fixtures, update docs, decommission. **Deliverable:** one app live on
mzpeak.org + GitHub Pages; old paths redirect; CI green; rollback documented.
**Risk:** low–medium (deploy blast radius surfaced before running, per policy).

### (Optional) Phase 7 — extras
`ch=` multi-channel + `roi=` + `px=` deep-link capabilities beyond parity, if not
already folded into Phases 4–5.

**Dependency order:** 0 → 1 → {2, 3} (2 and 3 both depend only on 1; can overlap) →
4 → 5 → 6. Phase 1 is the keystone; nothing migrates before it.

---

## 5. Decisions for the operator (blocking where noted)

1. **[BLOCKING] Repo home:** fresh monorepo `mzpeakviewer`, or restructure the
   mzPeakExplorer repo in place (UI base)? Determines where Phase-1+ work and the
   GSD milestone live. *Recommend: restructure Explorer in place as the workspace
   root (it's the UI base; preserves the resolver's `/view/` URL + issue history).*
2. **App name & URL:** keep `/view/` unified path (best link stability) + `/IV/`
   shim. *Recommend yes.*
3. **Workspace tool:** npm workspaces (matches toolchain) vs pnpm. *Recommend npm.*
4. **mzpeakts post-merge:** single submodule (recommended) vs in-tree copy.
5. **Phase 7 scope:** in, or backlog?

---

## 6. Savings vs cost (reframed — review #9/#11)

**This is a consolidation effort whose payoff is ongoing, not a code-size dump.**
Unification *adds* protocol + adapters + parity tests *before* it removes
duplication; LOC reduction is a **measured outcome after Phase 4**, not a promise.

- **Ongoing (the prize):** format-instability fixes, reader/parquet-wasm bumps,
  design changes, and deploys applied **once** not twice. With mzPeak explicitly
  unstable, removing this 2× tax is the headline ROI. (Combined `src` is ~14.4k LOC
  IV + ~9.1k Explorer.)
- **Consolidated first:** one reader boundary, one design system, one deploy, one
  vendored mzpeakts. LOC collapse in the spectrum/metadata/structure/file-loader
  stacks is realized in Phase 4, measured then.
- **Bundle:** non-imaging users stop downloading imaging code (lazy chunk); imaging
  users gain the full explorer.
- **UX:** one "open any mzPeak" tool — no "which tool?".

**Top risks:** Phase 3 engine unification (long pole); single point of failure (one
bug breaks both audiences → imaging round-trip + parity under permanent e2e guard);
link/deploy stability (§3.4 + Phase 6 rollback).

---

## v1 → v2 changelog
- Inserted **Phase 1 (Unified contracts)**; split engine into its own **Phase 3**;
  reordered so contracts precede migration (fixes circular dependency).
- Drew the **worker/main-thread boundary** explicitly; large downloads don't clone.
- Added **clone/transfer/cancellation/paging** rules per message.
- Nav gated on **capabilities** (chromatograms independent of imaging) + detection
  override + parity tests.
- Corrected **`scan` semantics** + legacy `scan=N→spectrum=N-1`; per-target redirect
  shims; query-preservation tests.
- Fixed `channels` → repeatable `ch=`; disambiguated `chrom` id-vs-index; separated
  `optical` resource from `overlay` view; added `px=`.
- Added **a11y acceptance criteria** and **cross-mode notice UX**.
- Added **Phase 6 safety harness + rollback**; **reframed savings**.
