# @mzpeak/core (Phase 3 — engine)

The ONE Web Worker data engine the unified app calls. Owns the vendored `mzpeakts`
Reader, the scheduler, and the LRU cache **in-worker**; exposes every read/compute as a
typed `@mzpeak/contracts` message. Arrow/WASM/parquet handles never cross the boundary —
only the plain `wire.ts` payloads do.

**Status: skeleton only.** Build sequence, parity-gate strategy, and the Structure/Parquet
spike are in [`../../.planning/phases/03-engine-migration/SPIKE-PLAN.md`](../../.planning/phases/03-engine-migration/SPIKE-PLAN.md);
the protocol→source maps are `MAP-iv-worker.md` + `MAP-explorer-data.md` beside it.

Base = IV's worker (already off-main-thread); Explorer's main-thread data access is ported
in as the net-new messages. HIGH risk — built against golden fixtures captured from the
read-only old apps, never refactored blind.
