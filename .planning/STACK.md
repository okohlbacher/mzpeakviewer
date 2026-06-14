# Tech stack — validated decisions

Carried from both source projects' validated decisions (mzPeakIV CLAUDE.md +
mzPeakExplorer). These are proven in production (both apps ship on GitHub Pages +
mzpeak.org). **Pin these; do not float majors.** Re-validate only with evidence.

## Core

| Technology | Version | Purpose | Note |
|---|---|---|---|
| Vite | 8.0.16 | dev server + bundler | first-class `base` for project pages; `vite-plugin-wasm` supports v8 |
| React | 19.2.7 | UI | reader lib is framework-agnostic; React 19 is safe |
| react-dom | 19.2.7 | renderer | match react major |
| TypeScript | ~5.9 | typed source | NOT 6.x yet (ahead of typescript-eslint) |
| uPlot | 1.6.32 | spectrum plotting | mount via `useRef`, no React wrapper |
| zustand | 5.0.x | state | one unified store (Phase 1 shape) |
| lucide-react | 0.577.x | icons | |

## Reader chain (vendored mzpeakts + deps — DO NOT split majors)

| Component | Version | Note |
|---|---|---|
| mzpeakts | submodule @ `4067f84` (Phase 0) | aux-arrays + Numpress Linear; one consumption style |
| parquet-wasm | 0.7.1 | single-threaded ESM build — **no COOP/COEP needed** |
| apache-arrow | 21.1.0 | must match what parquet-wasm/arrow-js-ffi expect — **do not float major** |
| arrow-js-ffi | 0.4.3 | zero-copy Arrow FFI bridge |
| @zip.js/zip.js | 2.8.26 | ZIP container + HTTP range reads |
| hyparquet | 1.26.x | deep parquet column inspection (Explorer Structure tab) |

## Build plugins (mandatory for WASM)

| Plugin | Version | Why |
|---|---|---|
| @vitejs/plugin-react | 6.0.2 | JSX + Fast Refresh; peer vite ^8 |
| vite-plugin-wasm | 3.6.0 | imports parquet-wasm `.wasm` as ESM |

**top-level-await:** `vite-plugin-top-level-await` is **NOT used** (as built). With
`build.target: "es2022"` + modern browsers, TLA is native and parquet-wasm's init works
without the plugin — verified in node. See the note in `app/vite.config.ts`.

**Worker builds (load-bearing):** declare `worker.plugins: () => [wasm()]` in
`vite.config.ts` — without it, WASM silently breaks in production Worker bundles
(works in dev only). `@mzpeak/core`'s worker imports `mzpeakts` → parquet-wasm, so the
worker sub-build needs `vite-plugin-wasm` too. This bit mzPeakIV; it was a Phase-3 must-have.

## Dev tools

Vitest 4.x (unit), @playwright/test 1.6x (e2e — the only way to validate the real
WASM+Canvas+Worker path), ESLint ~9 (+ typescript-eslint 8, eslint-plugin-react-hooks 7),
Prettier 3.8.x.

## WASM-in-browser facts (load-bearing)

- parquet-wasm 0.7.1 is **single-threaded** → **no SharedArrayBuffer, no COOP/COEP,
  no coi-serviceworker.** Proven: both source apps run on GitHub Pages, which can't
  set those headers. Do not adopt any threads/build flag that would reintroduce
  cross-origin isolation.
- `parquet_wasm_bg.wasm` ≈ 6.5 MB uncompressed (~1.5–2 MB gzip on GH Pages). It is
  the largest asset — ship it as a separate hashed asset, **never inline** it
  (`assetsInlineLimit: 0`; do NOT use vite-plugin-singlefile).
- Set `base` per deploy target (`/view/` for mzpeak.org, `/<repo>/` for a GH Pages
  project page) via `VITE_BASE`.

## Anti-patterns (do NOT use)

| Avoid | Why | Instead |
|---|---|---|
| COOP/COEP / coi-serviceworker | parquet-wasm is single-threaded | nothing |
| vite-plugin-singlefile in prod | inlines 6.5 MB WASM as base64 | hashed multi-asset build |
| floating apache-arrow off 21.x | breaks zero-copy FFI layout | pin 21.1.0 |
| TypeScript 6 / ESLint 10 (now) | ahead of the lint toolchain | TS ~5.9, ESLint ~9 |
| a React wrapper for uPlot | re-render overhead | imperative `new uPlot` in a ref'd div |
| npm git-dependency for mzpeakts | no root package.json; needs build | git submodule + `file:` install |

## Architecture targets specific to this repo

- **`@mzpeak/core`** — one Web Worker engine; owns the reader; Arrow/WASM handles
  never cross the boundary; scheduler + LRU cache in-worker; cancellation +
  transfer lists per message.
- **`@mzpeak/ui-kit`** — tokens + presentational components only.
- **Imaging is a lazy chunk** — Canvas heatmap, optical decode, multi-channel,
  TIFF export load via dynamic `import()` behind the `isImaging` gate.
- **Design tokens are already value-equal** across both apps (`--blue-600:#3b54da`,
  identical `--text-*`/`--border-*` grays, `--focus-ring`, success green) — only
  alias names differ. Unifying them is low-risk.
