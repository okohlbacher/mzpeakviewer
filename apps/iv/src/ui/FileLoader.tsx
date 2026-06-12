import { useState, useRef } from "react";
import { Play, Download, ShieldCheck } from "lucide-react";
import { useStore } from "../state/store";

// Small bundled imaging example — the imzML spec "Example_Continuous" MSI file
// (~280 KB), served SAME-ORIGIN under the app's base path. Same-origin requests
// never hit CORS, so it loads instantly and offline, and (unlike the old
// non-imaging demo) it reconstructs a real pixel grid + overview.
const SMALL_EXAMPLE_URL = `${import.meta.env.BASE_URL}static/example.mzpeak`;

// The headline demo: the full PXD001283 HR2MSI imaging dataset, served via the
// StackIT CDN (BunnyCDN edge, HTTP/2) at data.mzpeak.org. The browser streams it
// via HTTP Range; the CDN serves public read, byte-range support, and CORS
// (Allow-Origin *, GET + Range, exposes Content-Range / Accept-Ranges).
const DEMO_URL =
  "https://data.mzpeak.org/v09/demo/PXD001283-HR2MSI-urinary-bladder_HR2MSImouseurinarybladderS096.mzpeak";

interface Props {
  /** Whether a load is already in progress (disables inputs). */
  loading: boolean;
}

/**
 * Unified loader zone: drag-and-drop / file picker, a privacy strip, one-click
 * example datasets, and an arbitrary-URL field. Composition mirrors mzPeakExplorer's
 * starting page (dropzone → privacy → actions → hint → URL). Drives the store's
 * openFile / openUrl. Preserves the test-facing ids: drop-zone, file-input,
 * url-input, load-button, example-remote, example-small, download-demo, privacy-note.
 */
export function FileLoader({ loading }: Props) {
  const openFile = useStore((s) => s.openFile);
  const openUrl = useStore((s) => s.openUrl);

  const [url, setUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File picker / drag-drop shared handler ──────────────────────────────
  function handleFile(file: File) {
    // Case-insensitive extension check (matches Explorer; tolerates ".MZPEAK").
    if (!file.name.toLowerCase().endsWith(".mzpeak")) {
      alert("Please select a .mzpeak file.");
      return;
    }
    void openFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset value so picking the same file again still triggers onChange.
    e.target.value = "";
  }

  // ── Drag-and-drop (no-op while a load is already in progress) ───────────
  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (loading) return;
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (loading) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  // ── URL submit ─────────────────────────────────────────────────────────
  function onUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (url.trim()) void openUrl(url.trim());
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", width: "100%" }}>
      {/* ── Drag-and-drop zone (also click-to-browse) ── */}
      <div
        className="drop"
        data-testid="drop-zone"
        data-over={dragOver || undefined}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !loading && fileInputRef.current?.click()}
        role="button"
        aria-label="Drop a .mzpeak file here or click to browse"
        aria-disabled={loading || undefined}
        tabIndex={loading ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault(); // Space must never scroll the page
            if (!loading) fileInputRef.current?.click();
          }
        }}
        style={loading ? { cursor: "not-allowed", opacity: 0.6 } : undefined}
      >
        <span>
          Drop a <strong>.mzpeak</strong> file, or <u>browse</u>
        </span>
      </div>

      {/* Hidden file input — activated by the drop zone (Playwright setInputFiles). */}
      <input
        ref={fileInputRef}
        data-testid="file-input"
        type="file"
        accept=".mzpeak"
        onChange={onFileChange}
        disabled={loading}
        style={{ display: "none" }}
        aria-label="mzpeak-file"
      />

      {/* ── Privacy reassurance strip ── */}
      <p className="loader__privacy" data-testid="privacy-note">
        <ShieldCheck size={15} aria-hidden="true" />
        <span>
          <strong>Private by design.</strong> Your data is read and analyzed
          entirely in this browser — local files are never uploaded; a URL is
          fetched directly by your browser. No tracking.
        </span>
      </p>

      {/* ── Example datasets (imaging demo is the headline action) ── */}
      <div className="loader__actions">
        <button
          type="button"
          className="mz-btn mz-btn--primary"
          data-testid="example-remote"
          disabled={loading}
          title={DEMO_URL}
          onClick={() => {
            setUrl(DEMO_URL);
            if (!loading) void openUrl(DEMO_URL);
          }}
        >
          <Play size={14} aria-hidden="true" /> Open demo
        </button>
        <button
          type="button"
          className="mz-btn mz-btn--secondary"
          data-testid="example-small"
          disabled={loading}
          title="Small bundled imaging example (loads instantly, offline)"
          onClick={() => !loading && void openUrl(SMALL_EXAMPLE_URL)}
        >
          Small example
        </button>
      </div>

      {/* The imaging demo streams a ~294 MB file; downloading it once and opening
          it locally renders ion images far faster. */}
      <a className="loader__download" data-testid="download-demo" href={DEMO_URL} download target="_blank" rel="noopener">
        <Download size={13} aria-hidden="true" /> Download demo file
      </a>

      <p className="loader__hint">
        The imaging demo streams over the network (overview in seconds; full ion
        images are faster after downloading). The small example is bundled and
        instant.
      </p>

      {/* ── Arbitrary URL ── */}
      <form className="loader__url" onSubmit={onUrlSubmit}>
        <span className="mz-input">
          <input
            data-testid="url-input"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… or s3://bucket/key.mzpeak"
            disabled={loading}
            aria-label="mzpeak-url"
          />
        </span>
        <button
          data-testid="load-button"
          type="submit"
          className="mz-btn mz-btn--primary"
          disabled={loading || !url.trim()}
        >
          {loading ? "Loading…" : "Load URL"}
        </button>
      </form>
    </div>
  );
}
