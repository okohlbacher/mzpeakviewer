import { useRef, useState } from "react";
import { Download, Play, ShieldCheck } from "lucide-react";
import { useStore } from "../state/store";
import { Button, Logo } from "./components";

/** Remote demo file (SCIEX TripleTOF 6600, ~145 MB), served via the StackIT CDN
 *  (BunnyCDN edge, HTTP/2) at data.mzpeak.org. Opened via HTTP range requests, so
 *  a visit transfers only the footer + the parts you view — not the whole file. */
export const DEMO_URL =
  "https://data.mzpeak.org/v09/mzML-examples/sciex-tripletof-6600/12_80.mzpeak";
const DEMO_FILENAME = "12_80.mzpeak";

/**
 * The idle empty state: centred OpenMS logo + intro, a large drop-zone (file
 * picker), the bundled-demo link, and an arbitrary-URL field (preserved so the
 * deployed demo can load by URL). Drives the store's openFile / openUrl.
 */
export function IdleLoader() {
  const openFile = useStore((s) => s.openFile);
  const openUrl = useStore((s) => s.openUrl);

  const [url, setUrl] = useState("");
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function handle(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".mzpeak")) {
      alert("Please select a .mzpeak file.");
      return;
    }
    void openFile(file);
  }

  return (
    <div style={{ maxWidth: 560, margin: "6vh auto 0", textAlign: "center" }}>
      <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "center" }}>
        <Logo size={62} />
      </div>
      <h2 style={{ margin: "0 0 0.4rem", fontSize: "1.2rem", color: "var(--text-heading)", fontWeight: "var(--weight-semibold)" }}>
        Inspect an mzPeak file
      </h2>
      <p style={{ margin: "0 0 1.2rem", color: "var(--text-muted)", fontSize: "var(--text-body)", lineHeight: "var(--leading-normal)" }}>
        A lightweight, client-side explorer for the mzPeak mass-spectrometry
        format — summary, metadata browser and a spectrum / chromatogram
        navigator. The file never leaves your browser.
      </p>

      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInput.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handle(e.dataTransfer.files?.[0]);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
          textAlign: "center",
          padding: "2.2rem 1rem",
          border: `2px dashed ${over ? "var(--accent)" : "var(--border-default)"}`,
          borderRadius: "var(--radius-lg)",
          background: over ? "var(--accent-soft)" : "var(--surface-panel)",
          color: over ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer",
          fontSize: "var(--text-body)",
          transition: "var(--transition-ui)",
          userSelect: "none",
        }}
      >
        <span>
          Drop a <strong style={{ color: over ? "var(--accent)" : "var(--text-body)" }}>.mzpeak</strong> file, or <u>browse</u>
        </span>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".mzpeak"
        style={{ display: "none" }}
        onChange={(e) => {
          handle(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div
        style={{
          marginTop: "0.9rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.45rem",
          padding: "0.5rem 0.7rem",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--radius-md)",
          background: "var(--surface-panel)",
          fontSize: "var(--text-sm)",
          color: "var(--text-secondary)",
          lineHeight: "var(--leading-snug)",
        }}
      >
        <ShieldCheck size={15} style={{ color: "var(--green-700)", flexShrink: 0 }} />
        <span>
          <strong style={{ color: "var(--text-body)" }}>Private by design.</strong>{" "}
          Your file is read entirely in this browser tab and is{" "}
          <strong style={{ color: "var(--text-body)" }}>never uploaded</strong> —
          no server, no backend. (The demo is the only file fetched over the network.)
        </span>
      </div>

      <div
        style={{
          marginTop: "1rem",
          display: "flex",
          gap: "0.5rem",
          justifyContent: "center",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Button variant="primary" size="sm" iconLeft={<Play size={14} />} onClick={() => void openUrl(DEMO_URL)}>
          Open demo
        </Button>
        <a href={DEMO_URL} download={DEMO_FILENAME} className="demo-download">
          <Download size={14} />
          Download demo file (~145 MB)
        </a>
      </div>
      <p style={{ marginTop: "0.5rem", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        “Open demo” streams it over the network (instant start). Downloading first
        is faster if you’ll browse a lot — then open it with <u>browse</u> above.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void openUrl(url.trim());
        }}
        style={{ display: "flex", gap: "0.4rem", marginTop: "1.4rem", justifyContent: "center" }}
      >
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/file.mzpeak"
          aria-label="mzpeak URL"
          style={{
            flex: 1,
            maxWidth: 380,
            padding: "0.34rem 0.5rem",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-sm)",
            font: "inherit",
            fontSize: "var(--text-body)",
            background: "var(--surface-card)",
            color: "var(--text-body)",
          }}
        />
        <button type="submit" className="primary" disabled={!url.trim()}>
          Load URL
        </button>
      </form>
    </div>
  );
}
