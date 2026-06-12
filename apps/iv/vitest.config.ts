import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Reuse the Vite pipeline (wasm + top-level-await + the mzpeakts source alias) so
// the reader's WASM/Arrow imports resolve identically in unit tests.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // The reader needs a browser-like global (Blob, fetch, WASM). Node 22 has
      // these on the global, but jsdom gives DOM bits the UI store may touch.
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      // Polyfills that must be defined before any module is imported by tests.
      setupFiles: ["./src/test-setup.ts"],
      // The WASM init + first Parquet read against a real ~2 MB fixture can be slow.
      testTimeout: 30000,
      hookTimeout: 30000,
    },
  }),
);
