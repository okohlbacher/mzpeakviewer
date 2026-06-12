import { defineConfig } from "@playwright/test";

// Smoke the BUILT app (vite preview of dist) — the only way to validate the real
// worker + WASM + Canvas path in a browser.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
