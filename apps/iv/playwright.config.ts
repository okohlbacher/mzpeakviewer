import { defineConfig, devices } from "@playwright/test";

// E2E runs against a real `vite preview` of the built site (built by webServer
// below) so the test exercises the REAL hashed-wasm path with NO COOP/COEP — the
// same way it ships on GitHub Pages.
const PORT = 4173;
const BASE = "/mzPeakIV/";


export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Worker-init race fixed by a ready-handshake in store.ts (loads buffer until
  // the Worker posts {type:"ready"} after its onmessage handler is registered).
  // One retry remains as a safety net for genuine WASM/network jitter.
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Main app: vite preview serving dist/ under BASE.
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
