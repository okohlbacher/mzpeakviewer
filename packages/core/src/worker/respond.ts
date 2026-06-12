// The post helper handlers use to send a response back to the main thread. Centralizes
// the transfer-list discipline (MESSAGE_POLICY.transfersResult): typed-array/ArrayBuffer
// payloads are MOVED, never structured-cloned.

import type { WorkerResponse } from "@mzpeak/contracts";

/** Post a response, transferring the given buffers (their `.buffer` is detached). */
export type Respond = (res: WorkerResponse, transfer?: Transferable[]) => void;

/** Collect the transferable buffers out of a typed-array list (skips nulls). */
export function buffersOf(...arrays: (ArrayBufferView | null | undefined)[]): Transferable[] {
  const out: Transferable[] = [];
  for (const a of arrays) if (a) out.push(a.buffer as ArrayBuffer);
  return out;
}

/** Bind a Respond to a worker-global postMessage (DedicatedWorkerGlobalScope). */
export function makeRespond(post: (msg: unknown, transfer: Transferable[]) => void): Respond {
  return (res, transfer = []) => post(res, transfer);
}
