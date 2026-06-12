import { useEffect, useRef, useState } from "react";
import { PanelLeft, FolderOpen, Link2, Check } from "lucide-react";

import { useStore } from "../state/store";
import { STAGE_LABEL } from "./stageLabels";
import { FileLoader } from "./FileLoader";
import { ProgressBar } from "./ProgressBar";
import { ErrorBanner } from "./ErrorBanner";
import { OverviewPanel } from "./OverviewPanel";
import { SampleRunPanel } from "./SampleRunPanel";
import { StatsPanel } from "./StatsPanel";
import { OpticalPanel } from "./OpticalPanel";
import { FormatDetailsPanel } from "./FormatDetailsPanel";
import { SpectrumPanel } from "./SpectrumPanel";
import { ImagingPanel } from "./ImagingPanel";
import { SettingsView } from "./SettingsView";
import { Badge, Button } from "./ds";
import type { View } from "./viewTypes";

const LOGO = `${import.meta.env.BASE_URL}openms-logo.png`;
const WIDE_QUERY = "(min-width: 1041px)";

/**
 * Persistent application shell (Phase 2): top bar / inspector rail / center
 * (ImagingPanel stage) / spectrum dock / status bar. The frame is invariant;
 * only the body content swaps by load stage.
 *
 * Phase 2 slots the existing panels UNCHANGED into the rail/dock and keeps
 * ImagingPanel whole in the center. The toolbar + dark-stage split and the
 * settings popover land in Phase 4; the loader card + uPlot dock sizing in P5.
 */
export function App() {
  const stage = useStore((s) => s.stage);
  const error = useStore((s) => s.error);
  const isImaging = useStore((s) => s.capabilities?.isImaging ?? false);
  const grid = useStore((s) => s.grid);
  const stats = useStore((s) => s.stats);
  const viewZoom = useStore((s) => s.viewZoom);
  const openUrl = useStore((s) => s.openUrl);
  const sourceUrl = useStore((s) => s.sourceUrl);
  const ionIndexPreloading = useStore((s) => s.ionIndexPreloading);
  const ionIndexReady = useStore((s) => s.ionIndexReady);
  const setPreloadEnabled = useStore((s) => s.setPreloadEnabled);
  const setCacheLimitMB = useStore((s) => s.setCacheLimitMB);
  const deepLinkNotice = useStore((s) => s.deepLinkNotice);
  const setDeepLinkNotice = useStore((s) => s.setDeepLinkNotice);

  const loading =
    stage === "zip-index" ||
    stage === "manifest" ||
    stage === "metadata" ||
    stage === "grid" ||
    stage === "tic";
  const ready = stage === "ready";
  const noImaging = stage === "no-imaging";
  const isError = stage === "error";
  const hasShell = ready || noImaging; // full chrome states

  // ── Presentation-only state (never the store) ──────────────────────────────
  const [isWide, setIsWide] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia(WIDE_QUERY).matches
      : true,
  );
  const [railOpen, setRailOpen] = useState(false); // narrow-screen rail overlay
  const [reopen, setReopen] = useState(false); // "Open file" re-shows the loader
  const [view, setView] = useState<View>("overview");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = () => setIsWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // ── Deep link: ?file=<url> (alias ?url=) auto-opens an external .mzpeak ──────
  // URLSearchParams.get() percent-decodes, so the value is a plain URL. Only
  // http(s):// and s3:// are accepted (resolveLoadUrl maps s3:// → HTTPS); this
  // blocks javascript:/data: URLs. The URL is only ever fetched + rendered as
  // text, so there is no XSS surface from the param.
  // A deep-link target to apply ONCE the file reaches "ready": jump to a scan
  // (?scan=N, 1-based as shown in the UI), an ion image (?ion=<m/z>[&tol=Da]), or
  // an optical image (?optical=<index|name>). Parsed on mount; applied below.
  const pendingDeepRef = useRef<
    | { kind: "scan"; scan: number }
    | { kind: "ion"; mz: number; tol: number | null }
    | { kind: "optical"; ref: string }
    | null
  >(null);
  const deepAppliedRef = useRef(false);

  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current) return; // run once (StrictMode double-invoke safe)
    deepLinkDone.current = true;
    const p = new URLSearchParams(window.location.search);

    // Caching presets — applied BEFORE any auto-open so the load uses them.
    // ?preload=0|1 (off|on), ?cache=<MB>|auto (alias ?cacheMB=).
    const pre = p.get("preload");
    if (pre != null) setPreloadEnabled(!/^(0|false|off|no)$/i.test(pre.trim()));
    const cache = p.get("cache") ?? p.get("cacheMB");
    if (cache != null) {
      const mb = /^auto$/i.test(cache.trim()) ? 0 : Number(cache);
      if (Number.isFinite(mb) && mb >= 0) setCacheLimitMB(mb);
    }

    // View deep-link target (scan > ion > optical, first present wins).
    const scan = p.get("scan");
    const ion = p.get("ion");
    const optical = p.get("optical");
    if (scan != null && scan.trim() !== "") {
      pendingDeepRef.current = { kind: "scan", scan: Number(scan) };
    } else if (ion != null && ion.trim() !== "") {
      const tol = p.get("tol");
      pendingDeepRef.current = {
        kind: "ion",
        mz: Number(ion),
        tol: tol != null && tol.trim() !== "" ? Number(tol) : null,
      };
    } else if (optical != null) {
      pendingDeepRef.current = { kind: "optical", ref: optical.trim() };
    }

    // Deep link: ?file=<url> (alias ?url=) auto-opens an external .mzpeak.
    const fileUrl = p.get("file") ?? p.get("url");
    if (fileUrl && /^(https?|s3):\/\//i.test(fileUrl)) void openUrl(fileUrl);
  }, [openUrl, setPreloadEnabled, setCacheLimitMB]);

  // Apply the pending deep-link target once the file has loaded. Invalid targets
  // (missing scan / out-of-range m/z / unknown optical) leave the overview up and
  // surface a dismissible notice instead of erroring out the whole load.
  useEffect(() => {
    const pending = pendingDeepRef.current;
    if (!pending || deepAppliedRef.current) return;
    // Wait for the FULL overview: `stats` (numSpectra / m/z range) lands with the
    // second loadResult, after `ready` is first set. Gating on stats also ensures
    // opticalImages (sent earlier) are present.
    const loaded = (ready || noImaging) && stats != null;
    if (!loaded) return;
    deepAppliedRef.current = true;

    const s = useStore.getState();
    if (pending.kind === "scan") {
      const n = s.stats?.numSpectra ?? 0;
      const idx = pending.scan - 1; // ?scan is 1-based (matches the displayed "scan=N")
      if (Number.isInteger(pending.scan) && idx >= 0 && idx < n) {
        s.selectSpectrum(idx);
        setView("overview");
      } else {
        s.setDeepLinkNotice(
          `Scan ${pending.scan} not found — this file has ${n.toLocaleString()} scans (1–${n}).`,
        );
      }
    } else if (pending.kind === "ion") {
      const range = s.stats?.mzRange;
      const tol = pending.tol && pending.tol > 0 ? pending.tol : s.peakDeltaMass;
      if (!Number.isFinite(pending.mz) || pending.mz <= 0) {
        s.setDeepLinkNotice(`Invalid m/z in the ?ion= link.`);
      } else if (!isImaging) {
        s.setDeepLinkNotice(`This file has no imaging coordinates — can't render an ion image.`);
      } else if (range && (pending.mz < range[0] || pending.mz > range[1])) {
        s.setDeepLinkNotice(
          `m/z ${pending.mz} is outside this file's range (${range[0].toFixed(1)}–${range[1].toFixed(1)}).`,
        );
      } else {
        s.renderIonImage(pending.mz, tol);
        setView("ion");
      }
    } else {
      // optical
      const imgs = s.opticalImages ?? [];
      if (imgs.length === 0) {
        s.setDeepLinkNotice(`This file has no optical images.`);
      } else {
        const z = pending.ref;
        let match = /^\d+$/.test(z) && Number(z) < imgs.length ? imgs[Number(z)] : undefined;
        if (!match) {
          const zl = z.toLowerCase();
          match = imgs.find(
            (im) =>
              (im.sourceName ?? "").toLowerCase().includes(zl) ||
              (im.archivePath ?? "").toLowerCase().includes(zl),
          );
        }
        if (match) {
          s.setSelectedOpticalPath(match.archivePath);
          setView("optical");
        } else {
          s.setDeepLinkNotice(`Optical image "${z}" not found — this file has ${imgs.length}.`);
        }
      }
    }
  }, [ready, noImaging, isImaging, stats, setView]);

  // Build a shareable deep link to the currently-open URL-sourced file.
  function copyDeepLink() {
    if (!sourceUrl) return;
    const link = `${location.origin}${location.pathname}?file=${encodeURIComponent(sourceUrl)}`;
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  // Clear the "reopen" overlay once a fresh load actually starts.
  useEffect(() => {
    if (loading || ready || noImaging) setReopen(false);
  }, [loading, ready, noImaging]);

  // Show the loader (file picker) on idle, on explicit "Open file", AND on error
  // — so a bad/CORS-less deep link stays recoverable: the user can pick another
  // file without a manual reload (the error is surfaced inside the loader card).
  const showLoaderOverlay = stage === "idle" || reopen || isError;
  const railVisible = hasShell && (isWide || railOpen);

  return (
    <div className="app">
      {/* ALWAYS-MOUNTED hidden stage sentinel — text-only, exact STAGE_LABEL
          string, no sibling content. The e2e suite gates on toHaveText("Ready")
          etc.; this element must never be merged into a visible status node. */}
      <span data-testid="stage" aria-hidden="true" style={{ display: "none" }}>
        {STAGE_LABEL[stage]}
      </span>

      <div className="shell">
        {/* ── Top bar ───────────────────────────────────────────────────── */}
        <header className="topbar">
          {hasShell && !isWide && (
            <button
              className="iconbtn topbar__menu"
              aria-label="Toggle inspector"
              aria-pressed={railOpen}
              onClick={() => setRailOpen((v) => !v)}
            >
              <PanelLeft size={16} />
            </button>
          )}
          <div className="topbar__brand">
            <img src={LOGO} alt="OpenMS" />
          </div>
          <div className="topbar__div" />
          <div className="topbar__prod">
            <b>mzPeak IV</b>
            <span>imaging viewer</span>
          </div>
          {stats && (
            <div className="topbar__file" title="loaded dataset">
              {stats.numSpectra.toLocaleString()} spectra
            </div>
          )}
          <div className="topbar__spacer" />
          <div className="topbar__actions">
            {hasShell && sourceUrl && (
              <Button
                variant="ghost"
                size="sm"
                iconLeft={copied ? <Check size={15} /> : <Link2 size={15} />}
                onClick={copyDeepLink}
                data-testid="copy-link"
                title="Copy a shareable link that opens this file directly"
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            )}
            {(hasShell || isError) && (
              <button
                className="iconbtn"
                aria-label="Open file"
                onClick={() => setReopen(true)}
              >
                <FolderOpen size={16} />
              </button>
            )}
          </div>
        </header>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className={`body${railVisible && isWide ? "" : " body--norail"}`}>
          {railVisible && (
            <aside
              className={`rail mz-scroll${!isWide ? " rail--overlay" : ""}`}
              data-testid="inspector-rail"
            >
              <div className="rail__head">
                <span className="rail__title">Inspector</span>
                <Badge tone="success" dot>
                  ready
                </Badge>
              </div>
              <OverviewPanel />
              <SampleRunPanel />
              <StatsPanel />
              <OpticalPanel />
              <SettingsView />
              <FormatDetailsPanel />
            </aside>
          )}
          {railVisible && !isWide && (
            <div className="rail-backdrop" onClick={() => setRailOpen(false)} />
          )}

          <div className="center">
            {loading && <ProgressBar stage={stage} />}

            {hasShell && deepLinkNotice && (
              <div className="deeplink-notice" role="alert" data-testid="deep-link-notice">
                <span>⚠ {deepLinkNotice}</span>
                <button
                  className="iconbtn"
                  aria-label="Dismiss"
                  onClick={() => setDeepLinkNotice(null)}
                >
                  ✕
                </button>
              </div>
            )}

            {hasShell && (
              <>
                {ready && isImaging ? (
                  <ImagingPanel view={view} setView={setView} />
                ) : (
                  <div
                    style={{
                      flex: 1,
                      display: "grid",
                      placeItems: "center",
                      padding: "1rem",
                      color: "var(--text-muted)",
                      fontSize: "var(--text-sm)",
                      textAlign: "center",
                    }}
                  >
                    no spatial imaging coordinates — spectrum browser only
                  </div>
                )}
                {/* Spectrum dock — fixed-height frame; SpectrumPanel's uPlot
                    ResizeObserver measures the flex plot area within it. Height
                    grows a little when the centroid peak table is present. */}
                <div
                  className="dock"
                  style={{ height: "auto", minHeight: "var(--shell-spectrum-h)", maxHeight: 320 }}
                >
                  <SpectrumPanel setView={setView} />
                </div>
              </>
            )}

          </div>
        </div>

        {/* ── Status bar ────────────────────────────────────────────────── */}
        <footer className="statusbar">
          <span className="statusbar__dot">
            <b />
            mzPeak v0.3 · client-side
          </span>
          <span>{STAGE_LABEL[stage]}</span>
          <span className="statusbar__spacer" />
          {(() => {
            // Acquisition mode (dominant profile/centroid) — handoff §7 status bar.
            const r = stats?.representationCounts;
            if (!r || (r.profile === 0 && r.centroid === 0)) return null;
            return <span>{r.profile >= r.centroid ? "profile" : "centroid"}</span>;
          })()}
          {grid && (
            <span>
              {grid.width} × {grid.height} px
            </span>
          )}
          {grid && (
            <span>
              {grid.filledCount.toLocaleString()} /{" "}
              {grid.totalCells.toLocaleString()} spectra
            </span>
          )}
          {grid && <span>{Math.round(viewZoom * 100)}% zoom</span>}
          {hasShell && ionIndexPreloading && !ionIndexReady && (
            <span data-testid="buffering-hint" title="Streaming the spectra into an in-memory index so pixel spectra and ion images are instant.">
              buffering spectra…
            </span>
          )}
          {hasShell && ionIndexReady && (
            <span data-testid="buffered-hint" title="Spectra buffered in memory — pixel spectra and ion images are instant.">
              ⚡ buffered
            </span>
          )}
        </footer>
      </div>

      {/* ── Loader overlay ─────────────────────────────────────────────────
          First-load idle = a bare, airy light column (mzPeakExplorer's starting
          page). "Open file" reopen / a load error = a contained dialog card over
          the loaded app (`--dialog` variant). One FileLoader behaviour either way. */}
      {showLoaderOverlay && (
        <div className={`loader${reopen || isError ? " loader--dialog" : ""}`}>
          <div className={`loader__card${reopen || isError ? " loader__card--dialog" : ""}`}>
            <img className="loader__logo" src={LOGO} alt="OpenMS" />
            <h2 className="loader__h">Inspect an imaging mzPeak file</h2>
            <div className="loader__p">
              Open an imaging mzPeak file to reconstruct the spatial pixel grid,
              render ion images for an m/z window, and inspect the spectrum behind
              any pixel — entirely in your browser.
            </div>
            {isError && error && (
              <div style={{ width: "100%" }}>
                <ErrorBanner error={error} />
              </div>
            )}
            <FileLoader loading={loading} />
            {loading && <ProgressBar stage={stage} />}
          </div>
        </div>
      )}
    </div>
  );
}
