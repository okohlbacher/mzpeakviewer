/// <reference lib="webworker" />
// The Web Worker entry. Thin: it owns one EngineContext, registers an onmessage that
// routes to dispatch(), and posts {type:"ready"} once (the client buffers requests
// until it sees this, past the WASM top-level-await init). All the logic is in
// dispatch.ts (node-testable); this file is the only browser-Worker-bound piece and is
// verified end-to-end in the app (Phase 4).
import type { WorkerRequest } from "@mzpeak/contracts";
import { dispatch, createContext } from "./dispatch";
import { makeRespond } from "./respond";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const ctx = createContext();
const respond = makeRespond((msg, transfer) => scope.postMessage(msg, transfer));

// Serialize dispatches: the mzpeakts/parquet-wasm reader is single-threaded, so
// process one request fully before the next (review CRITICAL — avoids concurrent
// reads racing on the one reader; the open generation-guard in dispatch handles
// supersession). Errors are swallowed here (each dispatch posts its own error).
let tail: Promise<void> = Promise.resolve();
scope.addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
  tail = tail.then(() => dispatch(e.data, ctx, respond)).catch(() => {});
});

// Announce readiness (the EngineClient flushes its outbox on this).
scope.postMessage({ type: "ready" });
