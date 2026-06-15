/// <reference lib="webworker" />
// The Web Worker entry. Thin: it owns one EngineContext, registers an onmessage that
// routes to dispatch(), and posts {type:"ready"} once (the client buffers requests
// until it sees this, past the WASM top-level-await init). All the logic is in
// dispatch.ts (node-testable); this file is the only browser-Worker-bound piece and is
// verified end-to-end in the app (Phase 4).
import type { WorkerRequest } from "@mzpeak/contracts";
import { dispatch, createContext, startIonPrefetch, startSpectrumPrefetch } from "./dispatch";
import { makeRespond } from "./respond";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const ctx = createContext();
const respond = makeRespond((msg, transfer) => scope.postMessage(msg, transfer));

// Message types that are USER-driven signal reads. Receiving one marks user activity so
// the background ion-cache prefetch backs off (PREFETCH_COOLDOWN_MS) and the user stays
// responsive.
const USER_READ_TYPES = new Set<WorkerRequest["type"]>([
  "selectSpectrum",
  "renderIonImage",
  "renderMultiChannel",
  "meanSpectrum",
  "roiSpectrum",
  "extractChrom",
  "getOpticalImage",
]);

// Serialize ALL reader access through ONE mutex (the mzpeakts/parquet-wasm reader is
// single-threaded / non-reentrant). The mutex — not the old per-dispatch tail — is now
// the single gate: dispatched requests AND the fire-and-forget background prefetch both
// acquire it, so they never race the reader, yet the prefetch releases between chunks so
// a user request interleaves after at most one in-flight chunk (bounded soft-preempt).
// `dispatch` posts its own error per request; this .catch logs an UNEXPECTED throw rather
// than swallowing it, so a worker fault is visible instead of a silently hung request.
scope.addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg && USER_READ_TYPES.has(msg.type)) {
    ctx.lastUserActivity = typeof performance !== "undefined" ? performance.now() : 0;
  }
  void ctx.mutex
    .runExclusive(() => dispatch(msg, ctx, respond))
    .then(() => {
      // After a file opens, warm the right cache in the background (interruptible; yields to
      // user reads via the same mutex): imaging → the ion-image cache (emits ionIndexReady);
      // non-imaging (LC/DDA) → the MS0/1 spectrum LRU. Both no-op when not applicable.
      if (msg && msg.type === "open") {
        startIonPrefetch(ctx, respond);
        startSpectrumPrefetch(ctx);
      }
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[engine.worker] unhandled dispatch error:", err);
    });
});

// Announce readiness (the EngineClient flushes its outbox on this).
scope.postMessage({ type: "ready" });
