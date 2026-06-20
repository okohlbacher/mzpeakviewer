// "About" button + popover. Surfaces the running build's provenance —
// app version, short git SHA, build date, and platform (web vs desktop) — so a
// user can tell which build they're on at a glance (stale-deploy confusion).
//
// Dependency-free: a subtle "ⓘ About" button opens a lightweight popover built
// from inline styles + CSS-var fallbacks (matching ShareButton's idiom). The
// panel is dismissible via the close button, clicking outside, or Esc.
//
// Values come from build-time `define` constants (see app/vite.config.ts):
//   __APP_VERSION__ — from src-tauri/tauri.conf.json (single source of truth)
//   __BUILD_SHA__   — short git SHA, or "dev" when git is absent
//   __BUILD_DATE__  — ISO timestamp captured at build time

import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriApp } from "./urlSync";

const RELEASES_URL = "https://github.com/okohlbacher/mzpeakviewer/releases";

// Platform is a RUNTIME signal: the desktop app's origin is "tauri://…", which
// isTauriApp() detects. Everything else is the web build.
const PLATFORM = isTauriApp() ? "desktop" : "web";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1.5rem", alignItems: "baseline" }}>
      <span style={{ color: "var(--text-muted, #94a3b8)", fontSize: "0.78rem" }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: "0.8rem",
          color: "var(--text-primary, #0f172a)",
          textAlign: "right",
        }}
      >
        {children}
      </span>
    </div>
  );
}

export function AboutButton() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Dismiss on outside-click and Esc while the panel is open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        data-testid="about-btn"
        aria-label="About this build"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          padding: "0.25rem 0.5rem",
          fontSize: "0.8rem",
          lineHeight: 1,
          color: "var(--text-secondary, #475569)",
          background: "transparent",
          border: "1px solid var(--border-subtle, #e2e8f0)",
          borderRadius: "var(--radius-sm, 4px)",
          cursor: "pointer",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: "0.95rem" }}>
          ⓘ
        </span>
        About
      </button>

      {open && (
        <div
          data-testid="about-panel"
          role="dialog"
          aria-label="About this build"
          style={{
            position: "absolute",
            top: "calc(100% + 0.4rem)",
            right: 0,
            zIndex: 50,
            minWidth: 248,
            padding: "0.85rem 0.95rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.55rem",
            background: "var(--surface-panel, #ffffff)",
            border: "1px solid var(--border-subtle, #e2e8f0)",
            borderRadius: "var(--radius-md, 8px)",
            boxShadow: "var(--shadow-md, 0 8px 24px rgba(15,23,42,0.14))",
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span
              style={{
                fontWeight: "var(--weight-medium, 500)",
                fontSize: "0.85rem",
                color: "var(--text-primary, #0f172a)",
              }}
            >
              mzPeakViewer
            </span>
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--text-muted, #94a3b8)",
                cursor: "pointer",
                fontSize: "1rem",
                lineHeight: 1,
                padding: "0 0.2rem",
              }}
            >
              ×
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <Row label="Version">
              <span data-testid="about-version">{__APP_VERSION__}</span>
            </Row>
            <Row label="Commit">
              <span data-testid="about-sha">{__BUILD_SHA__}</span>
            </Row>
            <Row label="Built">
              <span data-testid="about-date">{__BUILD_DATE__}</span>
            </Row>
            <Row label="Platform">
              <span data-testid="about-platform">{PLATFORM}</span>
            </Row>
          </div>

          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="about-releases-link"
            style={{
              fontSize: "0.78rem",
              color: "var(--accent, #2563eb)",
              textDecoration: "none",
            }}
          >
            Releases & changelog ↗
          </a>
        </div>
      )}
    </span>
  );
}
