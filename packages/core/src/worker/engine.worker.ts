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

scope.addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
  void dispatch(e.data, ctx, respond);
});

// Announce readiness (the EngineClient flushes its outbox on this).
scope.postMessage({ type: "ready" });
