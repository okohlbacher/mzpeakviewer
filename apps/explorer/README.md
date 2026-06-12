# mzPeak Explorer

A lightweight, **browser-based** explorer for [mzPeak](https://github.com/HUPO-PSI/mzPeak)
mass-spectrometry files — a web-native, interactive take on OpenMS `FileInfo`. Open a
`.mzpeak` file and immediately see what's inside: an overview, a metadata browser, a
spectrum / chromatogram navigator, and the archive's internal structure.

Everything runs **client-side** — no upload, no backend. Local files are read in place and
their bytes never leave the browser; remote files are streamed with HTTP range requests, so
opening one transfers only the parts you actually look at.

**Try it:** the primary resolver is **<https://www.mzpeak.org/view/>** (GitHub Pages mirror:
<https://okohlbacher.github.io/mzPeakExplorer/>). Click **Open demo** for a ~145 MB SCIEX
TripleTOF dataset streamed from the CDN.

![Summary overview with embedded SDRF study metadata and TMT channel assignments](docs/images/summary-study.png)

## What it does

Five tabs, all driven from a single in-browser read of the file.

- **Summary** — a `FileInfo`-style readout: spectrum / chromatogram / entity counts, MS-level
  breakdown, profile-vs-centroid split, m/z and RT ranges, storage layout, array encodings, and the
  entity manifest. When the archive embeds study metadata it also shows **Study & samples** — the
  SDRF/ISA accession, sample/channel counts, and a run-scoped **channel-assignment** table (reporter
  m/z ↔ sample ↔ role ↔ label) decoded from the file's encoded index. **Imaging (MSI)** archives add
  the imaging block (pixel grid, geometry, optical images). *(screenshot above)*
- **Metadata** — the full file-level metadata (`fileDescription`, instrument, software, data
  processing, run, samples, and the `mzpeak_index.json` block) as a collapsible, CV-accession-aware
  tree.
- **Spectra** — page through spectra (profile drawn as a line, centroid as a stick spectrum) with
  wheel/box zoom, pan, peak labels, and a hover readout; filter by MS level; expand a per-spectrum
  metadata tree. For isobaric (**TMT / iTRAQ**) datasets it marks the **reporter ions** on the plot
  and shows per-channel **quant pills** extracted from the spectrum.

  ![MS² spectrum zoomed to the TMT reporter region with reporter-ion quant pills](docs/images/spectra-reporters.png)
- **Chromatograms** — a **TIC** (from the promoted per-spectrum column) or an **extracted-ion
  chromatogram** for an m/z window you specify; click anywhere on it to jump to the nearest spectrum.

  ![Total-ion chromatogram with the XIC m/z controls](docs/images/chromatogram-tic.png)
- **Structure** — the archive itself: every ZIP member (Parquet tables with row-group/column sizes
  and codecs, the embedded SDRF/ISA, optical images, and any other attachments), each openable or
  downloadable.

  ![Structure tab listing the archive's Parquet tables and embedded SDRF](docs/images/structure.png)

## Opening a file & how it loads

Drop or **browse** a local file, click **Open demo**, or paste a dataset URL (the URL box starts
empty). Three small files ship under [`public/static/`](public/static) — `small.mzpeak`,
`small.chunked.mzpeak`, and `imaging-demo.mzpeak` (an MSI file with an optical image) — for local
and static-site testing.

![The idle start screen — drop-zone, privacy note, demo, and URL box](docs/images/starting-page.png)

Opening a file reads **metadata and table counts only**, so the overview appears in a couple of
seconds even for multi-gigabyte files. From there:

- files up to ~50k spectra **auto-compute** the per-spectrum breakdown (MS levels, m/z & RT ranges)
  and a cheap TIC in the background;
- **local** sessions additionally background-preload spectra so navigation stays instant;
- **large remote** files wait for an explicit action (**Compute breakdown**, **Build TIC**, or just
  opening the Spectra tab) so a deep look at one file never eagerly pulls the whole thing.

An unsupported array compression fails for that spectrum only — the file stays open so Summary,
Metadata, and Structure keep working.

## Data sharing

Every view of a **cloud-hosted** dataset can be turned into a link that reproduces it. The app is a
*resolver*: the primary analysis state lives in the URL's query string, so opening a link re-fetches
the dataset and replays the view.

**The "Share view" button.** While exploring a dataset you opened **from a URL**, a **Share view**
button appears in the top bar; one click copies a link that restores the dataset, the active tab,
the selected spectrum (by its native scan number when it has one), the MS-level filter, the
spectrum's m/z zoom, and the current TIC / XIC / stored chromatogram. It intentionally does **not**
capture incidental UI state (metadata-tree or Structure expansion, settings, in-progress fields), and
an XIC is always shared as `xic=mz,delta`. Links point back at the instance you're using.

![The Share view button in the top bar — shown only for datasets opened from a URL](docs/images/share-view-button.png)

> **Local files can't be shared** — their bytes never leave your browser, so there's no URL to put in
> a link, and the button only appears for URL-loaded datasets. To make a dataset shareable, host the
> `.mzpeak` somewhere reachable over HTTP with **CORS** and **byte-range** support (e.g. the project
> CDN, `data.mzpeak.org`).

**Hand-authored links.** You don't need the button — any link with the right parameters resolves to
the matching view, and a few parameters **compute a chromatogram on load**:

```
https://www.mzpeak.org/view/?file=<dataset-url>&xicmz=445.0,445.3      # XIC over an m/z range
https://www.mzpeak.org/view/?file=<dataset-url>&chrom=tic&rt=120,600   # TIC over an RT window (s)
```

Point the first link's `<dataset-url>` at the demo dataset (the remote SCIEX TripleTOF file behind
**Open demo**) and it resolves on load straight to its extracted-ion chromatogram — the recipient
lands here, no clicks:

![A shared `?file=…&xicmz=445.0,445.3` link resolved to the extracted-ion chromatogram](docs/images/share-view-resolved.png)

| Parameter | Value | Meaning |
|---|---|---|
| `file` (alias `url`) | absolute `http(s)` URL | **required** — the `.mzpeak` to open (the host needs CORS + byte-range; URL-encode the value if it contains `?`/`&`) |
| `tab` | `summary` \| `metadata` \| `spectra` \| `chromatograms` \| `structure` | which tab to show |
| `scan` | integer | select the spectrum with this **native scan number** (preferred — stable) |
| `spectrum` | integer | select by **0-based index** (fallback, e.g. imaging) |
| `ms` | integer | restrict spectrum navigation to this MS level |
| `mz` | `lo,hi` | zoom the **spectrum** plot to this m/z window (needs a selected spectrum) |
| `chrom` | `tic` \| `<stored-id\|index>` | show the **TIC**, or a **stored** chromatogram by its id or 0-based index |
| `xic` | `mz,delta` | **extracted-ion** chromatogram centred at `mz`, ± `delta` (half-window) |
| `xicmz` | `lo,hi` | extracted-ion chromatogram over an explicit **m/z range** |
| `rt` | `start,end` | restrict the TIC/XIC to a **retention-time window** (seconds) |

A **TIC** needs only `chrom=tic` (optionally `&rt=`); an **XIC** needs an m/z window — a range
(`xicmz`) or centre + delta (`xic`) — plus an optional `rt`. **Precedence:** `xicmz` > `xic` >
`chrom`, and `scan` > `spectrum`. An explicit `tab=` always wins; otherwise a chromatogram parameter
lands on **Chromatograms** and a spectrum parameter on **Spectra**. When both are given, both are
applied — the chromatogram shows first, but the spectrum stays selected, so switching to Spectra
shows it. Generated links are **best-effort**: a request the file can't satisfy (e.g. a TIC for a
huge file with no promoted column) is ignored or surfaces a clear error rather than breaking.

Full schema in [`docs/share-view-deep-link-SPEC.md`](docs/share-view-deep-link-SPEC.md).

## Settings

A **gear** menu in the top bar toggles the background **preload** and sets the in-memory spectrum
**cache budget**. Both can be preset from the URL: `?preload=0` disables preloading, `?cacheMB=512`
sets the cache size.

## Develop & deploy

```bash
npm install
npm run dev      # http://localhost:5188   (pinned port; strictPort)
npm run build    # tsc -b && vite build → dist/   (set VITE_BASE=/sub-path/ for a project page)
npm run test     # vitest
```

The app is a fully static SPA — no backend, no secrets. It deploys to **GitHub Pages** automatically
on every push to `main` ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)); the
**`mzpeak.org/view`** instance is published separately via the combined-site build + rsync (see
[`CLAUDE.md`](CLAUDE.md)). The vendored `mzpeakts` reader is committed in-tree, so CI needs no
submodule.

Internals — the `src/reader/` boundary, the vendored `mzpeakts` + `parquet-wasm` stack, the state
store, the prioritized read scheduler, and the lazy chart wiring — are documented in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

> mzPeak has **no stability guarantee**. The reader version-detects and the UI degrades gracefully —
> a chromatogram-only or non-imaging file simply shows what it has.
