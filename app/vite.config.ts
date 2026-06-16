import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// Per-target base (mzpeak.org `/view/`, GH Pages `/<repo>/`). Default "/" for dev.
const BASE = process.env.VITE_BASE ?? "/";

// --- Build provenance, surfaced by the About panel (MG-09) -------------------
// Version is SINGLE-SOURCED from src-tauri/tauri.conf.json (the desktop app's
// canonical version), NOT package.json (which is "0.0.0"). Read at config-eval
// time so a stale deploy is always identifiable at a glance.
const tauriConfPath = fileURLToPath(new URL("./src-tauri/tauri.conf.json", import.meta.url));
const APP_VERSION: string = JSON.parse(readFileSync(tauriConfPath, "utf8")).version ?? "0.0.0";

// Short git SHA; falls back to "dev" when git is unavailable (e.g. tarball build).
let BUILD_SHA = "dev";
try {
  BUILD_SHA = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim() || "dev";
} catch {
  BUILD_SHA = "dev";
}

// ISO timestamp captured at config-eval (Node) time — this is the Vite config,
// NOT the workflow sandbox, so Date is fine here.
const BUILD_DATE: string = new Date().toISOString();

// Point the bundler at the vendored reader's TS SOURCE (not its dist) so THIS app's
// vite-plugin-wasm processes parquet-wasm and emits a hashed .wasm asset — never an
// inlined 6.5 MB base64 blob (STACK.md). @mzpeak/core's worker imports mzpeakts, so the
// alias must apply to BOTH the main and the worker bundles.
const mzpeaktsSrc = fileURLToPath(new URL("../vendor/mzpeakts/lib/src/index.ts", import.meta.url));

export default defineConfig({
  base: BASE,
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
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
