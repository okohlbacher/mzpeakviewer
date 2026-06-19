// Settings gear + popover — edits the browser-persisted XIC defaults (m/z tolerance,
// RT half-window) used by the peak→chromatogram popover and the add-XIC form. Mirrors
// AboutButton's lightweight inline-styled popover (dismiss on outside-click / Esc).
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useStore } from "./store";

// Local draft string so intermediate values ("0.", "") don't get reverted mid-typing.
// Commit only on blur or Enter (not per keystroke — that fed the value back through the
// reset effect and stripped trailing digits); invalid drafts snap back to the stored value.
function DraftNumInput({ testid, value, onCommit, style }: { testid: string; value: number; onCommit: (v: number) => void; style: CSSProperties }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => { const v = Number(draft); if (Number.isFinite(v) && v > 0) onCommit(v); else setDraft(String(value)); };
  return (
    <input
      data-testid={testid} type="number" step="any" min="0" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onBlur={commit}
      style={style}
    />
  );
}

export function SettingsButton() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    }
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") close(); }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const numInput = {
    width: "5rem", padding: "0.25rem 0.4rem", border: "1px solid var(--border-default, #e2e8f0)",
    borderRadius: "var(--radius-sm, 4px)", fontFamily: "var(--font-mono, monospace)", fontSize: "0.8rem",
    background: "var(--surface-input, #fff)", color: "var(--text-heading, #0f172a)",
  };

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        data-testid="settings-btn"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.25rem 0.5rem", fontSize: "0.8rem", lineHeight: 1, color: "var(--text-secondary, #475569)", background: "transparent", border: "1px solid var(--border-subtle, #e2e8f0)", borderRadius: "var(--radius-sm, 4px)", cursor: "pointer" }}
      >
        <span aria-hidden="true" style={{ fontSize: "0.95rem" }}>⚙</span>
        Settings
      </button>

      {open && (
        <div
          data-testid="settings-panel"
          role="dialog"
          aria-label="Settings"
          style={{ position: "absolute", top: "calc(100% + 0.4rem)", right: 0, zIndex: 50, minWidth: 248, padding: "0.85rem 0.95rem", display: "flex", flexDirection: "column", gap: "0.7rem", background: "var(--surface-panel, #ffffff)", border: "1px solid var(--border-subtle, #e2e8f0)", borderRadius: "var(--radius-md, 8px)", boxShadow: "var(--shadow-md, 0 8px 24px rgba(15,23,42,0.14))", textAlign: "left" }}
        >
          <span style={{ fontWeight: "var(--weight-medium, 500)", fontSize: "0.85rem", color: "var(--text-primary, #0f172a)" }}>Chromatogram defaults</span>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", fontSize: "0.8rem", color: "var(--text-muted, #64748b)" }}>
            XIC m/z tolerance (± Da)
            <DraftNumInput testid="settings-xic-tol" value={settings.xicTolDa} onCommit={(v) => setSetting("xicTolDa", v)} style={numInput} />
          </label>
          <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", fontSize: "0.8rem", color: "var(--text-muted, #64748b)" }}>
            XIC RT half-window (± min)
            <DraftNumInput testid="settings-xic-rt" value={settings.xicRtHalfMin} onCommit={(v) => setSetting("xicRtHalfMin", v)} style={numInput} />
          </label>
          <span style={{ fontSize: "0.72rem", color: "var(--text-muted, #94a3b8)" }}>
            Defaults for right-click-a-peak → chromatogram and the Add-XIC form. Stored in this browser.
          </span>
        </div>
      )}
    </span>
  );
}
