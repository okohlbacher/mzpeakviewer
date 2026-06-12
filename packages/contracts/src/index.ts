// @mzpeak/contracts — the Phase-1 keystone surface.
//
// Everything the engine (@mzpeak/core) and shell are built against:
//   - the superset worker protocol + per-message clone/transfer/cancellation policy
//   - the plain wire payload types (structured-clone / transfer safe)
//   - the capability model (imaging detection, chromatogram + optical capability)
//   - the unified store + view-state model
//   - the URL grammar (parse / resolve / serialize) + legacy `/IV/` translation
//
// No reader, no engine, no UI — types + a pure URL module + tests only.

export * from "./wire";
export * from "./protocol";
export * from "./capability";
export * from "./store";
export * from "./url";
