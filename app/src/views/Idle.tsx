// The idle / loading / first-open screen — a compelling start page: a drop-zone, a
// row of curated demo datasets, and a URL field. Each demo offers TWO ways to open:
//   (a) ☁ Open from cloud  → stream from S3/CDN via HTTP range reads (openUrl)
//   (b) ⤓ Download & open   → fetch the whole file (saved to disk) + open it locally
// Shown until a file is open; replaced by the capability sidebar + views once ready.
import { useRef, useState } from "react";
import { useStore } from "../store";

const BASE = import.meta.env.BASE_URL;

// Curated demo datasets, served from the data.mzpeak.org / StackIT CDN. Stat chips are
// real facts. NOTE: the Bruker micrOTOF is pending publication to the CDN — its card
// works once the object is uploaded (the other two are live now).
type Demo = {
  id: string;
  label: string;
  desc: string;
  kind: "ms" | "imaging" | "sdrf";
  url: string;          // CDN object URL
  download: string;     // filename used when saved to disk
  stats: string[];
};
const CDN = "https://data.mzpeak.org/v09";
const DEMOS: Demo[] = [
  {
    id: "bruker",
    label: "Bruker QTOF — general MS",
    desc: "Bruker micrOTOF-Q II ESI-QTOF run (MetaboLights MTBLS520)",
    kind: "ms",
    url: `${CDN}/mzML-examples/bruker-microtof-q2/neg_01_Fistax_1-A%2C2_01_5715.mzpeak`,
    download: "bruker-microTOF-Q-II-MTBLS520.mzpeak",
    stats: ["~38 MB", "micrOTOF-Q II", "MTBLS520"],
  },
  {
    id: "imaging",
    label: "Imaging — mouse urinary bladder",
    desc: "AP-SMALDI MSI: ion images, optical overlay, per-pixel spectra",
    kind: "imaging",
    url: `${CDN}/imzml-examples/PXD001283-HR2MSI-urinary-bladder/HR2MSImouseurinarybladderS096.mzpeak`,
    download: "HR2MSI-mouse-urinary-bladder.mzpeak",
    stats: ["~310 MB", "260 × 134 px", "optical"],
  },
  {
    id: "tmt",
    label: "SDRF — TMT 10-plex",
    desc: "PXD011799 TiO₂ TMT fraction; SDRF channel/sample model",
    kind: "sdrf",
    url: `${CDN}/sdrf-examples/PXD011799/mzpeak/20170131_Lumos_RSLC4_Maurer_Hartl_UW_MFPL_TiO2_TMT_fr8.mzpeak`,
    download: "PXD011799-TMT10plex-fr8.mzpeak",
    stats: ["~90 MB", "TMT 10-plex", "SDRF"],
  },
];

const KIND_COLOR: Record<Demo["kind"], string> = {
  ms: "var(--success, #16a34a)",
  imaging: "var(--blue-600, #3b54da)",
  sdrf: "var(--signal, #c00000)",
};

export function Idle() {
  const phase = useStore((s) => s.phase);
  const fileName = useStore((s) => s.fileName);
  const error = useStore((s) => s.error);
  const openFile = useStore((s) => s.openFile);
  const openUrl = useStore((s) => s.openUrl);
  const fileInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState("");
  // Per-card download state: which demo is downloading + its progress (null = unknown).
  const [dl, setDl] = useState<{ id: string; pct: number | null } | null>(null);
  const [dlErr, setDlErr] = useState<string | null>(null);

  const loading = phase === "loading";

  function take(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".mzpeak")) {
      useStore.setState({ error: "Please choose a .mzpeak file." });
      return;
    }
    void openFile(file);
  }

  // Download the whole object (streamed, with progress), save it to disk, then open
  // the in-memory copy locally (whole-file read — the "local filesystem" path).
  async function downloadAndOpen(d: Demo) {
    setDlErr(null);
    setDl({ id: d.id, pct: null });
    try {
      const resp = await fetch(d.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const total = Number(resp.headers.get("content-length")) || 0;
      const reader = resp.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          setDl({ id: d.id, pct: total ? received / total : null });
        }
      } else {
        chunks.push(new Uint8Array(await resp.arrayBuffer()));
      }
      const blob = new Blob(chunks as BlobPart[], { type: "application/octet-stream" });
      // Save to the local filesystem (browser download).
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = d.download;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      // Open the downloaded file locally (flips phase → loading, replacing this screen).
      await openFile(new File([blob], d.download, { type: "application/octet-stream" }));
    } catch (err) {
      setDlErr(`Download failed for ${d.label}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDl(null);
    }
  }

  return (
    <div data-testid="idle-view" style={{ width: "100%", overflowY: "auto", display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 720, width: "100%", padding: "6vh 1.5rem 3rem", textAlign: "center" }}>
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

            {/* Demo datasets */}
            <div style={{ margin: "1.5rem 0 0.5rem", color: "var(--text-muted, #94a3b8)", fontSize: "var(--text-sm, 0.8rem)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Or try an example dataset
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem", textAlign: "left" }}>
              {DEMOS.map((d) => (
                <div
                  key={d.id}
                  data-testid={`demo-${d.id}`}
                  style={{
                    display: "flex", flexDirection: "column", gap: "0.4rem", padding: "0.8rem 0.9rem",
                    border: "1px solid var(--border-default, #e2e8f0)", borderRadius: 10, background: "var(--surface-card, #fff)",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: "var(--weight-semibold, 600)", color: "var(--text-heading, #1e293b)" }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: KIND_COLOR[d.kind], flexShrink: 0 }} />
                    {d.label}
                  </span>
                  <span style={{ fontSize: "var(--text-sm, 0.8rem)", color: "var(--text-muted, #94a3b8)", lineHeight: 1.35 }}>{d.desc}</span>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                    {d.stats.map((s) => (
                      <span key={s} style={{
                        fontFamily: "var(--font-mono, monospace)", fontSize: "var(--text-xs, 0.7rem)",
                        color: "var(--text-secondary, #475569)", background: "var(--surface-panel, #f1f5f9)",
                        border: "1px solid var(--border-default, #e2e8f0)", borderRadius: 4, padding: "0.05rem 0.35rem",
                      }}>{s}</span>
                    ))}
                  </span>

                  {/* Two open modes */}
                  {dl?.id === d.id ? (
                    <DownloadProgress pct={dl.pct} />
                  ) : (
                    <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.15rem" }}>
                      <button
                        type="button"
                        data-testid={`demo-${d.id}-cloud`}
                        onClick={() => void openUrl(d.url)}
                        disabled={!!dl}
                        title="Stream from cloud storage (HTTP range reads)"
                        style={primaryBtn}
                      >
                        ☁ Open from cloud
                      </button>
                      <button
                        type="button"
                        data-testid={`demo-${d.id}-download`}
                        onClick={() => void downloadAndOpen(d)}
                        disabled={!!dl}
                        title="Download the whole file to your computer, then open it"
                        style={secondaryBtn}
                      >
                        ⤓ Download &amp; open
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {dlErr && (
              <p data-testid="idle-download-error" style={{ marginTop: "0.75rem", color: "var(--danger, #dc2626)", fontSize: "var(--text-sm, 0.85rem)" }}>
                {dlErr}
              </p>
            )}

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

const primaryBtn: React.CSSProperties = {
  flex: 1, padding: "0.4rem 0.5rem", border: "1px solid var(--blue-600, #3b54da)", borderRadius: 7,
  background: "var(--blue-600, #3b54da)", color: "#fff", cursor: "pointer",
  fontSize: "var(--text-sm, 0.8rem)", fontWeight: 500, whiteSpace: "nowrap",
};
const secondaryBtn: React.CSSProperties = {
  flex: 1, padding: "0.4rem 0.5rem", border: "1px solid var(--border-default, #cbd5e1)", borderRadius: 7,
  background: "var(--surface-card, #fff)", color: "var(--text-secondary, #475569)", cursor: "pointer",
  fontSize: "var(--text-sm, 0.8rem)", fontWeight: 500, whiteSpace: "nowrap",
};

function DownloadProgress({ pct }: { pct: number | null }) {
  return (
    <div data-testid="demo-download-progress" style={{ marginTop: "0.15rem" }}>
      <div style={{ height: 6, borderRadius: 3, background: "var(--surface-panel, #f1f5f9)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: pct != null ? `${Math.round(pct * 100)}%` : "40%", background: "var(--blue-600, #3b54da)", transition: "width 0.15s", opacity: pct != null ? 1 : 0.6 }} />
      </div>
      <span style={{ fontSize: "var(--text-xs, 0.7rem)", color: "var(--text-muted, #94a3b8)" }}>
        {pct != null ? `Downloading… ${Math.round(pct * 100)}%` : "Downloading…"}
      </span>
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
