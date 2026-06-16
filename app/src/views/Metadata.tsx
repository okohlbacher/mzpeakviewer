// Metadata view — Advanced sub-tab. Two-column layout:
//   Left  — "Experiment": CV-parsed provenance (fileDescription / instruments /
//            software / samples / run) from the Parquet tables, with CV resolution.
//   Right — "Archive": compact table of Parquet files from store.manifest (path,
//            role, size) + lazy Download of the raw mzpeak_index.json bytes.
//
// The manifest's `metadata` subtree is intentionally omitted — it is the same
// provenance data as the left column but raw / unresolved. Download gives full access.
//
// Clicking mzpeak_index.json in the Structure view sets store.metadataReveal="manifest",
// which highlights the Archive column here.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { engine } from "../engine";
import { TreeView, Button } from "@mzpeak/ui-kit";
import { AdvancedTabs } from "./AdvancedTabs";
import { formatBytes } from "./render";

// ---- Archive table ----------------------------------------------------------------

const ROLE_LABEL: Record<string, string> = {
  spectra_metadata: "spectra metadata",
  spectra_data:     "profile data",
  spectra_peaks:    "centroid peaks",
  imaging:          "imaging",
  chromatograms:    "chromatograms",
  optical:          "optical images",
};

function roleLabel(role: string | undefined): string {
  if (!role) return "—";
  return ROLE_LABEL[role] ?? role.replace(/_/g, " ");
}

function ArchiveTable({ highlighted }: { highlighted: boolean }) {
  const manifest = useStore((s) => s.manifest);
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      const res = await engine.archiveMemberBytes("mzpeak_index.json", 16 * 1024 * 1024);
      const blob = new Blob([res.bytes], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mzpeak_index.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  if (!manifest || manifest.length === 0) {
    return <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm, 0.82rem)" }}>No archive listing available.</p>;
  }

  return (
    <div
      data-testid="metadata-manifest"
      style={{
        borderRadius: 8,
        transition: "box-shadow 0.4s ease, background 0.4s ease",
        boxShadow: highlighted ? "0 0 0 3px var(--accent, #3b54da)" : "none",
        background: highlighted ? "var(--accent-subtle, #f2f4fe)" : "transparent",
        padding: highlighted ? "0.5rem" : 0,
      }}
    >
      <table style={{ borderCollapse: "collapse", fontSize: "var(--text-sm, 0.82rem)", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--text-muted, #94a3b8)", borderBottom: "1px solid var(--border-hairline, #eee)" }}>
            <th style={{ padding: "0.15rem 0.5rem 0.15rem 0", fontWeight: 500 }}>file</th>
            <th style={{ padding: "0.15rem 0.5rem", fontWeight: 500 }}>role</th>
            <th style={{ padding: "0.15rem 0 0.15rem 0.5rem", fontWeight: 500, textAlign: "right" }}>size</th>
          </tr>
        </thead>
        <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
          {manifest.map((entry) => {
            const name = entry.path.split("/").pop() ?? entry.path;
            return (
              <tr key={entry.path} style={{ borderTop: "1px solid var(--border-hairline, #f0f0f0)" }}>
                <td style={{ padding: "0.25rem 0.5rem 0.25rem 0", wordBreak: "break-all" }} title={entry.path}>{name}</td>
                <td style={{ padding: "0.25rem 0.5rem", color: "var(--text-muted, #6b757e)", whiteSpace: "nowrap" }}>{roleLabel(entry.role)}</td>
                <td style={{ padding: "0.25rem 0 0.25rem 0.5rem", textAlign: "right", whiteSpace: "nowrap" }}>{formatBytes(entry.bytes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: "0.6rem" }}>
        <Button variant="secondary" size="sm" disabled={downloading} data-testid="manifest-download" onClick={() => void download()}>
          {downloading ? "Downloading…" : "⭳ Download mzpeak_index.json"}
        </Button>
      </div>
    </div>
  );
}

// ---- Main view -------------------------------------------------------------------

export function Metadata() {
  const phase = useStore((s) => s.phase);
  const fileMeta = useStore((s) => s.fileMeta);
  const metadataReveal = useStore((s) => s.metadataReveal);
  const setMetadataReveal = useStore((s) => s.setMetadataReveal);

  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [allEpoch, setAllEpoch] = useState(0);
  const [allOpen, setAllOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery.trim()), 200);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // Pulse the Archive column when arriving from Structure → "View JSON →"
  const archiveRef = useRef<HTMLDivElement | null>(null);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (metadataReveal !== "manifest") return;
    const el = archiveRef.current;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1400);
      setMetadataReveal(null);
      return () => clearTimeout(t);
    }
    setMetadataReveal(null);
  }, [metadataReveal, setMetadataReveal]);

  if (phase !== "ready") {
    return (
      <>
        <AdvancedTabs />
        <p data-testid="metadata-empty" style={{ color: "var(--text-muted)", padding: "1rem 0" }}>
          Open a file to view metadata.
        </p>
      </>
    );
  }

  const treeProps = { query, allEpoch, allOpen };

  return (
    <div data-testid="metadata-view">
      <AdvancedTabs />

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <input
          type="search"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          placeholder="Search keys, values, CV terms…"
          aria-label="Search metadata"
          data-testid="metadata-search"
          style={{
            flex: "0 1 320px", minWidth: 200, height: 30, padding: "0 0.5rem",
            border: "1px solid var(--border-strong, #c5ccd3)", borderRadius: "var(--radius-sm, 4px)",
            fontSize: "var(--text-sm, 0.8rem)", background: "var(--surface, #fff)",
          }}
        />
        <Button variant="secondary" size="sm" data-testid="metadata-expand-all"
          onClick={() => { setAllOpen(true); setAllEpoch((n) => n + 1); }}>
          Expand all
        </Button>
        <Button variant="secondary" size="sm" data-testid="metadata-collapse-all"
          onClick={() => { setAllOpen(false); setAllEpoch((n) => n + 1); }}>
          Collapse all
        </Button>
      </div>

      {/* Two-column grid */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(200px, 1fr)", gap: "2rem", alignItems: "flex-start" }}>

        {/* Left — Experiment provenance */}
        <section>
          <h3 style={{ fontSize: "0.92rem", margin: "0 0 0.2rem" }}>Experiment</h3>
          <p style={{ margin: "0 0 0.5rem", color: "var(--text-muted)", fontSize: "var(--text-sm, 0.8rem)" }}>
            Provenance from the mzPeak file's Parquet tables — instruments, software, source files, run. CV accession codes resolved to labels.
          </p>
          {fileMeta ? (
            <>
              <TreeView label="fileDescription" value={fileMeta.fileDescription} defaultOpen={2} {...treeProps} />
              {fileMeta.instrumentConfigurations.length > 0 && (
                <TreeView label="instrumentConfigurations" value={fileMeta.instrumentConfigurations} defaultOpen={1} {...treeProps} />
              )}
              {fileMeta.software.length > 0 && (
                <TreeView label="software" value={fileMeta.software} defaultOpen={1} {...treeProps} />
              )}
              {fileMeta.samples.length > 0 && (
                <TreeView label="samples" value={fileMeta.samples} defaultOpen={1} {...treeProps} />
              )}
              <TreeView label="run" value={fileMeta.run} defaultOpen={2} {...treeProps} />
            </>
          ) : (
            <p data-testid="metadata-none" style={{ color: "var(--text-muted)" }}>
              No file-level metadata available in this file.
            </p>
          )}
        </section>

        {/* Right — Archive */}
        <section ref={archiveRef}>
          <h3 style={{ fontSize: "0.92rem", margin: "0 0 0.2rem" }}>Archive</h3>
          <p style={{ margin: "0 0 0.5rem", color: "var(--text-muted)", fontSize: "var(--text-sm, 0.8rem)" }}>
            Parquet tables inside this mzPeak ZIP, with their logical roles.
          </p>
          <ArchiveTable highlighted={pulse} />
        </section>

      </div>
    </div>
  );
}
