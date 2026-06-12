**REJECT**

---

### CRITICAL FLAWS (must fix)

**1. Worker feasibility CRITICAL — structured-clone boundary violation**
MERGE-ROADMAP.md:42-43 claims Explorer's scheduler + LRU cache are "structured-clone-safe" and port cleanly. **FALSE.** Explorer's cache holds `SpectrumArrays` (Float64Array m/z + Float32Array intensity) keyed by index — these TypedArrays are cloneable, BUT the `Reader` handle itself contains Arrow/WASM state that **cannot** cross the worker boundary. Explorer currently holds the `Reader` on main-thread (store.ts:32 `let reader: Reader | null = null`). Moving this into a worker means **every Explorer read** (spectrum, chromatogram, parquet introspection) must become a message. The roadmap understates the refactor: it's not just moving the scheduler, it's **reversing Explorer's entire architecture** from main-thread reader to worker-mediated messages. *Fix: Phase 2 scope must explicitly include rewriting all Explorer data access to go through worker protocol, not just "move scheduler".*

**2. Synchronous parquet introspection BREAKS in worker**
Explorer's `archive.ts`/`parquetDeep.ts` do synchronous Arrow table inspection (e.g., `columnTypes` reads `reader.spectrumMetadata` struct vectors directly). In a worker, these become async message round-trips. The roadmap claims "lazy Arrow-handle reads" move cleanly — they don't. Every `listArchive`, `readParquetInfo`, `deepColumn` call must be replaced with worker messages. *Missing: Phase 2 needs a worker protocol extension for archive/parquet introspection messages.*

**3. Handle lifetime / streaming reads problem**
mzPeakIV worker keeps `activeReader` + `activeZipStorage` as module globals (mzPeakWorker.ts:115,75). Explorer's current design creates a new `Reader` per file on main-thread. In the merged worker, **multiple files cannot be open simultaneously** — the worker globals are single-file. The roadmap doesn't address concurrent file handling. *Fix: Worker must support multiple reader instances or explicit close() before new open. Missing phase: "Multi-file worker session management".*

**4. Circular dependency: Phase 2 depends on Phase 1 AND Phase 0 simultaneously**
Phase 2 (engine unification) needs the unified `@mzpeak/core` worker protocol. But Phase 1 (monorepo + ui-kit) extracts shared UI components while keeping "both shells consume it and still build/deploy unchanged." This is **impossible** if Phase 2 changes the data engine boundary. Phase 1 must either (a) wait for Phase 2's protocol to be defined, or (b) not extract any components that touch data. The roadmap claims Phase 1 is "low-risk presentational only" but `ui-kit` includes "file loader" (store.ts:52) which **is** data-bound. *Fix: Reorder — Phase 0 → Phase 2 (define protocol) → Phase 1 (extract UI that uses protocol) → Phase 3.*

---

### SEVERE FLAWS

**5. Sidebar IA: imaging file with chromatograms NOT handled**
Roadmap §2:86-87 shows `Chromatograms` only for "LC-MS ONLY (file has RT / TIC column / stored chromatograms AND is not imaging)". But **imaging files can have chromatograms** (e.g., MSI with TIC per pixel). The current IV app shows chromatograms in some imaging modes. The roadmap's adaptive rule would **hide chromatograms for imaging files**, breaking existing workflows. *Fix: Add third state — chromatograms visible for imaging files that have them, hidden only when imaging AND no chromatogram source.*

**6. Mis-detection risk: `probeIsImaging` vs `readImaging` inconsistency**
mzPeakIV uses `probeIsImaging` (stats.ts:227) which checks 3 sources: promoted IMS columns, CV params, OR `metadata.imaging.is_imaging`. mzPeakExplorer uses `readImaging` (imaging.ts:53) which **only** checks `metadata.imaging.is_imaging`. A file with IMS position columns but no metadata flag would be detected as imaging in IV but NOT in Explorer. The merged app's `isImaging` gate must use **one** detection method. *Fix: Standardize on `probeIsImaging` semantics. Missing: detection parity tests.*

**7. URL redirect on static host WILL lose query strings**
Roadmap §3.4:190 claims 301-redirect `/IV/*` → `/view/*` "preserving the query string." On GitHub Pages, `netlify.toml` or `_redirects` can do this, BUT only if the server is configured. Static file hosting (S3, GH Pages without custom server) **cannot** do true 301 redirects with query preservation — they do path rewrites that drop queries. *Fix: Must use client-side redirect (`window.location` with query) OR ensure deploy infra supports query-preserving redirects. Missing: deployment infrastructure requirement.*

**8. Cross-mode ignore behavior underspecified**
§3.2:172-176 says `ion`/`xic` are "ignored with a non-fatal notice" in wrong mode. But **what notice?** Where is it shown? Does it block the requested view or just show a banner? Current IV doesn't have this — it just silently ignores. The roadmap doesn't specify the UX. *Fix: Define notice placement, severity, dismissibility. Missing: UX spec for mode mismatch.*

---

### MAJOR FLAWS

**9. Overstated savings**
§6:293-296 claims "~5–7k of the ~21.7k combined src LOC collapses." But:
- Explorer has no worker — its scheduler/cache are ~300 lines (readScheduler.ts + cache in store.ts). Moving them to worker adds **new** protocol message types, serialization, and worker handlers.
- IV's worker is 67KB of code that **cannot** be reused as-is — it's imaging-specific.
- The "one reader boundary" savings is real but the **worker protocol superset** is new code, not deleted.
*Fix: Remove the LOC savings claim or qualify it as "net long-term after deleting duplicate maintenance, not code size."*

**10. Missing phases / risks**
- **No rollback plan**: If merged app breaks imaging users, how to revert? Need `/IV/` to keep serving old app until new is proven.
- **No test strategy**: No mention of integration tests for the merged engine. Need tests that old IV links + old Explorer links both work.
- **No migration steps for users**: Existing `/IV/` bookmarks/embeds must continue working. Missing: keep old app deployed during transition period.
- **No performance regression guard**: Worker message overhead could slow down Explorer's currently-fast main-thread reads for small files.

---
### MINOR / NITS

**11. Nested accordion a11y**
§2:77-94 has nested accordions (Advanced → Metadata/Structure; MSI → Ion/Optical/Overlay/Grid). Keyboard navigation with multiple nested accordions needs explicit focus management. Roadmap doesn't mention a11y requirements.

**12. `channels=` grammar ambiguous**
§3.1:165 `channels` = `mz,tol,color;…` — the `color` format isn't specified. CSS color? Hex? Name? And `;` delimiter collides with URL encoding. Should use `|` or `,`.

**13. `scan` vs `spectrum` index confusion**
§3.1:144-145: `scan` = native scan number (stable), `spectrum` = 0-based index. But `spectrum` is also used for imaging pixel index. Same param name, different semantics. Risk of confusion in unified grammar.

---
**Verdict: REJECT** — Critical architectural infeasibility ( worker boundary violation ), circular phase dependencies, and multiple underspecified components. Requires fundamental redesign of the approach, not just revisions.
