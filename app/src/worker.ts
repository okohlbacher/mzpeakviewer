// The app's Web Worker entry. Side-effect import runs @mzpeak/core's engine in the
// worker context (it registers self.onmessage + posts "ready"). Kept as a thin app-
// local file so Vite bundles it as a worker with the wasm + top-level-await plugins
// (vite.config worker.plugins) — the engine pulls mzpeakts → parquet-wasm.
import "@mzpeak/core/worker";
