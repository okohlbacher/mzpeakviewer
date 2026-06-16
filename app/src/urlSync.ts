// URL ↔ store synchronization (MERGE-ROADMAP §3, Phase 5).
//
// This module is the thin imperative bridge between the PURE grammar/legacy
// modules in @mzpeak/contracts and the app's zustand store. It does no parsing
// or serializing itself — it only:
//   1. hydrateFromLocation(): on boot, read window.location.search, open the
//      ?file= URL (if any), wait for capabilities, resolve() the raw params
//      against the file MODE, and apply the resolved ViewState to the store
//      (view + selection + chrom + cross-mode notices).
//   2. currentShareUrl(): map the store's live view-ish state → a ViewState and
//      buildShareUrl() the shortest canonical link for the "Share view" button.
//
// Defensive throughout: no ?file → no-op; failed open surfaces via the store's
// own error path; unknown/cross-mode params produce non-blocking notices (§3.5).

import {
  parseSearch,
  resolve,
  buildShareUrl,
  buildUsi,
  USI_LOCAL_COLLECTION,
  type FileMode,
  type ViewState,
  type SpectrumSelector,
  type UsiIndexFlag,
  DEFAULT_VIEW_STATE,
} from "@mzpeak/contracts";
import { useStore } from "./store";
import { idsCarryScans, resolveScanToIndex, scanNumberOf } from "./scan";

// ---------------------------------------------------------------------------
/** True in the Tauri desktop app (window.location.origin is "tauri://localhost").
 *  The address bar is meaningless there, so live URL sync + the toggle are hidden,
 *  and currentShareUrl() resolves links to the canonical web viewer instead. */
export function isTauriApp(): boolean {
  const rawOrigin = typeof window !== "undefined" ? window.location.origin : "";
  return rawOrigin.startsWith("tauri://");
}

/** The mode the URL grammar resolves against, derived from capabilities. */
function modeFromCapabilities(): FileMode {
  const caps = useStore.getState().capabilities;
  if (!caps) return "unknown";
  return caps.imaging.isImaging ? "imaging" : "lc";
}

/**
 * Apply a resolved ViewState to the store. Maps the grammar's rich selector to
 * the app store's narrower `selectSpectrum(index)` action where possible:
 *   - by:"spectrum" → selectSpectrum(index)   (direct absolute index)
 *   - by:"scan"     → resolve the NATIVE scan number → absolute index CLIENT-SIDE
 *                     via resolveScanToIndex(browse, scan), because native scan ≠
 *                     index for Bruker/Thermo (scan = index + 1). The engine does
 *                     NOT do this resolution. Falls back to treating scan as the
 *                     index only when ids don't carry scans / nothing resolves.
 *   - by:"pixel"    → not directly indexable from the URL alone; the view is
 *                     set so the user lands on the right panel, selection no-op.
 * Chromatogram mode "tic" routes to loadChrom({mode:"tic"}); other chrom modes
 * are left to their views (the app store has no XIC action yet).
 */
async function applyViewState(v: ViewState, notices: { code: string; message: string }[]) {
  const st = useStore.getState();

  // 1. View first (so the panel is correct even if selection is a no-op).
  if (v.view) st.setView(v.view);

  // 2. Selection (spectrum/scan → selectSpectrum). Defensive: only when numeric.
  const sel: SpectrumSelector = v.selector;
  if (sel) {
    if (sel.by === "spectrum" && Number.isInteger(sel.index) && sel.index >= 0) {
      await st.selectSpectrum(sel.index).catch(() => {});
    } else if (sel.by === "scan" && Number.isInteger(sel.scan) && sel.scan >= 0) {
      // Native scan → absolute index. The app store selects by absolute index,
      // but native scan ≠ index for Bruker/Thermo (scan = index + 1), so a naive
      // selectSpectrum(scan) lands one spectrum off. Resolve client-side against
      // the browse ids when they actually carry scans; otherwise fall back to the
      // old index-as-scan behaviour so files where scan==index don't regress.
      const browse = useStore.getState().browse;
      const resolved =
        browse && idsCarryScans(browse.id)
          ? resolveScanToIndex(browse, sel.scan)
          : null;
      if (resolved != null) {
        await st.selectSpectrum(resolved).catch(() => {});
      } else {
        // Fallback: ids don't carry scans, browse absent, or scan not found.
        // Treat the scan as an absolute index (correct when scan==index). Guard
        // against an obvious out-of-range value so we don't select a wrong/last
        // spectrum when we can already tell it can't be a valid index.
        const n = browse?.id.length ?? null;
        if (n == null || sel.scan < n) {
          await st.selectSpectrum(sel.scan).catch(() => {});
        }
      }
    } else if (sel.by === "pixel" && Number.isInteger(sel.x) && Number.isInteger(sel.y)) {
      // Imaging pixel deep link (MG-01): resolve (x,y) → spectrum via the loaded grid.
      // route=false keeps the imaging view (already set above) and fills the dock.
      await st.selectPixel(sel.x, sel.y, false).catch(() => {});
    }
  }

  // 3. Chromatogram (only the TIC path is wired in the app store today).
  if (v.chromMode === "tic" && v.view === "chromatograms") {
    await st.loadChrom({ mode: "tic" }).catch(() => {});
  }

  // 3b. Imaging deep-link controls (MG-01): prefill the Ion-image m/z+tol and the
  // RGB channel list so a ?ion=/?ch= link lands on populated controls.
  if (v.ion) st.setIonRequest(v.ion);
  if (v.channels.length) st.setRgbChannels(v.channels);

  // 4. Cross-mode / dropped-param notices → the store's non-blocking banner.
  if (notices.length) {
    useStore.setState((s) => ({
      notices: [
        ...s.notices,
        ...notices.map((n) => ({
          id: `url-${n.code}`,
          severity: "info" as const,
          message: n.message,
        })),
      ],
    }));
  }
}

/**
 * Boot-time hydration. Call ONCE from main.tsx after the root renders.
 * Reads window.location.search; if a `file` param is present, opens it and
 * applies the deep-linked view/selection once capabilities are known.
 */
export async function hydrateFromLocation(): Promise<void> {
  if (typeof window === "undefined") return;
  const raw = parseSearch(window.location.search);

  // No file → nothing to hydrate (a bare app load). The grammar still resolves,
  // but with no file there's no mode and no selection to apply.
  if (!raw.file) return;

  // Open the file FULLY before applying the deep-linked view. openUrl's promise
  // settles only after its auto-preselect of spectrum 0 (which routes the view to
  // "spectra"); awaiting it here means the URL's explicit ?view= is applied LAST and
  // wins over that default routing. A timeout caps a hung open.
  const openDone = useStore.getState().openUrl(raw.file).catch(() => {});
  const cap = new Promise<void>((r) => setTimeout(r, 60_000));
  await Promise.race([openDone, cap]);

  if (useStore.getState().phase !== "ready") return; // open failed → store shows error

  const mode = modeFromCapabilities();
  const { view, notices } = resolve(raw, mode);
  await applyViewState(view, notices);
}

/**
 * Build the shareable URL for the store's current state. Maps the app store's
 * fields onto a ViewState (omitting fields the store doesn't track yet), then
 * delegates to the pure buildShareUrl(). Uses window.location origin+pathname.
 */
export function currentShareUrl(): string {
  const s = useStore.getState();
  // In the Tauri desktop app, window.location.origin is "tauri://localhost" which
  // produces non-shareable links. Always resolve to the canonical web viewer instead.
  const rawOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const isTauri = isTauriApp();
  const origin = isTauri ? "https://www.mzpeak.org" : rawOrigin;
  const pathname = isTauri ? "/view/" : (typeof window !== "undefined" ? window.location.pathname : "/");

  // Map the app store's selector → grammar selector. A pixel pick emits `px=x,y`
  // (MG-01, imaging provenance preserved); any other selection emits `spectrum=index`.
  let selector: SpectrumSelector = null;
  if (s.selector?.by === "pixel" && Number.isInteger(s.selector.x) && Number.isInteger(s.selector.y)) {
    selector = { by: "pixel", x: s.selector.x, y: s.selector.y, index: s.selector.index, id: null };
  } else if (s.selector && Number.isInteger(s.selector.index) && s.selector.index >= 0) {
    selector = { by: "spectrum", index: s.selector.index, id: null };
  }

  const v: ViewState = {
    ...DEFAULT_VIEW_STATE,
    sourceUrl: s.sourceUrl,
    view: s.view,
    selector,
    // chrom: only the TIC mode is meaningful in the current store; emit it so
    // a chromatograms deep link round-trips. (xic/stored aren't tracked yet.)
    chromMode: s.view === "chromatograms" ? "tic" : DEFAULT_VIEW_STATE.chromMode,
    // imaging (MG-01): emit the last Ion-image request + RGB channels so ?ion=/?ch=
    // round-trip. DEFAULT_VIEW_STATE has ion:null / channels:[] — only set when present.
    ion: s.ionRequest ?? DEFAULT_VIEW_STATE.ion,
    channels: s.rgbChannels.length ? s.rgbChannels : DEFAULT_VIEW_STATE.channels,
  };

  const mode = modeFromCapabilities();
  return buildShareUrl(v, mode, origin, pathname);
}

/** ProteomeXchange / MassIVE dataset accession in a source URL path (e.g. PXD011799,
 *  MSV000012345) — the USI `collection`. Null when the URL carries no recognizable one. */
function collectionFromUrl(url: string): string | null {
  const m = /\b(PXD\d{6,}|MSV\d{9,}|RPXD\d{6,})\b/i.exec(url);
  return m ? m[1]!.toUpperCase() : null;
}

/** USI `msRun` = the file's basename without the `.mzpeak` extension (decoded). */
function msRunFromUrl(url: string): string {
  let base = url;
  try { base = decodeURIComponent(url); } catch { /* keep raw */ }
  base = base.split(/[?#]/)[0]!; // drop query/hash
  base = base.split("/").pop() ?? base; // basename
  return base.replace(/\.mzpeak$/i, "");
}

/**
 * Build a Universal Spectrum Identifier for the current file + selected spectrum (MG-08),
 * or null when no remote file / no selection exists. `collection` is the dataset accession
 * when the source URL carries one (PXD/MSV — a citeable, resolvable USI), else the PSI
 * placeholder `USI000000` (valid for local/unsubmitted data). The selector prefers the
 * native `scan` number (resolved from browse ids) and falls back to the absolute `index`.
 */
export function currentUsi(): string | null {
  const s = useStore.getState();
  if (!s.sourceUrl) return null; // a USI needs a file/run to address
  const idx = s.selector?.index ?? 0;
  const browse = s.browse;
  const scan = browse && idsCarryScans(browse.id) ? scanNumberOf(browse.id[idx]) : null;
  const flag: UsiIndexFlag = scan != null ? "scan" : "index";
  const value = scan != null ? String(scan) : String(idx);
  return buildUsi({
    collection: collectionFromUrl(s.sourceUrl) ?? USI_LOCAL_COLLECTION,
    msRun: msRunFromUrl(s.sourceUrl),
    flag,
    value,
  });
}
