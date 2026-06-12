import { defineConfig } from "vitest/config";
import wasm from "vite-plugin-wasm";
import { fileURLToPath } from "node:url";

// Point the bundler/test runner at the vendored mzpeakts TypeScript SOURCE (not its
// dist), and run it through vite-plugin-wasm + top-level-await — the same pipeline the
// IV app/tests use (mzPeakIV/vite.config.ts). This lets the reader's parquet-wasm +
// top-level-await imports resolve in vitest's node environment, so the LC GOLDEN test
// (engine/lc.golden.test.ts) can open a real fixture exactly like the app does.
const mzpeaktsSrc = fileURLToPath(
  new URL("../../vendor/mzpeakts/lib/src/index.ts", import.meta.url),
);

export default defineConfig({
  // Only vite-plugin-wasm is needed: the mzpeakts source has no top-level await, and
  // node 22's ESM supports it natively for parquet-wasm's internal init (so the
  // top-level-await plugin — which pulls in esbuild — is intentionally omitted).
  plugins: [wasm()],
  resolve: {
    alias: {
      mzpeakts: mzpeaktsSrc,
    },
  },
  test: {
    globals: true,
    // Node 22 provides Blob/fetch/WASM on the global; the reader needs them.
    environment: "node",
    // The pure adapter/client tests PLUS the reader-I/O golden tests (which need the
    // WASM pipeline above) live under src/.
    include: ["src/**/*.test.ts"],
    // WASM init + the first Parquet read against a real fixture can be slow.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
