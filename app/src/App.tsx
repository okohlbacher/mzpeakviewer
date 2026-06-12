// mzPeak Viewer — capability-adaptive multi-view shell.
//
// Layout:
//   ┌────────────────────────────────────────────────┐
//   │ TopBar: app title + file input                 │
//   ├──────────────┬─────────────────────────────────┤
//   │ Left sidebar │ Center view area                │
//   │ (capability- │                                 │
//   │  gated nav)  │                                 │
//   └──────────────┴─────────────────────────────────┘
//
// NAV-06 a11y: sidebar is a real tablist (role=tablist/tab/tabpanel) with
// aria-selected, roving tabindex, Enter/Space/Arrow key handling.
// Accordions are button[aria-expanded] per ARIA disclosure pattern.

import { useRef, type KeyboardEvent, useCallback } from "react";
import "@mzpeak/ui-kit/styles.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";

import { useStore, showChromatograms } from "./store";
import type { View } from "@mzpeak/contracts";
import { Summary } from "./views/Summary";
import { Spectra } from "./views/Spectra";
import { Chromatograms } from "./views/Chromatograms";
import { Metadata } from "./views/Metadata";
import { Structure } from "./views/Structure";
import { IonImageView } from "./views/IonImage";
import { engine } from "./engine";
import { ShareButton } from "./ShareButton";

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar() {
  const phase = useStore((s) => s.phase);
  const view = useStore((s) => s.view);
  const capabilities = useStore((s) => s.capabilities);
  const expanded = useStore((s) => s.expanded);
  const setView = useStore((s) => s.setView);
  const toggleAccordion = useStore((s) => s.toggleAccordion);

  const ready = phase === "ready";
  const caps = capabilities;

  // Show chromatograms if the capability helper says so
  const showChrom = caps ? showChromatograms(caps) : false;
  const isImaging = caps ? caps.imaging.isImaging : false;

  // Build the flat list of VISIBLE tab items for roving tabindex.
  // FINDING 3: only include tabs whose containing accordion is expanded (or tabs
  // that are always-visible outside an accordion). Arrow-key nav must never focus
  // a button that is hidden inside a collapsed accordion region.
  const allTabs: View[] = ["summary", "spectra"];
  if (showChrom) allTabs.push("chromatograms");
  // Advanced accordion items — only when the accordion is open.
  if (expanded.advanced) allTabs.push("metadata", "structure");
  // MSI accordion items — only when imaging AND the accordion is open.
  if (isImaging && expanded.imaging) {
    allTabs.push("ion", "grid");
  }

  // When the active view is inside a collapsed accordion, auto-expand it so
  // the active tab is always reachable in the roving set.
  const advancedViews: View[] = ["metadata", "structure"];
  const imagingViews: View[] = ["ion", "grid", "optical", "overlay"];
  const activeNeedsAdvanced = advancedViews.includes(view) && !expanded.advanced;
  const activeNeedsImaging = imagingViews.includes(view) && isImaging && !expanded.imaging;
  if (activeNeedsAdvanced) {
    // Expand synchronously via the store action on next render — use useEffect
    // equivalent: schedule a microtask so we don't call set inside render.
    Promise.resolve().then(() => toggleAccordion("advanced"));
  }
  if (activeNeedsImaging) {
    Promise.resolve().then(() => toggleAccordion("imaging"));
  }

  const tabRefs = useRef<Map<View, HTMLButtonElement>>(new Map());

  function setTabRef(id: View, el: HTMLButtonElement | null) {
    if (el) tabRefs.current.set(id, el);
    else tabRefs.current.delete(id);
  }

  const handleTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, id: View) => {
      const idx = allTabs.indexOf(id);
      if (idx === -1) return;
      let next = -1;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        next = (idx + 1) % allTabs.length;
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        next = (idx - 1 + allTabs.length) % allTabs.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        next = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        next = allTabs.length - 1;
      }
      if (next >= 0) {
        const nextId = allTabs[next];
        if (nextId) {
          tabRefs.current.get(nextId)?.focus();
        }
      }
    },
    [allTabs],
  );

  function handleTabActivate(id: View, e: KeyboardEvent | React.MouseEvent) {
    if (!ready) return;
    if (
      e.type === "click" ||
      (e as KeyboardEvent).key === "Enter" ||
      (e as KeyboardEvent).key === " "
    ) {
      if ((e as KeyboardEvent).key === " ") e.preventDefault();
      setView(id);
    }
  }

  const tabPanelId = "main-view-panel";

  function TabButton({
    id,
    label,
    depth = 0,
  }: {
    id: View;
    label: string;
    depth?: number;
  }) {
    const isActive = view === id;
    const isPlaceholder = id === "ion" || id === "optical" || id === "overlay" || id === "grid";
    return (
      <button
        ref={(el) => setTabRef(id, el)}
        role="tab"
        id={`tab-${id}`}
        aria-selected={isActive}
        aria-controls={tabPanelId}
        tabIndex={isActive ? 0 : -1}
        data-testid={`nav-tab-${id}`}
        // FINDING 4: visible focus ring class; pseudo-selector styles injected
        // via the <style> tag in the sidebar (inline styles can't cover :focus-visible).
        className="mzpeak-tab-btn"
        disabled={!ready && !isPlaceholder}
        onClick={(e) => handleTabActivate(id, e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleTabActivate(id, e);
          handleTabKeyDown(e, id);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          padding: `0.4rem 0.75rem 0.4rem ${0.75 + depth * 0.75}rem`,
          border: "none",
          background: isActive ? "var(--accent-soft, rgba(59,130,246,0.1))" : "transparent",
          color: isActive
            ? "var(--accent-active, #2563eb)"
            : ready
              ? "var(--text-secondary, #64748b)"
              : "var(--text-muted, #94a3b8)",
          fontWeight: isActive ? "var(--weight-semibold, 600)" : "var(--weight-normal, 400)",
          fontSize: "var(--text-body, 0.875rem)",
          cursor: ready ? "pointer" : "not-allowed",
          textAlign: "left",
          borderRadius: 0,
          borderLeft: isActive ? "2px solid var(--accent, #3b82f6)" : "2px solid transparent",
          transition: "background 0.1s, color 0.1s",
        }}
      >
        {label}
        {id === "grid" ? (
          <span
            style={{
              marginLeft: "auto",
              fontSize: "var(--text-xs, 0.75rem)",
              color: "var(--text-muted, #94a3b8)",
              fontStyle: "italic",
            }}
          >
            soon
          </span>
        ) : null}
      </button>
    );
  }

  function AccordionHeader({
    accordionKey,
    label,
    open,
    testid,
  }: {
    accordionKey: "advanced" | "imaging";
    label: string;
    open: boolean;
    testid?: string;
  }) {
    const headId = `accordion-head-${accordionKey}`;
    const bodyId = `accordion-body-${accordionKey}`;
    return (
      <button
        id={headId}
        aria-expanded={open}
        aria-controls={bodyId}
        data-testid={testid ?? `accordion-${accordionKey}`}
        onClick={() => toggleAccordion(accordionKey)}
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          padding: "0.35rem 0.75rem",
          border: "none",
          background: "transparent",
          color: "var(--text-muted, #94a3b8)",
          fontSize: "var(--text-xs, 0.75rem)",
          fontWeight: "var(--weight-semibold, 600)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          cursor: "pointer",
          textAlign: "left",
          marginTop: "0.25rem",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            width: "0.85rem",
            height: "0.85rem",
            marginRight: "0.3rem",
            flexShrink: 0,
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 0.15s",
          }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        {label}
      </button>
    );
  }

  return (
    <aside
      style={{
        width: 200,
        flexShrink: 0,
        borderRight: "1px solid var(--border-default, #e2e8f0)",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-page, #f8fafc)",
        overflowY: "auto",
      }}
    >
      {/* FINDING 4: inject focus-visible ring for tab buttons. Inline styles
          can't express :focus-visible; a scoped <style> is the minimal fix. */}
      <style>{`
        .mzpeak-tab-btn:focus-visible {
          outline: 2px solid var(--focus-ring, var(--accent, #3b82f6));
          outline-offset: -2px;
          z-index: 1;
          position: relative;
        }
      `}</style>
      <div
        role="tablist"
        aria-label="Views"
        aria-orientation="vertical"
        style={{ display: "flex", flexDirection: "column", paddingTop: "0.5rem" }}
      >
        {/* Always-on entries */}
        <TabButton id="summary" label="Summary" />
        <TabButton id="spectra" label="Spectra" />

        {/* Chromatograms — shown when capability gate passes */}
        {showChrom && (
          <TabButton id="chromatograms" label="Chromatograms" data-testid="nav-tab-chromatograms" />
        )}

        {/* Advanced accordion */}
        <AccordionHeader
          accordionKey="advanced"
          label="Advanced"
          open={expanded.advanced}
          testid="accordion-advanced"
        />
        <div
          id="accordion-body-advanced"
          role="region"
          aria-labelledby="accordion-head-advanced"
          hidden={!expanded.advanced}
        >
          <TabButton id="metadata" label="Metadata" depth={1} />
          <TabButton id="structure" label="Structure" depth={1} />
        </div>

        {/* MSI accordion — only when isImaging */}
        {isImaging && (
          <>
            <AccordionHeader
              accordionKey="imaging"
              label="Imaging (MSI)"
              open={expanded.imaging}
              testid="accordion-msi"
            />
            <div
              id="accordion-body-imaging"
              role="region"
              aria-labelledby="accordion-head-imaging"
              hidden={!expanded.imaging}
              data-testid="msi-accordion-body"
            >
              <TabButton id="ion" label="Ion image" depth={1} />
              <TabButton id="grid" label="Grid" depth={1} />
            </div>
          </>
        )}
      </div>

      {/* Mini file stats at the bottom */}
      {ready && <MiniStats />}
    </aside>
  );
}

function MiniStats() {
  const stats = useStore((s) => s.stats);
  const caps = useStore((s) => s.capabilities);
  if (!stats) return null;
  return (
    <div
      style={{
        marginTop: "auto",
        borderTop: "1px solid var(--border-default, #e2e8f0)",
        padding: "0.6rem 0.75rem",
        fontSize: "var(--text-xs, 0.75rem)",
      }}
    >
      <div
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--text-muted, #94a3b8)",
          marginBottom: "0.3rem",
          fontWeight: "var(--weight-semibold, 600)",
        }}
      >
        File
      </div>
      {/* data-testid attrs here serve both the mini-stats UI and the e2e
          contracts — always present when a file is open. */}
      <MiniRow
        k="Spectra"
        v={<span data-testid="num-spectra">{stats.numSpectra.toLocaleString()}</span>}
      />
      {stats.mzRange && (
        <MiniRow
          k="m/z"
          v={`${stats.mzRange[0].toFixed(0)}–${stats.mzRange[1].toFixed(0)}`}
        />
      )}
      {caps && <MiniRow k="Layout" v={caps.layout} />}
      {caps && (
        <MiniRow
          k="Imaging"
          v={<span data-testid="is-imaging">{caps.imaging.isImaging ? "yes" : "no"}</span>}
        />
      )}
    </div>
  );
}

import type { ReactNode } from "react";

function MiniRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", lineHeight: 1.5 }}>
      <span style={{ color: "var(--text-muted, #94a3b8)" }}>{k}</span>
      <span
        style={{
          fontFamily: "var(--font-mono, monospace)",
          color: "var(--text-secondary, #64748b)",
          textAlign: "right",
        }}
      >
        {v}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IonImage placeholder (the real view is another agent's file)
// ---------------------------------------------------------------------------

/** Ion-image view: wires the store's grid + the engine render call + pixel→spectrum. */
function IonImagePanel() {
  const grid = useStore((s) => s.grid);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  if (!grid) {
    return (
      <div data-testid="ion-no-grid" style={{ color: "var(--text-muted, #94a3b8)" }}>
        No imaging grid available for this file.
      </div>
    );
  }
  return (
    <div data-testid="ion-image-view">
      <IonImageView
        grid={grid}
        renderIonImage={(mz, tolDa) => engine.renderIonImage(mz, tolDa)}
        onPickSpectrum={(idx) => {
          void selectSpectrum(idx); // routes to the Spectra view (store action)
        }}
      />
    </div>
  );
}

function GridPlaceholder() {
  return (
    <div
      data-testid="grid-placeholder"
      style={{
        padding: "2rem",
        border: "1px dashed var(--border-default, #e2e8f0)",
        borderRadius: "var(--radius-md, 6px)",
        color: "var(--text-muted, #94a3b8)",
        textAlign: "center",
        maxWidth: 480,
      }}
    >
      <p style={{ margin: 0, fontWeight: "var(--weight-medium, 500)" }}>Grid</p>
      <p style={{ margin: "0.25rem 0 0", fontSize: "var(--text-sm, 0.875rem)" }}>
        Imaging grid inspector — coming in a later slice.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TopBar
// ---------------------------------------------------------------------------

function TopBar() {
  const phase = useStore((s) => s.phase);
  const fileName = useStore((s) => s.fileName);
  const openFile = useStore((s) => s.openFile);
  const openUrl = useStore((s) => s.openUrl);
  const busy = phase === "loading";
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.55rem 1rem",
        borderBottom: "1px solid var(--border-default, #e2e8f0)",
        background: "var(--surface-page, #f8fafc)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontWeight: "var(--weight-semibold, 600)",
          fontSize: "1rem",
          color: "var(--text-heading, #1e293b)",
          letterSpacing: "-0.01em",
          userSelect: "none",
        }}
      >
        mzPeak Viewer
      </span>

      {fileName && (
        <span
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "var(--text-sm, 0.875rem)",
            color: "var(--text-muted, #94a3b8)",
            background: "var(--surface-panel, #f1f5f9)",
            padding: "0.15rem 0.5rem",
            borderRadius: "var(--radius-sm, 4px)",
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={fileName}
        >
          {fileName}
        </span>
      )}

      <span style={{ marginLeft: "auto" }}>
        <ShareButton />
      </span>

      {/* Hidden input is NOT wrapped in a label — clicking the buttons below calls
          .click() exactly ONCE. (A label wrapper + an explicit .click() double-fires
          and re-opens the native dialog — the bug this replaces.) */}
      <input
        ref={fileInputRef}
        data-testid="file-input"
        type="file"
        accept=".mzpeak"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openFile(file);
          e.target.value = "";
        }}
        style={{ display: "none" }}
      />

      <button
        type="button"
        data-testid="load-demo-btn"
        disabled={busy}
        onClick={() => void openUrl(`${import.meta.env.BASE_URL}demo.mzpeak`)}
        style={{
          marginLeft: "0.5rem",
          padding: "0.35rem 0.75rem",
          border: "1px solid var(--border-default, #e2e8f0)",
          borderRadius: "var(--radius-sm, 4px)",
          background: "var(--surface-card, #fff)",
          color: "var(--text-secondary, #64748b)",
          fontSize: "var(--text-sm, 0.875rem)",
          fontWeight: "var(--weight-medium, 500)",
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        Load demo
      </button>

      <button
        type="button"
        data-testid="open-file-btn"
        disabled={busy}
        onClick={() => fileInputRef.current?.click()}
        style={{
          marginLeft: "0.4rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          padding: "0.35rem 0.75rem",
          border: "1px solid var(--border-default, #e2e8f0)",
          borderRadius: "var(--radius-sm, 4px)",
          background: busy ? "var(--surface-panel, #f1f5f9)" : "var(--surface-card, #fff)",
          color: busy ? "var(--text-muted, #94a3b8)" : "var(--text-secondary, #64748b)",
          fontSize: "var(--text-sm, 0.875rem)",
          fontWeight: "var(--weight-medium, 500)",
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ width: "0.9rem", height: "0.9rem" }}
        >
          <path d="M5 12H3l9-9 9 9h-2" />
          <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
        </svg>
        {busy ? "Opening…" : "Open file"}
      </button>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      data-testid="error"
      role="alert"
      style={{
        padding: "0.6rem 1rem",
        background: "var(--danger-soft, #fef2f2)",
        borderBottom: "1px solid var(--danger, #ef4444)",
        color: "var(--danger, #dc2626)",
        fontSize: "var(--text-sm, 0.875rem)",
        flexShrink: 0,
      }}
    >
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status bar (loading indicator)
// ---------------------------------------------------------------------------

function StatusBar() {
  const phase = useStore((s) => s.phase);
  if (phase !== "loading") return null;
  return (
    <div
      data-testid="status"
      style={{
        padding: "0.5rem 1rem",
        background: "var(--accent-soft, rgba(59,130,246,0.07))",
        color: "var(--accent-active, #2563eb)",
        fontSize: "var(--text-sm, 0.875rem)",
        flexShrink: 0,
        borderBottom: "1px solid var(--border-default, #e2e8f0)",
      }}
    >
      Opening file…
    </div>
  );
}

// ---------------------------------------------------------------------------
// View router
// ---------------------------------------------------------------------------

function ViewRouter() {
  const view = useStore((s) => s.view);

  return (
    <div
      id="main-view-panel"
      role="tabpanel"
      aria-labelledby={`tab-${view}`}
      tabIndex={0}
      style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", padding: "1.25rem 1.5rem" }}
    >
      {view === "summary" && <Summary />}
      {view === "spectra" && <Spectra />}
      {view === "chromatograms" && <Chromatograms />}
      {view === "metadata" && <Metadata />}
      {view === "structure" && <Structure />}
      {view === "ion" && <IonImagePanel />}
      {view === "grid" && <GridPlaceholder />}
      {view === "optical" && (
        <div data-testid="optical-placeholder">
          Optical image viewer — coming in a later slice.
        </div>
      )}
      {view === "overlay" && (
        <div data-testid="overlay-placeholder">
          Overlay — coming in a later slice.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notice banners
// ---------------------------------------------------------------------------

function NoticeBar() {
  const notices = useStore((s) => s.notices);
  const dismiss = useStore((s) => s.dismissNotice);
  if (notices.length === 0) return null;
  return (
    <div style={{ flexShrink: 0 }}>
      {notices.map((n) => (
        <div
          key={n.id}
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.4rem 1rem",
            background:
              n.severity === "error"
                ? "var(--danger-soft, #fef2f2)"
                : n.severity === "warning"
                  ? "var(--warning-soft, #fffbeb)"
                  : "var(--info-soft, #eff6ff)",
            borderBottom: "1px solid var(--border-default, #e2e8f0)",
            fontSize: "var(--text-sm, 0.875rem)",
            color:
              n.severity === "error"
                ? "var(--danger, #dc2626)"
                : n.severity === "warning"
                  ? "var(--warning, #d97706)"
                  : "var(--info, #2563eb)",
          }}
        >
          <span style={{ flex: 1 }}>{n.message}</span>
          <button
            onClick={() => dismiss(n.id)}
            aria-label="Dismiss"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.1rem 0.25rem",
              color: "inherit",
              opacity: 0.7,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

export function App() {
  const error = useStore((s) => s.error);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        background: "var(--surface-page, #f8fafc)",
        fontFamily: "var(--font-sans, 'IBM Plex Sans', sans-serif)",
        overflow: "hidden",
      }}
    >
      <TopBar />
      {error && <ErrorBanner message={error} />}
      <StatusBar />
      <NoticeBar />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Sidebar />
        <ViewRouter />
      </div>
    </div>
  );
}
