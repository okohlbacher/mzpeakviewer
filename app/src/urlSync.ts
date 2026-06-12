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
  type FileMode,
  type ViewState,
  type SpectrumSelector,
  DEFAULT_VIEW_STATE,
} from "@mzpeak/contracts";
import { useStore } from "./store";

// ---------------------------------------------------------------------------
// Module-local record of the URL the current file was opened from. The app
// store tracks `fileName` (a display name) but not the source URL, so we keep
// the authoritative ?file= value here for share-link round-tripping.
// ---------------------------------------------------------------------------
let openedFromUrl: string | null = null;

/** The mode the URL grammar resolves against, derived from capabilities. */
function modeFromCapabilities(): FileMode {
  const caps = useStore.getState().capabilities;
  if (!caps) return "unknown";
  return caps.imaging.isImaging ? "imaging" : "lc";
}

/**
 * Wait until the store reaches a terminal load phase ("ready" or "error") for
 * the file we just kicked off, OR a timeout elapses. Resolves regardless so the
 * caller can proceed (resolve() degrades gracefully on "unknown" mode).
 */
function awaitOpen(timeoutMs = 60_000): Promise<void> {
  return new Promise((resolveP) => {
    const { phase } = useStore.getState();
    if (phase === "ready" || phase === "error") {
      resolveP();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unsub();
      clearTimeout(timer);
      resolveP();
    };
    const unsub = useStore.subscribe((s) => {
      if (s.phase === "ready" || s.phase === "error") finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Apply a resolved ViewState to the store. Maps the grammar's rich selector to
 * the app store's narrower `selectSpectrum(index)` action where possible:
 *   - by:"spectrum" → selectSpectrum(index)   (direct absolute index)
 *   - by:"scan"     → selectSpectrum(scan)    (best-effort: treat as index;
 *                     the engine resolves native scan→index; falls back safely)
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
      // Best-effort: app store selects by absolute index. A native-scan deep
      // link is treated as an index here; if out of range the engine drops it.
      await st.selectSpectrum(sel.scan).catch(() => {});
    }
    // by:"pixel" → no index-only action available; view was already set.
  }

  // 3. Chromatogram (only the TIC path is wired in the app store today).
  if (v.chromMode === "tic" && v.view === "chromatograms") {
    await st.loadChrom({ mode: "tic" }).catch(() => {});
  }

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

  openedFromUrl = raw.file;

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
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";

  // Map the app store's narrow selector ({by:"index"}) → grammar selector.
  // The store's only selection provenance is an absolute index; emit it as
  // `spectrum=index` (the grammar's index-based form) for a stable round-trip.
  let selector: SpectrumSelector = null;
  if (s.selector && Number.isInteger(s.selector.index) && s.selector.index >= 0) {
    selector = { by: "spectrum", index: s.selector.index, id: null };
  }

  const v: ViewState = {
    ...DEFAULT_VIEW_STATE,
    sourceUrl: openedFromUrl,
    view: s.view,
    selector,
    // chrom: only the TIC mode is meaningful in the current store; emit it so
    // a chromatograms deep link round-trips. (xic/stored aren't tracked yet.)
    chromMode: s.view === "chromatograms" ? "tic" : DEFAULT_VIEW_STATE.chromMode,
  };

  const mode = modeFromCapabilities();
  return buildShareUrl(v, mode, origin, pathname);
}

/** Test/debug hook: expose the source URL the current file was opened from. */
export function sourceUrl(): string | null {
  return openedFromUrl;
}
