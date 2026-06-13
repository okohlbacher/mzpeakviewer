// Metadata view — Advanced sub-tab. Two JSON sources, each via the CV-aware TreeView:
//   • File metadata (fileMeta: fileDescription / instrumentConfigurations / …)
//   • Manifest (mzpeak_index.json) — the raw archive index, fetched byte-exact from
//     the worker (engine.archiveMemberBytes) so it can also be Downloaded verbatim.
// A search box filters/highlights across both; Expand/Collapse all drives the trees.
// Clicking mzpeak_index.json in the Structure view sets store.metadataReveal="manifest",
// which scrolls to + pulses the Manifest section here.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { engine } from "../engine";
import { TreeView, Button } from "@mzpeak/ui-kit";
import { AdvancedTabs } from "./AdvancedTabs";

// The manifest is tiny in practice; cap the read well under the 256 MiB protocol limit.
const MANIFEST_MAX_BYTES = 16 * 1024 * 1024;

type ManifestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; json: unknown; bytes: ArrayBuffer; truncated: boolean }
  | { kind: "error"; message: string };

export function Metadata() {
  const phase = useStore((s) => s.phase);
  const fileMeta = useStore((s) => s.fileMeta);
  const metadataReveal = useStore((s) => s.metadataReveal);
  const setMetadataReveal = useStore((s) => s.setMetadataReveal);

  // Search (debounced) + expand/collapse-all epoch.
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [allEpoch, setAllEpoch] = useState(0);
  const [allOpen, setAllOpen] = useState<boolean | null>(null);

  // Debounce the query so deep trees don't re-filter on every keystroke (perf R4).
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery.trim()), 200);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // Lazily fetch the raw mzpeak_index.json bytes from the worker.
  const [manifest, setManifest] = useState<ManifestState>({ kind: "idle" });
  useEffect(() => {
    if (phase !== "ready") {
      setManifest({ kind: "idle" });
      return;
    }
    let live = true;
    setManifest({ kind: "loading" });
    engine
      .archiveMemberBytes("mzpeak_index.json", MANIFEST_MAX_BYTES)
      .then((res) => {
        if (!live) return;
        try {
          const text = new TextDecoder().decode(res.bytes);
          setManifest({ kind: "ready", json: JSON.parse(text), bytes: res.bytes, truncated: res.truncated });
        } catch (e) {
          setManifest({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        }
      })
      .catch((e) => {
        if (live) setManifest({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [phase]);

  // Reveal: scroll to + pulse the Manifest section when arriving from Structure.
  const manifestRef = useRef<HTMLDivElement | null>(null);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (metadataReveal !== "manifest") return;
    const el = manifestRef.current;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1400);
      setMetadataReveal(null); // consume
      return () => clearTimeout(t);
    }
    setMetadataReveal(null);
  }, [metadataReveal, manifest.kind, setMetadataReveal]);

  function downloadManifest() {
    if (manifest.kind !== "ready") return;
    const blob = new Blob([manifest.bytes], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mzpeak_index.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

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

      {/* Toolbar: search + expand/collapse all */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <input
          type="search"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          placeholder="Search keys, values, CV terms…"
          aria-label="Search metadata"
          data-testid="metadata-search"
          style={{
            flex: "0 1 320px",
            minWidth: 200,
            height: 30,
            padding: "0 0.5rem",
            border: "1px solid var(--border-strong, #c5ccd3)",
            borderRadius: "var(--radius-sm, 4px)",
            fontSize: "var(--text-sm, 0.8rem)",
            background: "var(--surface, #fff)",
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          data-testid="metadata-expand-all"
          onClick={() => {
            setAllOpen(true);
            setAllEpoch((n) => n + 1);
          }}
        >
          Expand all
        </Button>
        <Button
          variant="secondary"
          size="sm"
          data-testid="metadata-collapse-all"
          onClick={() => {
            setAllOpen(false);
            setAllEpoch((n) => n + 1);
          }}
        >
          Collapse all
        </Button>
      </div>

      {/* ── File metadata ─────────────────────────────────────────────────── */}
      <Section title="File metadata">
        {fileMeta ? (
          <div style={{ maxWidth: 820 }}>
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
          </div>
        ) : (
          <p data-testid="metadata-none" style={{ color: "var(--text-muted)" }}>
            No file-level metadata available in this file.
          </p>
        )}
      </Section>

      {/* ── Manifest (mzpeak_index.json) ──────────────────────────────────── */}
      <div
        ref={manifestRef}
        data-testid="metadata-manifest"
        style={{
          marginTop: "1.5rem",
          borderRadius: 8,
          transition: "box-shadow 0.4s ease, background 0.4s ease",
          boxShadow: pulse ? "0 0 0 3px var(--accent, #3b54da)" : "none",
          background: pulse ? "var(--accent-subtle, #f2f4fe)" : "transparent",
          padding: pulse ? "0.5rem" : 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}>
          <h3 style={{ fontSize: "0.92rem", margin: 0 }}>Manifest</h3>
          <code style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>mzpeak_index.json</code>
          <Button
            variant="secondary"
            size="sm"
            data-testid="manifest-download"
            disabled={manifest.kind !== "ready"}
            onClick={downloadManifest}
            style={{ marginLeft: "auto" }}
          >
            ⭳ Download
          </Button>
        </div>
        {manifest.kind === "loading" && <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Loading mzpeak_index.json…</p>}
        {manifest.kind === "error" && (
          <p data-testid="manifest-error" style={{ color: "var(--danger, #c00)", fontSize: "0.82rem" }}>
            Couldn’t read mzpeak_index.json: {manifest.message}
          </p>
        )}
        {manifest.kind === "ready" && (
          <div style={{ maxWidth: 820 }}>
            {manifest.truncated && (
              <p style={{ color: "var(--warning, #8a6d00)", fontSize: "0.75rem" }}>
                Truncated to {MANIFEST_MAX_BYTES.toLocaleString()} bytes for display.
              </p>
            )}
            <TreeView label="mzpeak_index.json" value={manifest.json} defaultOpen={2} {...treeProps} />
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 style={{ fontSize: "0.92rem", margin: "0 0 0.5rem" }}>{title}</h3>
      {children}
    </section>
  );
}
