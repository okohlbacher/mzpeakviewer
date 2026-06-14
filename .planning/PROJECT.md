# mzpeakviewer — Unified mzPeak Viewer

## What This Is

A single browser-based TypeScript application for exploring [mzPeak](https://github.com/HUPO-PSI/mzPeak)
mass-spectrometry files — the unification of two existing apps:

- **mzPeakExplorer** (`~/Claude/mzPeakExplorer`, deployed at `mzpeak.org/view/`) — a `FileInfo`-style general explorer: Summary, Metadata, Spectra, Chromatograms, Structure; a deep-link resolver; SDRF/ISA study metadata.
- **mzPeakIV** (`~/Claude/mzPeakIV`, deployed at `mzpeak.org/IV/`) — an imaging (MSI) viewer: pixel-grid reconstruction, ion images, optical images, overlay, ROI mean spectra, the file→ion-image→pixel→spectrum loop.

The merged app opens any `.mzpeak` and **adapts to it**: the general explorer is always on; the imaging visualization layer activates only when the file is imaging. It replaces both apps, ending the duplicated reader / design-system / deploy maintenance — the headline payoff being that mzPeak's format-instability tax is paid **once** instead of twice.

Everything runs client-side — no backend, no upload — and deploys as a static site.

## Core Value

**Open any mzPeak file in a browser and explore it correctly** — spectra, metadata, chromatograms, and parquet structure for any file; and for imaging files, the full spatial round-trip (pick an *m/z* → ion image → click a pixel → its spectrum). The imaging round-trip must always work and must be correct; the general explorer must work for every file regardless of imaging.

## Architecture (target)

- **`@mzpeak/core`** — one Web Worker data engine: owns the `mzpeakts` Reader (Arrow/WASM handles never cross the boundary), hosts the scheduler + LRU cache in-worker, exposes all reads/compute as cancellable, transfer-aware messages.
- **`@mzpeak/ui-kit`** — design tokens + purely presentational components (spectrum plot, metadata tree, structure inspector) with no reader/imaging assumptions.
- **app shell** (Explorer base) — capability-adaptive sidebar; one zustand store; deep-link resolver; lazy-loaded imaging chunk.

See [research/MERGE-ROADMAP.md](research/MERGE-ROADMAP.md) for the full design and the v1→v2 adversarial-review changelog.

## Constraints

- **Stack:** Vite + React 19 + TypeScript; Canvas 2D ion images; uPlot spectra; vendored `mzpeakts` (parquet-wasm + apache-arrow + zip.js). npm workspaces.
- **Client-side only;** static-deployable (GitHub Pages + mzpeak.org rsync).
- **mzPeak is format-unstable** — version-detect, fail loud, degrade gracefully.
- **Process:** PROC-01 codex adversarial review brackets every phase (round1 plan, round2 diff).

## Status

Building — **Phases 0–5 complete** (HEAD `5175c0c`, 2026-06-14). The app runs end-to-end in a browser (capability-adaptive shell, engine worker, imaging round-trip, URL resolver) and is preview-deployed on `gh-pages`. 180 unit + 15 Playwright e2e green; typecheck + build clean across all four workspaces. Phase 6 (safety harness + single deploy + decommission of the source apps) remains. Phase 0 reader convergence pinned `mzpeakts@4067f84` (aux-arrays + Numpress Linear), tracked upstream via [HUPO-PSI/mzpeakts#1](https://github.com/HUPO-PSI/mzpeakts/pull/1).

## Source projects (provenance)

- mzPeakIV: `~/Claude/mzPeakIV` (imaging engine + worker)
- mzPeakExplorer: `~/Claude/mzPeakExplorer` (UI base + resolver + scheduler/cache)
