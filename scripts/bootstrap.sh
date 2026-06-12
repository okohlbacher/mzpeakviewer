#!/usr/bin/env bash
# Fresh-checkout bootstrap for the mzpeakviewer monorepo.
#
# Order matters: the apps consume the vendored reader as `file:../../vendor/mzpeakts/lib`
# and alias their bundler at its TS source. So the reader submodule must be present and
# BUILT (its dist + its own node_modules) before the workspace install/build.
#
#   1. init the mzpeakts submodule (the one shared reader — both fixes)
#   2. build the reader lib (installs parquet-wasm/arrow, emits dist used for types)
#   3. install the workspace (apps/* + packages/*)
#
# Re-run after pulling a submodule bump.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[bootstrap] 1/3 — init vendor/mzpeakts submodule"
git submodule update --init vendor/mzpeakts

echo "[bootstrap] 2/3 — build the vendored reader (parquet-wasm + arrow + dist types)"
( cd vendor/mzpeakts/lib && npm ci && npm run build )

echo "[bootstrap] 3/4 — install the workspace"
npm install

echo "[bootstrap] 4/4 — build @mzpeak/contracts (its dist types feed @mzpeak/core)"
npm run build -w @mzpeak/contracts

echo "[bootstrap] done. Try: npm test   (the new app/ lands in Phase 4)"
