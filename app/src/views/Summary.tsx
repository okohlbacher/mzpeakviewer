// Summary view — file stats, capability readout, and imaging block.
import { useStore } from "../store";
import { StatRow, Badge, Panel } from "@mzpeak/ui-kit";

function fmtBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtRange(r: [number, number] | null, digits = 2): string {
  if (!r) return "—";
  return `${r[0].toFixed(digits)} – ${r[1].toFixed(digits)}`;
}

export function Summary() {
  const phase = useStore((s) => s.phase);
  const stats = useStore((s) => s.stats);
  const caps = useStore((s) => s.capabilities);
  const fileName = useStore((s) => s.fileName);
  const fileSize = useStore((s) => s.fileSize);
  const manifest = useStore((s) => s.manifest);
  const opticalImages = useStore((s) => s.opticalImages);

  if (phase === "idle") {
    return (
      <div
        data-testid="summary-idle"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.5rem",
          padding: "4rem 1rem",
          color: "var(--text-muted)",
          textAlign: "center",
        }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ opacity: 0.4 }}
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <p style={{ margin: 0, fontWeight: "var(--weight-medium)" }}>
          Open a .mzpeak file to begin
        </p>
        <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>
          Use the file input in the toolbar above
        </p>
      </div>
    );
  }

  if (!stats || !caps) return null;

  const imaging = caps.imaging;
  const chrom = caps.chromatograms;
  const optical = caps.optical;

  return (
    <div
      data-testid="summary-view"
      style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 720 }}
    >
      {/* File section */}
      <Panel title="File" defaultOpen testid="summary-file-panel">
        <StatRow label="Name" value={fileName ?? "—"} testid="summary-filename" />
        <StatRow label="Size" value={fmtBytes(fileSize)} />
        <StatRow
          label="Spectra"
          value={stats.numSpectra.toLocaleString()}
        />
        <StatRow label="Entities" value={stats.numEntities.toLocaleString()} />
        <StatRow
          label="m/z range"
          value={stats.mzRange ? `${fmtRange(stats.mzRange, 2)} Th` : "—"}
        />
        <StatRow
          label="RT range"
          value={stats.rtRange ? `${fmtRange(stats.rtRange, 1)} s` : "—"}
        />
        <StatRow label="Layout" value={caps.layout} />
        <StatRow
          label="Instrument"
          value={stats.instrument ?? "—"}
          testid="summary-instrument"
        />
      </Panel>

      {/* Capabilities */}
      <Panel title="Capabilities" defaultOpen testid="summary-caps-panel">
        <StatRow
          label="Imaging (MSI)"
          value={
            <span
              style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
            >
              <Badge tone={imaging.isImaging ? "success" : "neutral"} dot>
                {imaging.isImaging ? "yes" : "no"}
              </Badge>
              {imaging.signals.length > 0 && (
                <span
                  style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}
                >
                  ({imaging.signals.join(", ")})
                </span>
              )}
            </span>
          }
        />
        <StatRow
          label="Chromatograms"
          value={
            chrom.numChromatograms > 0
              ? chrom.numChromatograms.toLocaleString()
              : chrom.ticColumn === "present"
                ? "TIC available"
                : "—"
          }
        />
        <StatRow
          label="Optical images"
          value={optical.hasOptical ? optical.count.toLocaleString() : "—"}
        />
        <StatRow
          label="Detection confidence"
          value={imaging.confidence}
        />
        {caps.encodings.length > 0 && (
          <StatRow
            label="Array encodings"
            value={
              <span style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                {caps.encodings.map((e) => (
                  <Badge key={e} tone="neutral" mono>
                    {e}
                  </Badge>
                ))}
              </span>
            }
          />
        )}
        {caps.unsupported.length > 0 && (
          <StatRow
            label="Unsupported features"
            value={
              <span style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                {caps.unsupported.map((u) => (
                  <span key={u.code} title={u.label}>
                    <Badge tone="warning" mono>
                      {u.code}
                    </Badge>
                  </span>
                ))}
              </span>
            }
          />
        )}
      </Panel>

      {/* Imaging block — only for MSI files */}
      {imaging.isImaging && (
        <Panel
          title="Imaging (MSI)"
          defaultOpen
          testid="summary-imaging-panel"
        >
          <StatRow
            label="Detection"
            value={
              imaging.signals.length > 0 ? imaging.signals.join(", ") : "hint only"
            }
          />
          {optical.hasOptical && (
            <StatRow
              label="Optical images"
              value={
                <span style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                  {opticalImages.map((img) => (
                    <Badge key={img.archivePath} tone="info" mono>
                      {img.name ?? img.archivePath}
                      {img.width != null && img.height != null
                        ? ` (${img.width}×${img.height})`
                        : ""}
                    </Badge>
                  ))}
                </span>
              }
            />
          )}
        </Panel>
      )}

      {/* Manifest */}
      {manifest && manifest.length > 0 && (
        <Panel title="Archive members" defaultOpen={false} testid="summary-manifest-panel">
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "var(--text-sm)",
                fontFamily: "var(--font-mono)",
              }}
            >
              <thead>
                <tr>
                  {["Path", "Role", "Size"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "0.25rem 0.5rem",
                        borderBottom: "1px solid var(--border-default)",
                        fontFamily: "var(--font-sans)",
                        color: "var(--text-muted)",
                        fontWeight: "var(--weight-medium)",
                        fontSize: "var(--text-xs)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {manifest.map((entry, i) => (
                  <tr key={`${i}:${entry.path}`}>
                    <td style={{ padding: "0.2rem 0.5rem", color: "var(--text-heading)" }}>
                      {entry.path}
                    </td>
                    <td style={{ padding: "0.2rem 0.5rem", color: "var(--text-muted)" }}>
                      {entry.role ?? "—"}
                    </td>
                    <td style={{ padding: "0.2rem 0.5rem", color: "var(--text-secondary)" }}>
                      {fmtBytes(entry.bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
