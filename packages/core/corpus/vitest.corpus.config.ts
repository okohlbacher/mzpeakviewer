// Standalone vitest config for the corpus open-test harness (NOT part of `npm test`).
// Mirrors ../vitest.config.ts (same WASM pipeline + mzpeakts-source alias) but points
// the include at corpus/** and lifts the timeout to an hour for a long sweep.
import { defineConfig } from "vitest/config";
import wasm from "vite-plugin-wasm";
import { fileURLToPath } from "node:url";

const mzpeaktsSrc = fileURLToPath(
  new URL("../../../vendor/mzpeakts/lib/src/index.ts", import.meta.url),
);

export default defineConfig({
  plugins: [wasm()],
  resolve: { alias: { mzpeakts: mzpeaktsSrc } },
  test: {
    globals: true,
    environment: "node",
    include: ["corpus/**/*.test.ts"],
    testTimeout: 3_600_000,
    hookTimeout: 120_000,
  },
});
