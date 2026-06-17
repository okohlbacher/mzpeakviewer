import { defineConfig } from "vitest/config";

// Unit tests for the app's pure logic modules (e.g. levelIndex). Deliberately NOT
// extending vite.config.ts — these tests need none of the app's react/wasm plugins
// or build-time git/version injection. Scoped to src/**/*.test.ts so vitest never
// picks up the Playwright e2e specs under e2e/ (which run via `npm run e2e`).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
