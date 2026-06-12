# Phase 5 — Unified URL Resolver + Link Stability

**Depends on:** Phase 4 · **Requirements:** URL-01…URL-07 · **Risk:** medium · **UI:** yes

**Goal:** Wire the Phase-1 URL module into the shell (parse→replay on load;
serialize←Share-view), implement the conflict resolution + canonicalization, the
cross-mode "ignored + info notice" UX, and legacy link stability.

**Unified grammar (view-centric):** `file/url`, `view`(alias `tab`), `scan`(native
number), `spectrum`(0-based), `px=x,y`, `ms`, `mz=lo,hi`, settings; **LC:**
`chrom=tic|id:<id>|ix:<n>`, `xic=mz,delta`, `xicmz`, `rt`; **MSI:** `ion=mz[,tol]`,
repeatable `ch=mz,tol,color`, `roi=x0,y0,x1,y1`, `optical`, `overlay`. `ion`-vs-`xic`
disambiguated by view/file-mode; conflict matrix canonicalized.

**Link stability (per-target):** `/IV/*`→`/view/*` carrying the query — committed
client-side `index.html` shim for GitHub Pages + server/redirect for mzpeak.org;
translate legacy `scan=N→spectrum=N-1` and `&tol=`→`ion=mz,tol`.

**Gate:** old-link regression corpus (`/IV/?ion=…&scan=…`, `/IV/?optical=…`,
`/view/?xic=…&tab=…`, `/view/?chrom=tic&rt=…`) all resolve; query-preservation tests.

**Deliverable:** one resolver; old IV + Explorer links resolve; Share-view round-trips.

Full detail: [../../ROADMAP.md](../../ROADMAP.md) → Phase 5. Run `/gsd:plan-phase 05`.
