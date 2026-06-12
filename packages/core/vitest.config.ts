import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Only the pure layer (adapters + client) is unit-tested here; the reader-I/O
    // handlers are verified end-to-end in the app (Phase 4) since they need WASM.
    include: ["src/**/*.test.ts"],
  },
});
