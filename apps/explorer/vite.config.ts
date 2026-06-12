import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { fileURLToPath } from "node:url";

// Served from root in dev/preview. For a GitHub Pages PROJECT page set
// VITE_BASE=/mzPeakExplorer/ at build time so asset URLs resolve under the sub-path.
const BASE = process.env.VITE_BASE ?? "/";

// The vendored reader's published dist bundle inlines the parquet-wasm binary as
// a base64 data URL. To ship the ~6.5 MB WASM as a SEPARATE hashed asset, point
// the bundler at the reader's TypeScript SOURCE so THIS app's vite-plugin-wasm
// processes parquet-wasm and emits a hashed .wasm. The `file:` dependency still
// supplies the package + its .d.ts types; this alias only redirects bundling.
const mzpeaktsSrc = fileURLToPath(
  new URL("../../vendor/mzpeakts/lib/src/index.ts", import.meta.url),
);

export default defineConfig({
  base: BASE,
  // Pinned, uncommon port so this dev server doesn't collide with other parallel
  // Vite projects (which default to 5173). strictPort fails fast instead of
  // silently drifting to another port.
  server: { port: 5188, strictPort: true },
  preview: { port: 5188, strictPort: true },
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
    assetsDir: "assets",
  },
});
