import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath } from "node:url";

// GitHub Pages project-page base. This is a PLACEHOLDER — the final repo path is
// finalized/hardened in Phase 5 (see SKELETON.md "Deployment"). For local dev /
// preview / CI it does not matter; for a project page it must be `/<repo>/`.
const BASE = process.env.VITE_BASE ?? "/mzPeakIV/";

// The vendored reader's PUBLISHED bundle (dist/mzpeakts.js) inlines the
// parquet-wasm binary as a base64 data URL (vite-plugin-wasm lib mode). To ship
// the WASM as a SEPARATE hashed asset (STACK.md: never inline the ~6.5 MB wasm),
// we point the bundler at the reader's TypeScript SOURCE instead of its dist, so
// THIS app's vite-plugin-wasm processes parquet-wasm and emits a hashed .wasm.
// The `mzpeakts` file: dependency still provides the package + its .d.ts types;
// this alias only redirects module resolution for bundling/test.
const mzpeaktsSrc = fileURLToPath(
  new URL("../../vendor/mzpeakts/lib/src/index.ts", import.meta.url),
);

// NOTE: intentionally no cross-origin-isolation response headers, no wasm
// service-worker shim, and no single-file inlining plugin. parquet-wasm 0.7.1 is
// single-threaded ESM and needs none of those (STACK.md).
export default defineConfig({
  base: BASE,
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: {
      mzpeakts: mzpeaktsSrc,
    },
  },
  build: {
    target: "es2022",
    // Never inline the wasm — keep it a hashed asset for caching.
    assetsInlineLimit: 0,
    // Explicit default: vite-plugin-top-level-await@1.6.0 reads config.build.assetsDir
    // in its `config` hook; omitting it leaves the value undefined in the Worker
    // sub-build context (Vite 8 + rolldown don't always inherit this default),
    // which causes path.join(undefined, "[name].js") to throw.
    assetsDir: "assets",
  },
  // CRITICAL: repeat wasm+topLevelAwait for Worker bundles — omitting this causes
  // production builds to fail with "ESM integration proposal for Wasm is not supported".
  // Leave format at default (iife) for Firefox compatibility (RESEARCH.md §Anti-Patterns).
  worker: {
    plugins: () => [wasm(), topLevelAwait()],
  },
});
