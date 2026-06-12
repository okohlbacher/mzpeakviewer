import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { fileURLToPath } from "node:url";

// Per-target base (mzpeak.org `/view/`, GH Pages `/<repo>/`). Default "/" for dev.
const BASE = process.env.VITE_BASE ?? "/";

// Point the bundler at the vendored reader's TS SOURCE (not its dist) so THIS app's
// vite-plugin-wasm processes parquet-wasm and emits a hashed .wasm asset — never an
// inlined 6.5 MB base64 blob (STACK.md). @mzpeak/core's worker imports mzpeakts, so the
// alias must apply to BOTH the main and the worker bundles.
const mzpeaktsSrc = fileURLToPath(new URL("../vendor/mzpeakts/lib/src/index.ts", import.meta.url));

export default defineConfig({
  base: BASE,
  plugins: [react(), wasm()],
  resolve: {
    alias: { mzpeakts: mzpeaktsSrc },
  },
  // CRITICAL (STACK.md / bit IV once): the engine WORKER imports mzpeakts → parquet-wasm,
  // so the worker sub-build also needs vite-plugin-wasm. Without it, production worker
  // bundles fail with "ESM integration proposal for Wasm is not supported".
  // (top-level-await plugin omitted: target es2022 + modern browsers support TLA
  // natively, and parquet-wasm's init works without it — verified in node.)
  worker: {
    format: "es",
    plugins: () => [wasm()],
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0, // never inline the ~6.5 MB wasm — keep it a hashed asset
    assetsDir: "assets",
  },
});
