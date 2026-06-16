# mzPeakViewer — Desktop (Tauri v2)

This document covers the **desktop** build of mzPeakViewer: a [Tauri v2](https://v2.tauri.app)
wrapper around the exact same static web frontend that ships to GitHub Pages and
mzpeak.org. The webview loads `app/dist` (built with `VITE_BASE=/`) over the
`tauri://localhost` (macOS/Linux) / `https://tauri.localhost` (Windows) origin. There
are **no frontend code changes** for v1 — the desktop app reuses the browser Blob reader
path (`MzPeakReader.fromBlob`) and HTTP range reads to `https://data.mzpeak.org` exactly
as the web app does.

- **Product name:** `mzPeakViewer`
- **Bundle identifier:** `org.mzpeak.viewer`
- **Tauri config:** `app/src-tauri/tauri.conf.json`
- **Rust shell:** `app/src-tauri/src/` + `app/src-tauri/Cargo.toml`
- **Frontend build owner:** `app/src-tauri/scripts/build-frontend.sh` (the `beforeBuildCommand`)
- **CI:** `.github/workflows/desktop.yml` (additive — triggers on `v*` tags +
  `workflow_dispatch` only; it never runs on a normal push and never disturbs
  `deploy.yml`)

---

## Per-OS bundle outputs

| OS      | Targets                       | Notes |
|---------|-------------------------------|-------|
| Windows | `nsis` (.exe), `msi`          | WebView2 dependency (see below). Built **unsigned** in v1. |
| macOS   | `app`, `dmg` (**universal**)  | Built `--target universal-apple-darwin` (aarch64 + x86_64). Unsigned unless certs supplied. |
| Linux   | `appimage`, `deb`, `rpm`      | Built on `ubuntu-24.04` (webkit2gtk-4.1). AppImage is the primary portable artifact; deb/rpm are best-effort. |

`universal-apple-darwin` is a **build target**, not a `bundle.targets` entry — it is
passed via `--target`, never listed under `bundle.targets`.

### Minimum supported Linux baseline

Bundles built on `ubuntu-24.04` link against **webkit2gtk-4.1**, which means the
practical floor is **Ubuntu 22.04+ / Fedora 36+**. Older distros are not supported.

---

## Building locally

### Prerequisites

- **Node ≥ 20** (CI uses 22) and **npm**.
- **Rust 1.96+** with `cargo` (`rustup` recommended).
- The **`vendor/mzpeakts`** submodule. `build-frontend.sh` initializes it, but for a
  cold clone you can do it yourself: `git submodule update --init --recursive`.
- Platform Tauri v2 system dependencies:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`). For a universal
    build also run `rustup target add x86_64-apple-darwin` (Apple-silicon boxes only
    ship aarch64 by default).
  - **Windows:** [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
    (present on Win11 / updated Win10) and the MSVC build tools.
  - **Linux (Ubuntu 24.04):**
    ```bash
    sudo apt-get update
    sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
      libayatana-appindicator3-dev librsvg2-dev patchelf build-essential \
      libssl-dev file wget rpm
    ```

### Install the Tauri CLI

The CLI is declared as a dev dependency in both `app/package.json` and
`app/src-tauri/package.json` (`@tauri-apps/cli@^2`). After a workspace install it is
available via npm scripts — there is no global install requirement.

### Build commands

The frontend build is fully owned by `app/src-tauri/scripts/build-frontend.sh`, which
Tauri runs automatically as `beforeBuildCommand`. You do **not** build `app/dist`
yourself — just invoke the desktop build:

```bash
# from app/src-tauri/
npm run build              # tauri build — current host arch
npm run build:universal    # tauri build --target universal-apple-darwin (macOS only)
```

Or from `app/` (the app workspace also exposes wrappers):

```bash
# from app/
npm run tauri:build
npm run tauri:build:universal   # macOS only
```

The first `cargo` build is slow (compiles the whole dependency tree); subsequent builds
are incremental. Outputs land under `app/src-tauri/target/release/bundle/` (and
`target/universal-apple-darwin/release/bundle/` for the universal macOS build).

> The `beforeBuildCommand` always runs `build-frontend.sh`, which does a `rm -rf app/dist`
> then a `VITE_BASE=/` build and finally asserts `app/dist/index.html` references
> `/assets/`. A stale `/mzpeakviewer/`-based dist can never be bundled.

### Dev mode

```bash
# from app/src-tauri/
npm run dev          # tauri dev — runs `vite` on the workspace + opens the native window
# or from app/:
npm run tauri:dev
```

`tauri dev` assumes the workspace is already bootstrapped. For a cold start run
`npm run bootstrap` at the repo root first (`build-frontend.sh` is the **build**-time
owner; dev relies on `bootstrap.sh`). The dev server is `http://localhost:5173`.

### Generating icons

`bundle.icon` expects the generated icon set under `app/src-tauri/icons/`. Regenerate it
from a **square** source PNG (`tauri icon` requires square input):

```bash
# from app/src-tauri/
npm run icon         # tauri icon app-icon.png
```

> **Known gap:** `app/src-tauri/app-icon.png` is a placeholder derived from the wide
> 1886×332 banner logo — there is no square brand icon in `app/public` yet. A proper
> **1024×1024** square brand icon is required before a real release.

---

## Architecture notes that matter for desktop

- **No SharedArrayBuffer / wasm-threads / Atomics** anywhere → no COOP/COEP /
  cross-origin-isolation needed.
- **parquet-wasm is a hashed `.wasm` asset** (Vite `assetsInlineLimit: 0`), fetched
  same-origin by the module Web Worker and instantiated with `WebAssembly`. The CSP
  therefore keeps `'wasm-unsafe-eval'` in `script-src` **and** `'self'` in `connect-src`.
- **Content-Security-Policy** (set in `tauri.conf.json` → `app.security.csp`):
  ```
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:;
  connect-src 'self' ipc: http://ipc.localhost https: blob: data:
  ```
  `connect-src https:` is what lets the "paste a `https://` .mzpeak URL" input and the
  CDN range reads work under `tauri://`.
- **Drag-and-drop:** `app.windows[0].dragDropEnabled` is set to **`false`** so Tauri's
  OS-level drag-drop interception does **not** swallow the webview's own
  `dataTransfer.files` drop. This keeps the "Drop a .mzpeak file here" affordance working
  with no frontend change. **Verify on Linux/WebKitGTK specifically** during smoke testing.

---

## Signing & notarization

**No signing happens without operator-provided certificates.** There are no certs in this
repo or CI. When the relevant secrets are **absent**, the build still succeeds and
produces **unsigned** bundles (macOS Gatekeeper will quarantine; Windows SmartScreen will
warn). CI never publishes — releases are created as **drafts** for the operator to publish
manually.

There are three states:
1. **Unsigned** — no secrets set (the default today).
2. **Signed, not notarized (macOS)** — `APPLE_CERTIFICATE` + password + identity set, but
   the notarization triplet absent.
3. **Signed + notarized (macOS)** — the full Apple set is present.

### macOS secrets

Set these as GitHub Actions repository secrets. The signing/notarization env is exported
in CI **only when the relevant group is fully present** (partial sets are gated off so a
half-configured Apple set can never hard-fail notarization).

| Secret | Purpose / how to obtain |
|--------|--------------------------|
| `APPLE_CERTIFICATE` | Base64 of your **Developer ID Application** `.p12`. Export from Keychain Access → your "Developer ID Application" cert → Export as `.p12`; then `base64 -i cert.p12 \| pbcopy`. **Must be a _Developer ID Application_ cert** (paid $99/yr membership). `Apple Development` / `Apple Distribution` certs sign but **fail notarization**. tauri-action imports this into a temporary keychain itself — do **not** add a manual keychain-import step. |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12`. |
| `APPLE_SIGNING_IDENTITY` | The identity string, e.g. `Developer ID Application: Your Name (TEAMID)`. Verify with `security find-identity -v -p codesigning`. |
| `KEYCHAIN_PASSWORD` | A throwaway password for the temporary keychain tauri-action creates. Any random string. |
| `APPLE_ID` | Apple account email used for notarization. **Part of the notarization triplet** — all three of `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` must be set together or notarization is skipped; a partial set hard-fails. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords. **The workflow exports it as the `APPLE_PASSWORD` env var** (Tauri reads `APPLE_PASSWORD`). Do **not** rename the secret to `APPLE_PASSWORD`. A stale/revoked value hard-fails `notarytool` with a 401. |
| `APPLE_TEAM_ID` | Your 10-character Apple Developer Team ID (Apple Developer → Membership). Third member of the notarization triplet. |

To verify a locally produced signed/notarized `.app` / `.dmg`:

```bash
security find-identity -v -p codesigning      # confirm the Developer ID Application identity exists
codesign -dv --verbose=4  path/to/mzPeakViewer.app
spctl -a -vvv -t install   path/to/mzPeakViewer.app
xcrun stapler validate     path/to/mzPeakViewer.dmg
```

CI runs these same `codesign` / `spctl` / `stapler` checks (gated on cert presence) and
**fails the job** on a botched sign/notarize.

### Windows secrets — WIRED BUT INERT in v1

Windows bundles are produced **unsigned in v1 even when these are set.** The `signCommand`
and `cargo install trusted-signing-cli` are intentionally deferred, so the `AZURE_*`
secrets are wired into the workflow env only as a forward hook. Users will see SmartScreen
warnings.

| Secret | Purpose |
|--------|---------|
| `AZURE_TENANT_ID` | Azure Trusted Signing tenant (service principal). Part of an all-three-or-none set. |
| `AZURE_CLIENT_ID` | Azure Trusted Signing service-principal client id. |
| `AZURE_CLIENT_SECRET` | Azure Trusted Signing service-principal secret. |

### Updater signing — OUT OF SCOPE for v1

`createUpdaterArtifacts` stays `false`. These are documented only; the env refs are
harmless no-ops when unset.

| Secret | Purpose |
|--------|---------|
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater artifact signing key. Out of scope v1. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the above. Out of scope v1. |

### `GITHUB_TOKEN`

The built-in Actions token. tauri-action uses it to create the **draft** GitHub Release.
It is granted `contents: write` at **job level only** (top-level workflow permissions are
`contents: read`).

---

## Cutting a release

The single source of truth for the bundle version is the top-level `"version"` key in
`app/src-tauri/tauri.conf.json`. `tauri-action` derives the release/bundle version from
**that file, not from the git tag**, so the two must agree.

1. Bump **both** versions to `X.Y.Z` (keep them in lockstep by hand):
   - `app/src-tauri/tauri.conf.json` → top-level `"version": "X.Y.Z"`
   - `app/src-tauri/Cargo.toml` → `version = "X.Y.Z"`
   > `app/package.json` is **not** the version source for the desktop bundle — do not wire
   > the version to the npm workspace.
2. Commit the bump.
3. Tag and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
   > **Push policy:** the only authorized remote is `okohlbacher/mzpeakviewer`. Tagging /
   > pushing is an operator action — automation must not push or tag.
4. The `desktop.yml` workflow runs on the `v*` tag, builds the per-OS matrix, and (via
   tauri-action) creates a **draft** GitHub Release with the bundles attached.
5. Review the draft, confirm the artifacts, and **publish manually**. CI never publishes.

You can also dry-run the matrix without tagging via **`workflow_dispatch`**. Dispatch runs
upload the bundles as workflow artifacts (instead of attaching them to a release) so they
remain downloadable for inspection.

---

## Manual per-OS smoke checklist (CI cannot catch these)

CI green proves the Rust compiles, the config schema is valid, and bundles are produced.
It does **not** prove the GUI works. The module Web Worker + parquet-wasm under the system
webview (WebView2 vs WKWebView vs WebKitGTK) is the highest "works-in-browser, dead-in-app"
risk. **Run the BUNDLED app (not `--no-bundle`) on each OS** and verify:

- [ ] App launches and the window renders (no blank/white window).
- [ ] **Open a local `.mzpeak` file** (Blob path) and **render both an ion image and a
      spectrum** — this exercises parquet-wasm instantiation in the system webview.
- [ ] **Drag-and-drop** a `.mzpeak` onto the drop affordance (especially on Linux/WebKitGTK).
- [ ] **Open a remote file** from `https://data.mzpeak.org` (range reads) — watch the
      network/console for CORS failures from the `tauri://` origin (see open risks).
- [ ] **Large file** (up to ~3.3 GB) local open does not OOM/crash the webview. Prefer the
      range-read cloud path over a whole-object download on desktop.
- [ ] HiDPI / fractional-scaling rendering of Canvas ion images + uPlot spectra looks
      correct (WKWebView dpr 2; WebView2 1.25/1.5/1.75; WebKitGTK Wayland fractional).
- [ ] **Windows clean-Win10:** confirm the offline WebView2 installer works with no internet
      (`webviewInstallMode: offlineInstaller`).
- [ ] If the Linux window is blank, try `WEBKIT_DISABLE_DMABUF_RENDERER=1` (known WebKitGTK
      DMABUF bug).

---

## Known limitations / open risks (v1)

- **External links don't work in-app.** `target=_blank` links (openms.org, mzpeak.org,
  www.mzpeak.org) are governed by `default-src 'self'` and won't open. The opener plugin is
  deliberately not wired (keeps the capability surface minimal + honors "no frontend
  changes"). Follow-up: add `@tauri-apps/plugin-opener` + an anchor-click handler + a
  capability permission.
- **Remote CORS from the `tauri://` origin is unverified.** `data.mzpeak.org` CORS is
  configured for the web origins, not necessarily for the desktop `Origin` header (which
  differs per OS: `https://tauri.localhost` on Windows, `tauri://localhost` elsewhere). If
  the CDN uses a strict allowlist rather than `*`, remote opens fail. **Operator action:**
  confirm the CDN accepts the tauri origins.
- **Large-file Blob reads + parquet-wasm decode are unvalidated in the system webviews**
  (WebKitGTK has lower memory ceilings than desktop Chrome). A multi-GB local open could
  OOM/crash with no JS error.
- **Windows bundles are unsigned in v1** even with `AZURE_*` set (signing deferred). Users
  see SmartScreen warnings.
- **All bundles are unsigned/un-notarized** until the operator supplies certs. Releases are
  drafts; CI never publishes.
- **`app-icon.png` is a placeholder** derived from the wide banner logo — a proper square
  1024×1024 brand icon is needed before release.
- **The "download a copy to disk" demo path** (anchor `blob:` download) may silently not
  persist under WebView2/WebKitGTK; the in-memory open still works. A native save would need
  the fs/dialog plugin (out of scope v1).

---

## CI design summary

`.github/workflows/desktop.yml` is **additive** and triggers **only** on `v*` tags +
`workflow_dispatch` — it never runs on a normal push and never touches `deploy.yml`.

- Top-level `permissions: { contents: read }`; `contents: write` granted at **job level**
  only on the job that creates the draft release.
- `tauri-apps/tauri-action` and `dtolnay/rust-toolchain` are pinned to full 40-char commit
  SHAs (with `# vX.Y.Z` comments); `actions/checkout`, `setup-node`, `swatinem/rust-cache`
  pinned too. Dependabot (github-actions) bumps them.
- Checkout uses `submodules: recursive`. Node 22 + Rust set up; the macOS matrix entry adds
  both `aarch64-apple-darwin,x86_64-apple-darwin` targets and builds
  `--target universal-apple-darwin`.
- A `npm run typecheck` **gate** runs before tauri-action (mirrors `deploy.yml`). The full
  frontend build is **not** duplicated in the workflow — tauri-action triggers
  `build-frontend.sh` via `beforeBuildCommand`.
- Linux installs the canonical v2 apt set on `ubuntu-24.04` (see Prerequisites).
- macOS notarization env (`APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`) is exported
  **only when all three secrets are non-empty**; the `AZURE_*` trio is gated the same way.
- A macOS-only post-bundle verification step (gated on cert presence) runs
  `codesign -dv`, `spctl -a -vvv -t install`, `xcrun stapler validate` and fails CI on a
  botched sign/notarize.
- Root install uses `npm install` (not `npm ci`) for release resilience against lockfile
  drift on main; the reader submodule keeps `npm ci` (its lockfile is vendored/stable).
