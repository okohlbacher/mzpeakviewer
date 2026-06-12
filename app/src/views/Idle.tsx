// The idle / loading / first-open screen — a compelling start page (Explorer-style):
// a drop-zone, a row of one-click demo files, and a URL field. Shown until a file is
// open; replaced by the capability sidebar + views once ready.
import { useRef, useState } from "react";
import { useStore } from "../store";

const BASE = import.meta.env.BASE_URL;

type Demo = { id: string; label: string; desc: string; file: string; imaging: boolean };
const DEMOS: Demo[] = [
  { id: "imaging", label: "Imaging (MSI)", desc: "Tiny 3×3 ion-image grid + per-pixel spectra", file: "demo.mzpeak", imaging: true },
  { id: "lc", label: "LC-MS", desc: "48 spectra, MS levels 1/2, a TIC chromatogram", file: "lc.mzpeak", imaging: false },
  { id: "chunked", label: "Chunked layout", desc: "Chunked storage variant of the spectra", file: "chunked.mzpeak", imaging: false },
];

export function Idle() {
  const phase = useStore((s) => s.phase);
  const fileName = useStore((s) => s.fileName);
  const error = useStore((s) => s.error);
  const openFile = useStore((s) => s.openFile);
  const openUrl = useStore((s) => s.openUrl);
  const fileInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState("");

  const loading = phase === "loading";

  function take(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".mzpeak")) {
      useStore.setState({ error: "Please choose a .mzpeak file." });
      return;
    }
    void openFile(file);
  }

  return (
    <div data-testid="idle-view" style={{ width: "100%", overflowY: "auto", display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 640, width: "100%", padding: "6vh 1.5rem 3rem", textAlign: "center" }}>
        <img
          src={`${BASE}mzpeak-logo.png`}
          alt="mzPeak"
          style={{ height: 54, width: "auto", margin: "0 auto 1.1rem", display: "block" }}
        />
        <h1 style={{ margin: "0 0 0.4rem", fontSize: "1.25rem", color: "var(--text-heading, #1e293b)", fontWeight: "var(--weight-semibold, 600)" }}>
          Explore a mass-spectrometry file
        </h1>
        <p style={{ margin: "0 0 1.5rem", color: "var(--text-muted, #64748b)", fontSize: "var(--text-body, 0.9rem)", lineHeight: 1.5 }}>
          One viewer for the <strong>mzPeak</strong> mass-spectrometry format — imaging (MSI) and LC-MS alike. Pick an
          <em> m/z</em>, get an ion image, click a pixel, see its spectrum. Everything runs in your browser; nothing is uploaded.
        </p>

        {loading ? (
          <div data-testid="idle-loading" style={{ padding: "2rem", color: "var(--text-secondary, #475569)" }}>
            <Spinner /> Opening {fileName ?? "file"}…
          </div>
        ) : (
          <>
            {/* Drop-zone / file picker */}
            <div
              data-testid="idle-dropzone"
              role="button"
              tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
              style={{
                border: `2px dashed ${over ? "var(--blue-600, #3b54da)" : "var(--border-default, #cbd5e1)"}`,
                background: over ? "var(--blue-50, #eef2ff)" : "var(--surface-card, #fff)",
                borderRadius: 12, padding: "1.75rem 1rem", cursor: "pointer", transition: "all 0.12s",
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #94a3b8)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ width: 30, height: 30, marginBottom: 8 }}>
                <path d="M12 16V4m0 0L8 8m4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              <div style={{ fontWeight: "var(--weight-medium, 500)", color: "var(--text-secondary, #334155)" }}>
                Drop a <code>.mzpeak</code> file here, or click to browse
              </div>
            </div>
            <input ref={fileInput} type="file" accept=".mzpeak" style={{ display: "none" }}
              onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />

            {/* Demo files */}
            <div style={{ margin: "1.5rem 0 0.5rem", color: "var(--text-muted, #94a3b8)", fontSize: "var(--text-sm, 0.8rem)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Or try a demo file
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.6rem", textAlign: "left" }}>
              {DEMOS.map((d) => (
                <button
                  key={d.id}
                  data-testid={`demo-${d.id}`}
                  onClick={() => void openUrl(`${BASE}${d.file}`)}
                  style={{
                    display: "flex", flexDirection: "column", gap: "0.2rem", padding: "0.7rem 0.85rem",
                    border: "1px solid var(--border-default, #e2e8f0)", borderRadius: 10, background: "var(--surface-card, #fff)",
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: "var(--weight-semibold, 600)", color: "var(--text-heading, #1e293b)" }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: d.imaging ? "var(--blue-600, #3b54da)" : "var(--success, #16a34a)" }} />
                    {d.label}
                  </span>
                  <span style={{ fontSize: "var(--text-sm, 0.8rem)", color: "var(--text-muted, #94a3b8)" }}>{d.desc}</span>
                </button>
              ))}
            </div>

            {/* Remote URL */}
            <form
              onSubmit={(e) => { e.preventDefault(); const u = url.trim(); if (u) void openUrl(u); }}
              style={{ marginTop: "1.25rem", display: "flex", gap: "0.5rem" }}
            >
              <input
                data-testid="idle-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="…or paste a https:// .mzpeak URL"
                style={{ flex: 1, padding: "0.5rem 0.7rem", border: "1px solid var(--border-default, #e2e8f0)", borderRadius: 8, fontSize: "var(--text-sm, 0.85rem)" }}
              />
              <button type="submit" disabled={!url.trim()} style={{ padding: "0.5rem 1rem", border: "1px solid var(--blue-600, #3b54da)", borderRadius: 8, background: "var(--blue-600, #3b54da)", color: "#fff", cursor: url.trim() ? "pointer" : "not-allowed", fontWeight: "var(--weight-medium, 500)" }}>
                Load
              </button>
            </form>

            {error && (
              <p data-testid="idle-error" style={{ marginTop: "1rem", color: "var(--danger, #dc2626)", fontSize: "var(--text-sm, 0.85rem)" }}>
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span aria-hidden style={{ display: "inline-block", width: 16, height: 16, marginRight: 8, verticalAlign: "-2px", border: "2px solid var(--border-default, #cbd5e1)", borderTopColor: "var(--blue-600, #3b54da)", borderRadius: "50%", animation: "mz-spin 0.8s linear infinite" }}>
      <style>{`@keyframes mz-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
