import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Activity,
  ChartSpline,
  Check,
  File as FileIcon,
  FolderOpen,
  FolderTree,
  LayoutDashboard,
  ListTree,
  LoaderCircle,
  Share2,
} from "lucide-react";

import { useStore, type Tab } from "../state/store";
import { buildShareUrl, parsePair, parseViewParams, type ViewState } from "./shareView";
import { AppHeader, Badge, Button, Logo, SideNav, type NavItem } from "./components";
import { DEMO_URL, IdleLoader } from "./FileLoader";
import { SettingsMenu } from "./SettingsMenu";
import { SummaryTab } from "./SummaryTab";
import { MetadataTab } from "./MetadataTab";
import { SpectraTab } from "./SpectraTab";
import { ChromatogramsTab } from "./ChromatogramsTab";
import { StructureTab } from "./StructureTab";

const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "summary", label: "Summary", icon: <LayoutDashboard size={17} /> },
  { id: "metadata", label: "Metadata", icon: <ListTree size={17} /> },
  { id: "spectra", label: "Spectra", icon: <Activity size={17} /> },
  { id: "chromatograms", label: "Chromatograms", icon: <ChartSpline size={17} /> },
  { id: "structure", label: "Structure", icon: <FolderTree size={17} /> },
];


/** File mini-inspector pinned to the rail bottom — mirrors mzPeakIV's StatsPanel. */
function MiniInspector() {
  const s = useStore((st) => st.summary);
  const buffered = useStore((st) => st.buffered);
  const preload = useStore((st) => st.settings.preload);
  if (!s) return null;
  const row = (k: string, v: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", padding: "0.14rem 0", lineHeight: 1.3 }}>
      <span style={{ color: "var(--text-muted)" }}>{k}</span>
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)", textAlign: "right" }}>{v}</span>
    </div>
  );
  const mz = s.mzRange ? `${s.mzRange[0].toFixed(0)}–${s.mzRange[1].toFixed(0)}` : "—";
  return (
    <div
      style={{
        marginTop: "auto",
        borderTop: "1px solid var(--border-default)",
        padding: "0.6rem 0.7rem",
        fontSize: "var(--text-sm)",
      }}
    >
      <div
        style={{
          fontSize: "var(--text-cap)",
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-caps)",
          color: "var(--text-muted)",
          marginBottom: "0.35rem",
        }}
      >
        File
      </div>
      {row("Spectra", s.numSpectra.toLocaleString())}
      {row("m/z", mz)}
      {row("Layout", s.layout)}
      {row("Imaging", s.isImaging ? "yes" : "no")}
      {preload &&
        buffered > 0 &&
        buffered < s.numSpectra &&
        row("Buffered", `${buffered.toLocaleString()} / ${s.numSpectra.toLocaleString()}`)}
    </div>
  );
}

export function App() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const stage = useStore((s) => s.stage);
  const error = useStore((s) => s.error);
  const fileName = useStore((s) => s.fileName);
  const sourceUrl = useStore((s) => s.sourceUrl);
  const numSpectra = useStore((s) => s.summary?.numSpectra);
  const openFile = useStore((s) => s.openFile);
  const openUrl = useStore((s) => s.openUrl);
  const selectByScanNumber = useStore((s) => s.selectByScanNumber);
  const showStoredChromatogram = useStore((s) => s.showStoredChromatogram);
  const setMsLevelFilter = useStore((s) => s.setMsLevelFilter);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const runXic = useStore((s) => s.runXic);
  const showTic = useStore((s) => s.showTic);
  const setSpectrumZoom = useStore((s) => s.setSpectrumZoom);
  const startPreload = useStore((s) => s.startPreload);

  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Deep link: ?file=<url> (alias ?url=) auto-opens an external mzPeak on load,
  // so links like .../mzPeakExplorer/?file=https://host/x.mzpeak start the viewer
  // directly on that file. The remote host must allow CORS + range requests.
  //
  // "Share view" carries the full view on the same link (see shareView.ts):
  //   ?tab= ?scan=/?spectrum= ?ms= ?xic=/?chrom=
  // so a recipient lands on exactly what the sharer saw. A miss (no such
  // scan/chromatogram) lands on the overview with an error banner.
  const deepLinkDone = useRef(false);
  const pendingTarget = useRef<ReturnType<typeof parseViewParams> | null>(null);
  useEffect(() => {
    if (deepLinkDone.current) return;
    deepLinkDone.current = true;
    const v = parseViewParams(window.location.search);
    pendingTarget.current = v;
    // Defer the background preloader when a spectrum OR a chromatogram is
    // deep-linked, so that target loads first instead of queuing behind the
    // preloader over HTTP (a TIC/XIC extraction is itself a large read).
    const deferPreload =
      v.scan != null || v.spectrum != null ||
      v.xic != null || v.xicmz != null || v.chrom != null;
    if (v.file && /^https?:\/\//i.test(v.file)) void openUrl(v.file, { deferPreload });
  }, [openUrl]);

  // Once the deep-linked file is open, replay the view: tab → MS filter →
  // spectrum → chromatogram. Runs once; best-effort + non-fatal.
  const targetApplied = useRef(false);
  useEffect(() => {
    if (targetApplied.current || stage !== "ready") return;
    const v = pendingTarget.current;
    if (!v) return;
    targetApplied.current = true;
    void (async () => {
      // A chromatogram is requested if any chrom-generating param is present.
      const wantChrom = v.xic != null || v.xicmz != null || v.chrom != null;
      const wantSpectrum = v.scan != null || v.spectrum != null;
      // Active tab: an explicit ?tab= wins (preserves existing share links);
      // otherwise a chromatogram param has priority over a spectrum, which has
      // priority over the summary default.
      const targetTab: Tab | undefined = v.tab
        ? (v.tab as Tab)
        : wantChrom
          ? "chromatograms"
          : wantSpectrum
            ? "spectra"
            : undefined;
      if (targetTab) setTab(targetTab); // early, for first paint
      if (v.ms != null && /^\d+$/.test(v.ms)) await setMsLevelFilter(Number(v.ms));

      // Both a spectrum AND a chromatogram may be set: apply both so each view is
      // ready, but render the one with priority first. The spectrum stays
      // selected, so switching to Spectra shows it. (Loaded before the preloader
      // starts — see deferPreload above.)
      const applySpectrum = async () => {
        if (v.scan != null) await selectByScanNumber(Number(v.scan));
        else if (v.spectrum != null && /^\d+$/.test(v.spectrum)) await selectSpectrum(Number(v.spectrum));
        if (v.mz != null) {
          const [lo, hi] = v.mz.split(",").map(Number);
          if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) setSpectrumZoom([lo, hi]);
        }
      };
      // Try the m/z forms in priority order, falling through when a higher-priority
      // one is malformed (so `?xicmz=bad&xic=445,0.01` still draws the XIC).
      const applyChrom = async () => {
        const rt = parsePair(v.rt); // RT window (seconds) — applies to TIC or XIC
        const range = parsePair(v.xicmz); // explicit m/z range, validated + ascending
        if (range) {
          // Convert the range to centre + half-window, rounding off binary-float
          // noise (e.g. (445.3-445.0)/2 = 0.150000…0568) so the XIC label and the
          // re-shared xic= link stay clean.
          const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
          await runXic(round6((range[0] + range[1]) / 2), round6((range[1] - range[0]) / 2), rt);
          return;
        }
        if (v.xic != null) {
          const [mz, tol] = v.xic.split(",").map(Number);
          if (Number.isFinite(mz) && Number.isFinite(tol) && tol > 0) { await runXic(mz, tol, rt); return; }
        }
        if (v.chrom === "tic") { await showTic(rt); return; }
        if (v.chrom != null) await showStoredChromatogram(v.chrom);
      };

      // Render the priority view's data first for the fastest first paint.
      if (targetTab === "chromatograms") {
        if (wantChrom) await applyChrom();
        if (wantSpectrum) await applySpectrum();
      } else {
        if (wantSpectrum) await applySpectrum();
        if (wantChrom) await applyChrom();
      }
      // Re-assert the intended tab LAST: selectByScanNumber() forces "spectra" and
      // showStoredChromatogram() forces "chromatograms" as side effects, which
      // would otherwise override the computed target (e.g. ?scan=…&xic=… must end
      // on Chromatograms; ?tab=chromatograms&scan=… must stay on Chromatograms).
      if (targetTab) setTab(targetTab);
      // The deep-linked target is in view — now let buffering begin.
      startPreload();
    })();
  }, [stage, setTab, setMsLevelFilter, selectByScanNumber, selectSpectrum, runXic, showTic, showStoredChromatogram, setSpectrumZoom, startPreload]);

  const [copied, setCopied] = useState(false);
  function shareView() {
    const s = useStore.getState();
    if (!s.sourceUrl) return;
    const selectedId =
      s.selectedIndex != null
        ? s.selectedSpectrum?.id ?? s.spectra[s.selectedIndex]?.id ?? null
        : null;
    const view: ViewState = {
      sourceUrl: s.sourceUrl,
      tab: s.tab,
      selectedIndex: s.selectedIndex,
      selectedId,
      msLevelFilter: s.msLevelFilter,
      chromMode: s.chromMode,
      xic: s.xicParams ? { mz: s.xicParams.mz, tolDa: s.xicParams.tolDa } : null,
      chromStoredId: s.chromStoredId,
      chromTimeRange: s.chromTimeRange,
      spectrumZoom: s.spectrumZoom,
    };
    const link = buildShareUrl(view, window.location.origin, window.location.pathname);
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  }

  const fileInput = useRef<HTMLInputElement>(null);
  function pickFile() {
    fileInput.current?.click();
  }

  const ready = stage === "ready";
  const loading = stage === "loading";

  const navItems: NavItem[] = NAV.map((it) => ({
    ...it,
    disabled: !ready,
    badge: it.id === "spectra" && ready && numSpectra != null ? numSpectra.toLocaleString() : undefined,
  }));

  const fileChip = ready && fileName && (
    <Badge tone="neutral" mono>
      <FileIcon size={13} style={{ marginRight: 2 }} />
      {fileName}
    </Badge>
  );

  const railWide: CSSProperties = {
    width: 220,
    flexShrink: 0,
    borderRight: "1px solid var(--border-default)",
    display: "flex",
    flexDirection: "column",
    background: "var(--surface-page)",
  };
  const railNarrow: CSSProperties = {
    borderBottom: "1px solid var(--border-default)",
    background: "var(--surface-page)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100%", background: "var(--surface-page)" }}>
      <input
        ref={fileInput}
        type="file"
        accept=".mzpeak"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openFile(f);
          e.target.value = "";
        }}
      />

      <AppHeader
        left={<Logo product="mzPeak Explorer" size={narrow ? 24 : 32} />}
        right={
          <>
            {fileChip}
            <SettingsMenu />
            {ready && sourceUrl && (
              <Button
                variant="ghost"
                size="sm"
                iconLeft={copied ? <Check size={15} /> : <Share2 size={15} />}
                onClick={shareView}
                title="Copy a link that reproduces this exact view — tab, spectrum, chromatogram, and MS-level filter (includes the dataset URL)"
              >
                {copied ? "Copied" : "Share view"}
              </Button>
            )}
            {ready ? (
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<FolderOpen size={15} />}
                onClick={pickFile}
              >
                Open file
              </Button>
            ) : (
              !loading && (
                <Button
                  variant="primary"
                  size="sm"
                  iconLeft={<FolderOpen size={15} />}
                  onClick={() => void openUrl(DEMO_URL)}
                >
                  Open demo
                </Button>
              )
            )}
          </>
        }
      />
      <div style={{ height: 2, background: "var(--openms-spectrum)", flexShrink: 0 }} />

      <div style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: narrow ? "column" : "row" }}>
        <aside style={narrow ? railNarrow : railWide}>
          {narrow ? (
            <div style={{ display: "flex", gap: "0.25rem", padding: "0.4rem 0.5rem", overflowX: "auto" }}>
              {navItems.map((it) => {
                const active = tab === it.id && ready;
                return (
                  <button
                    key={it.id}
                    onClick={() => ready && setTab(it.id as Tab)}
                    disabled={it.disabled}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      padding: "0.4rem 0.7rem",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      background: active ? "var(--accent-soft)" : "transparent",
                      color: active ? "var(--accent-active)" : "var(--text-secondary)",
                      fontWeight: "var(--weight-medium)",
                      fontSize: "var(--text-body)",
                      cursor: ready ? "pointer" : "not-allowed",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {it.icon}
                    {it.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <SideNav items={navItems} activeId={tab} onSelect={(id) => setTab(id as Tab)} />
              {ready && <MiniInspector />}
            </>
          )}
        </aside>

        <main style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "1.1rem 1.3rem", display: "flex", flexDirection: "column" }}>
          {error && <div className="banner-error" style={{ margin: "0 0 0.75rem" }}>{error}</div>}

          {/* Show the loader on error too, so a failed open (e.g. a bad deep
              link) can be recovered without a manual reload. */}
          {(stage === "idle" || stage === "error") && <IdleLoader />}

          {loading && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                color: "var(--text-muted)",
                justifyContent: "center",
                marginTop: "10vh",
                fontSize: "var(--text-body)",
              }}
            >
              <LoaderCircle size={18} className="spin" /> Reading file…
            </div>
          )}

          {ready && tab === "summary" && <SummaryTab />}
          {ready && tab === "metadata" && <MetadataTab />}
          {ready && tab === "spectra" && <SpectraTab />}
          {ready && tab === "chromatograms" && <ChromatogramsTab />}
          {ready && tab === "structure" && <StructureTab />}
        </main>
      </div>
    </div>
  );
}
