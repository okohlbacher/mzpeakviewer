// Instantiate the engine: one Web Worker + the main-thread EngineClient. The worker
// URL is resolved relative to this module so Vite bundles `worker.ts` (and the engine
// + mzpeakts/parquet-wasm it imports) as a worker chunk.
import { EngineClient } from "@mzpeak/core";

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

/** The single engine client for the app session. */
export const engine = new EngineClient(worker);
