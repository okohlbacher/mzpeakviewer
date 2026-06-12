// @mzpeak/core — the ONE Web Worker data engine.
//
// This barrel exposes the MAIN-THREAD surface (the EngineClient) + the pure
// reader→wire adapters. The worker entry (engine.worker.ts) and the reader-I/O
// handlers are added in the next slice, built against the golden parity gate
// (see ../../.planning/phases/03-engine-migration/SPIKE-PLAN.md) — not before.
//
// Layering: the `adapt/*` functions are PURE (plain data → @mzpeak/contracts wire
// types), fully unit-tested here; the handlers that call the live `mzpeakts` Reader
// are verified end-to-end in the app (Phase 4) since they need WASM.

// Main-thread protocol client
export * from "./client/EngineClient";

// Pure adapters (reader output → wire types)
export * from "./adapt/capability";
export * from "./adapt/spectrum";
export * from "./adapt/browse";
export * from "./adapt/chrom";
export * from "./adapt/footer";
export * from "./adapt/grid";
export * from "./adapt/ionImage";
