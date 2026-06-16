#!/usr/bin/env bash
#
# build-frontend.sh — the SINGLE owner of the desktop frontend build.
#
# This is wired as tauri.conf.json `build.beforeBuildCommand`, so it runs on every
# `tauri build` and every CI release build. It MUST be self-contained: it has to
# succeed on a clean checkout with NO pre-existing node_modules. The desktop CI
# workflow (.github/workflows/desktop.yml) does NOT duplicate any reader / contracts
# / app build step — it only checks out (submodules: recursive), sets up Node + Rust,
# runs the typecheck gate, then calls tauri-action which triggers THIS script.
#
# Ordered body (do not reorder — each step feeds the next):
#   1. init the vendored mzpeakts reader submodule
#   2. build the reader (unconditional — no stale-dist guard; npm ci on its stable lockfile)
#   3. root `npm install` (materializes workspace symlinks; matches deploy.yml — NOT npm ci,
#      so lockfile drift on main never blows up the rarely-run release matrix)
#   4. build @mzpeak/contracts (its dist types feed @mzpeak/core and app — explicit ordering)
#   5. rm -rf app/dist (kill any stale /mzpeakviewer/ project-page dist)
#   6. VITE_BASE=/ app-only build (desktop base "/", so assets resolve under tauri://localhost/)
#   7. GUARD: assert the built index.html references /assets/ (root base), else fail loud
#
# typecheck is intentionally NOT here — it is a separate CI gate (mirrors deploy.yml) so
# local `tauri dev`/`tauri build` iteration stays fast.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

echo "==> build-frontend.sh: ROOT=$ROOT"

# 1. vendored reader submodule (|| true: a CI checkout with submodules:recursive has it already)
echo "==> [1/7] git submodule update --init vendor/mzpeakts"
git submodule update --init vendor/mzpeakts || true

# 2. build the vendored reader (unconditional — the dist-exists guard is deliberately removed)
echo "==> [2/7] build vendored reader (npm ci && npm run build)"
( cd vendor/mzpeakts/lib && npm ci && npm run build )

# 3. root install (npm install, NOT npm ci — release resilience, matches deploy.yml)
echo "==> [3/7] root npm install"
npm install

# 4. contracts (dist types feed @mzpeak/core and app)
echo "==> [4/7] build @mzpeak/contracts"
npm run build -w @mzpeak/contracts

# 5. drop any stale dist (e.g. a prior /mzpeakviewer/ project-page build)
echo "==> [5/7] rm -rf app/dist"
rm -rf app/dist

# 6. app ONLY, desktop base "/" (NOT the root `npm run build` — avoids re-running contracts).
# vite.config defaults base to "/" when VITE_BASE is unset, so we UNSET rather than pass a
# literal "/": on Windows git-bash, MSYS path-conversion rewrites a bare `VITE_BASE=/` to the
# Git install dir (e.g. C:/Program Files/Git), which produced a non-root asset base and tripped
# the guard below. Unsetting also clears any inherited deploy base (e.g. /mzpeakviewer/).
echo "==> [6/7] build @mzpeak/app (base defaults to / when VITE_BASE is unset)"
unset VITE_BASE
npm --workspace @mzpeak/app run build

# 7. guard: the bundled app MUST use the root asset base, or assets 404 under tauri://
echo "==> [7/7] guard: assert app/dist/index.html uses /assets/ base"
grep -q 'src="/assets/' app/dist/index.html || {
  echo 'ERROR: app/dist not built with a root "/" asset base (assets would 404 under tauri://)'
  exit 1
}

echo "==> build-frontend.sh: OK — app/dist ready for the desktop bundle"
