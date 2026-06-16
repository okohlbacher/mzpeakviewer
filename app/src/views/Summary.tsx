// Summary view — metric tiles + TIC thumbnail, then file stats, capability
// readout, and imaging block.
import { useEffect, useRef } from "react";
import type { ImagingGridWire } from "@mzpeak/contracts";
import { useStore } from "../store";
import { StatRow, Badge, Panel } from "@mzpeak/ui-kit";
import type { ChannelAssignment } from "@mzpeak/contracts";
import { rasterizeTic, formatBytes } from "./render";

function fmtRange(r: [number, number] | null, digits = 2): string {
  if (!r) return "—";
  return `${r[0].toFixed(digits)} – ${r[1].toFixed(digits)}`;
}

// A single mode dominates a level when it covers ≥90% of that level's spectra whose
// representation is known (profile|centroid). Below that — both present — it reads
// "mixed". Only-unknown levels return null (no badge).
const DOMINANCE = 0.9;

type LevelMode = "profile" | "centroid" | "mixed" | null;

function levelRepresentationMode(
  counts: { profile: number; centroid: number; unknown: number } | undefined,
): LevelMode {
  if (!counts) return null;
  const known = counts.profile + counts.centroid;
  if (known === 0) return null; // only unknown → no badge
  if (counts.profile / known >= DOMINANCE) return "profile";
  if (counts.centroid / known >= DOMINANCE) return "centroid";
  return "mixed";
}

export function Summary() {
  const stats = useStore((s) => s.stats);
  const caps = useStore((s) => s.capabilities);
  const fileName = useStore((s) => s.fileName);
  const fileSize = useStore((s) => s.fileSize);
  const manifest = useStore((s) => s.manifest);
  const opticalImages = useStore((s) => s.opticalImages);
  const grid = useStore((s) => s.grid);
  const ticColumn = useStore((s) => s.ticColumn);
  const channels = useStore((s) => s.channels);
  const study = useStore((s) => s.study);
  const studySamples = useStore((s) => s.studySamples);

  // Summary only mounts when phase==="ready" (App renders <Idle/> otherwise), so the not-ready
  // guard below is the only reachable empty state — the old phase==="idle" branch was dead UI.
  if (!stats || !caps) return null;

  const imaging = caps.imaging;
  const chrom = caps.chromatograms;
  const optical = caps.optical;

  return (
    <div
      data-testid="summary-view"
      style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 720 }}
    >
      {/* Metric tiles + TIC thumbnail (imaging) */}
      <div data-testid="summary-tiles" style={{ display: "flex", gap: "0.75rem", alignItems: "stretch", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.6rem", flex: 1, minWidth: 240 }}>
          <MetricTile label="Spectra" value={stats.numSpectra.toLocaleString()} />
          <MetricTile label="m/z range" value={stats.mzRange ? `${fmtRange(stats.mzRange, 0)}` : "—"} unit={stats.mzRange ? "Th" : undefined} />
          <MetricTile label="Layout" value={caps.layout} />
          <MetricTile label="Imaging" value={imaging.isImaging ? "yes" : "no"} accent={imaging.isImaging} />
        </div>
        {imaging.isImaging && grid && ticColumn && (
          <TicThumbnail grid={grid} tic={ticColumn} />
        )}
      </div>

      {/* File section */}
      <Panel title="File" defaultOpen testid="summary-file-panel">
        <StatRow label="Name" value={fileName ?? "—"} testid="summary-filename" />
        <StatRow label="Size" value={formatBytes(fileSize)} />
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

      {/* MS levels — per-level spectrum count + representation mode */}
      {stats.msLevels.length > 0 && (
        <Panel title="MS levels" defaultOpen testid="summary-ms-levels-panel">
          <div data-testid="summary-ms-levels" style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
            {stats.msLevels.map((level) => {
              const count = stats.spectraPerLevel?.[level] ?? 0;
              const mode = levelRepresentationMode(stats.representationPerLevel?.[level]);
              return (
                <StatRow
                  key={level}
                  label={`MS${level}`}
                  testid={`summary-ms-level-${level}`}
                  value={
                    <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                        {count.toLocaleString()} spectra
                      </span>
                      {mode && (
                        <Badge
                          tone={mode === "mixed" ? "neutral" : mode === "centroid" ? "info" : "success"}
                        >
                          {mode}
                        </Badge>
                      )}
                    </span>
                  }
                />
              );
            })}
          </div>
        </Panel>
      )}

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

      {/* Study (SDRF/ISA) — dataset, isobaric channels, sample characteristics (MG-05) */}
      <StudyPanel channels={channels} study={study} samples={studySamples} />

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
                      {formatBytes(entry.bytes)}
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

/** Study panel (MG-05): the dataset accession + title, the run's isobaric channels, and a
 *  per-sample characteristics matrix (samples × their CV parameters) from the index
 *  `study` block + `sample_list`. The full embedded SDRF/ISA table is a separate member
 *  (deferred). All inputs are plainified `unknown` — read defensively. */
function StudyPanel({ channels, study, samples }: { channels: ChannelAssignment[]; study: unknown; samples: unknown[] | null }) {
  const s = (study && typeof study === "object" ? study : null) as { dataset_accession?: unknown; title?: unknown } | null;
  const accession = typeof s?.dataset_accession === "string" ? s.dataset_accession : null;
  const title = typeof s?.title === "string" ? s.title : null;
  const rows = Array.isArray(samples) ? samples : [];

  // Build the characteristics matrix: each sample → {name, params:{label→value}};
  // columns = the union of parameter labels across all samples (stable insertion order).
  type Param = { name?: unknown; accession?: unknown; value?: unknown };
  const cols: string[] = [];
  const sampleData = rows.map((raw) => {
    const e = (raw && typeof raw === "object" ? raw : {}) as { id?: unknown; name?: unknown; parameters?: unknown };
    const params = Array.isArray(e.parameters) ? (e.parameters as Param[]) : [];
    const cells: Record<string, string> = {};
    for (const p of params) {
      const label = String(p?.name ?? p?.accession ?? "");
      if (!label) continue;
      if (!cols.includes(label)) cols.push(label);
      const v = p?.value;
      cells[label] = v == null ? "" : String(v);
    }
    return { name: String(e.name ?? e.id ?? ""), cells };
  });

  if (!accession && !title && channels.length === 0 && sampleData.length === 0) return null;

  return (
    <Panel title="Study" defaultOpen testid="summary-study-panel">
      {accession && <StatRow label="Dataset" value={accession} testid="summary-study-accession" />}
      {title && <StatRow label="Title" value={title} />}
      {channels.length > 0 && (
        <StatRow
          label="Isobaric channels"
          value={
            <span style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
              {channels.map((c, i) => (
                <Badge key={i} tone={c.boundToThisRun ? "info" : "neutral"} mono>
                  {c.channelLabel ?? "?"}{c.reporterMz != null ? ` ${c.reporterMz.toFixed(3)}` : ""}
                </Badge>
              ))}
            </span>
          }
        />
      )}
      {sampleData.length > 0 && cols.length > 0 && (
        <div data-testid="summary-study-samples" style={{ overflowX: "auto", marginTop: "0.4rem" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "var(--text-sm)", fontFamily: "var(--font-mono)" }}>
            <thead>
              <tr>
                {["sample", ...cols].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "0.2rem 0.6rem 0.2rem 0", borderBottom: "1px solid var(--border-default)", fontFamily: "var(--font-sans)", color: "var(--text-muted)", fontWeight: "var(--weight-medium)", fontSize: "var(--text-xs)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sampleData.map((row, i) => (
                <tr key={i}>
                  <td style={{ padding: "0.2rem 0.6rem 0.2rem 0", color: "var(--text-heading)", whiteSpace: "nowrap" }}>{row.name}</td>
                  {cols.map((col) => (
                    <td key={col} style={{ padding: "0.2rem 0.6rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{row.cells[col] ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** A compact metric tile (value + label) for the Summary header row. */
function MetricTile({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return (
    <div
      style={{
        border: "1px solid var(--border-default, #e2e8f0)",
        borderRadius: 8,
        background: "var(--surface-card, #fff)",
        padding: "0.6rem 0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.15rem",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: "1.15rem",
          fontWeight: "var(--weight-semibold, 600)",
          color: accent ? "var(--blue-600, #3b54da)" : "var(--text-heading, #1e293b)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
        {unit ? <span style={{ fontSize: "0.7rem", color: "var(--text-muted, #94a3b8)", marginLeft: 3 }}>{unit}</span> : null}
      </span>
      <span style={{ fontSize: "var(--text-xs, 0.7rem)", color: "var(--text-muted, #94a3b8)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
    </div>
  );
}

/** Small per-pixel-TIC heatmap thumbnail for imaging files (reuses rasterizeTic). */
function TicThumbnail({ grid, tic }: { grid: ImagingGridWire; tic: Float32Array }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = grid.width;
    canvas.height = grid.height;
    const rgba = rasterizeTic(tic, grid, "viridis", false);
    const img = ctx.createImageData(grid.width, grid.height);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
  }, [grid, tic]);

  const MAX = 110;
  const scale = Math.max(1, Math.floor(MAX / Math.max(grid.width, grid.height)));
  return (
    <div
      data-testid="summary-tic-thumb"
      style={{
        border: "1px solid var(--border-default, #e2e8f0)",
        borderRadius: 8,
        background: "var(--ink, #0e1216)",
        padding: "0.5rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.3rem",
      }}
    >
      <canvas
        ref={ref}
        aria-label="Total-ion-current thumbnail"
        style={{ width: grid.width * scale, height: grid.height * scale, imageRendering: "pixelated", borderRadius: 2 }}
      />
      <span style={{ fontSize: "var(--text-xs, 0.7rem)", color: "var(--text-muted, #94a3b8)" }}>TIC overview</span>
    </div>
  );
}
