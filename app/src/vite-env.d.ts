/// <reference types="vite/client" />

// Build-time constants injected by Vite `define` (see app/vite.config.ts).
// Single-sourced provenance surfaced by the About panel.
declare const __APP_VERSION__: string; // from app/src-tauri/tauri.conf.json
declare const __BUILD_SHA__: string; // short git SHA, or "dev" when git is absent
declare const __BUILD_DATE__: string; // ISO timestamp at build time
