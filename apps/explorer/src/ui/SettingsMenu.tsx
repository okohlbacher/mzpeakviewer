import { useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { useStore } from "../state/store";

/** Header gear menu for cache settings: background-preload toggle + cache budget.
 *  Persisted per session in the store; presettable via ?preload= / ?cacheMB=. */
export function SettingsMenu() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Commit the MB field on blur/Enter (avoids re-evicting on every keystroke).
  const [mb, setMb] = useState(String(settings.cacheMB));
  useEffect(() => setMb(String(settings.cacheMB)), [settings.cacheMB]);
  const commitMb = () => {
    const v = Number(mb);
    setSettings({ cacheMB: Number.isFinite(v) ? v : settings.cacheMB });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Cache settings"
        aria-label="Cache settings"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0.32rem",
          border: `1px solid ${open ? "var(--accent)" : "var(--border-default)"}`,
          borderRadius: "var(--radius-sm)",
          background: "var(--surface-card)",
          color: open ? "var(--accent)" : "var(--text-secondary)",
          cursor: "pointer",
          transition: "var(--transition-ui)",
        }}
      >
        <SettingsIcon size={16} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Cache settings"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 50,
            width: 270,
            padding: "0.75rem 0.85rem",
            background: "var(--surface-card)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-1)",
            textAlign: "left",
          }}
        >
          <div
            style={{
              fontSize: "var(--text-cap)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-caps)",
              color: "var(--text-muted)",
              marginBottom: "0.55rem",
            }}
          >
            Cache
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "var(--text-sm)",
              color: "var(--text-body)",
              marginBottom: "0.7rem",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={settings.preload}
              onChange={(e) => setSettings({ preload: e.target.checked })}
              style={{ accentColor: "var(--accent)" }}
            />
            Preload spectra in background
          </label>

          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.3rem",
              fontSize: "var(--text-sm)",
              color: "var(--text-body)",
            }}
          >
            <span>Cache budget (MB)</span>
            <input
              type="number"
              min={0}
              max={4096}
              step={64}
              value={mb}
              onChange={(e) => setMb(e.target.value)}
              onBlur={commitMb}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitMb();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              style={{
                width: "6rem",
                padding: "0.3rem 0.45rem",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-sm)",
                font: "inherit",
                fontSize: "var(--text-body)",
                background: "var(--surface-card)",
                color: "var(--text-body)",
              }}
            />
          </label>

          <p
            style={{
              margin: "0.6rem 0 0",
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
              lineHeight: "var(--leading-snug)",
            }}
          >
            Saved for this browser session. Preset a link with{" "}
            <code>?preload=0</code> and <code>?cacheMB=512</code>.
          </p>
        </div>
      )}
    </div>
  );
}
