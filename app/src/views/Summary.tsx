// Summary view — metric tiles + TIC thumbnail, then file stats, capability
// readout, and imaging block.
import { useEffect, useRef } from "react";
import type { ImagingGridWire, OpticalImageMeta } from "@mzpeak/contracts";
import { useStore } from "../store";
import { spectrumCounts } from "../recordIndex";
import { StudyDesignCta } from "./StudyDesign";
import { classifyOpticalBand } from "../opticalBand";
import { StatRow, Badge, Panel } from "@mzpeak/ui-kit";
import type { ChannelAssignment } from "@mzpeak/contracts";
import { rasterizeTic, formatBytes, formatCompact } from "./render";

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
  const opticalImages = useStore((s) => s.opticalImages);
  const grid = useStore((s) => s.grid);
  const ticColumn = useStore((s) => s.ticColumn);
  const channels = useStore((s) => s.channels);
  const study = useStore((s) => s.study);
  const studySamples = useStore((s) => s.studySamples);
  const sdrfMember = useStore((s) => s.sdrfMember);

  // Summary only mounts when phase==="ready" (App renders <Idle/> otherwise), so the not-ready
  // guard below is the only reachable empty state — the old phase==="idle" branch was dead UI.
  if (!stats || !caps) return null;

  const imaging = caps.imaging;
  const counts = spectrumCounts(stats);
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
          <MetricTile label="Spectra" value={counts.records.toLocaleString()} />
          <MetricTile label="m/z range" value={stats.mzRange ? `${fmtRange(stats.mzRange, 0)}` : "—"} unit={stats.mzRange ? "Th" : undefined} />
          <MetricTile label="Layout" value={caps.layout} />
          <MetricTile label="Imaging" value={imaging.isImaging ? "yes" : "no"} accent={imaging.isImaging} />
        </div>
        {imaging.isImaging && grid && ticColumn && (
          <TicThumbnail grid={grid} tic={ticColumn} />
        )}
      </div>

      {/* UV/VIS optical band pill — shown only when the file has wavelength
          (UV/PDA/DAD) spectra. The band (UV / VIS / UV-VIS) is inferred from the observed
          wavelength range; when the range is unknown we still flag that optical data is
          present. */}
      {caps.wavelength.present && <OpticalBandPill range={caps.wavelength.range} count={caps.wavelength.count} />}

      {/* File section */}
      <Panel title="File" defaultOpen testid="summary-file-panel">
        <StatRow label="Name" value={fileName ?? "—"} testid="summary-filename" />
        <StatRow label="Size" value={formatBytes(fileSize)} />
        <StatRow
          label="Spectra"
          value={counts.records.toLocaleString()}
          testid="summary-spectra"
        />
        {counts.hasBoth && (
          <StatRow
            label="Representations"
            testid="summary-representations"
            value={
              <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <Badge tone="success">{counts.profile!.toLocaleString()} profile</Badge>
                <Badge tone="info">{counts.centroid!.toLocaleString()} centroid</Badge>
                {counts.both > 0 && (
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    {counts.both === counts.scans
                      ? `each of ${counts.scans.toLocaleString()} scans stored as both`
                      : `${counts.both.toLocaleString()} of ${counts.scans.toLocaleString()} scans stored as both`}
                  </span>
                )}
              </span>
            }
          />
        )}
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
              const stored = stats.storedPerLevel?.[level];
              // Records at this level: every scan once, plus its second representation.
              const count = (stats.spectraPerLevel?.[level] ?? 0) + (stored?.both ?? 0);
              const mode = levelRepresentationMode(stats.representationPerLevel?.[level]);
              const showStored = !!stored && counts.hasBoth;
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
                      {showStored ? (
                        <>
                          {stored!.profile > 0 && <Badge tone="success">{stored!.profile.toLocaleString()} profile</Badge>}
                          {stored!.centroid > 0 && <Badge tone="info">{stored!.centroid.toLocaleString()} centroid</Badge>}
                        </>
                      ) : (
                        mode && (
                          <Badge
                            tone={mode === "mixed" ? "neutral" : mode === "centroid" ? "info" : "success"}
                          >
                            {mode}
                          </Badge>
                        )
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
          <RegistrationRows grid={grid} images={opticalImages} />
        </Panel>
      )}

      {/* Study (SDRF/ISA) — dataset, isobaric channels, sample characteristics */}
      <StudyPanel channels={channels} study={study} samples={studySamples} sdrfMember={sdrfMember} />

      {/* Archive members are covered by the Advanced ▸ Structure view (with per-member
          download + deep parquet inspection), so they're intentionally not duplicated here. */}
    </div>
  );
}

/** Study panel: the dataset accession + title, the run's isobaric channels, and a
 *  per-sample characteristics matrix (samples × their CV parameters) from the index
 *  `study` block + `sample_list`. The full embedded SDRF/ISA table is a separate member
 *  (deferred). All inputs are plainified `unknown` — read defensively. */
function StudyPanel({ channels, study, samples, sdrfMember }: { channels: ChannelAssignment[]; study: unknown; samples: unknown[] | null; sdrfMember: string | null }) {
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

  if (!accession && !title && channels.length === 0 && sampleData.length === 0 && !sdrfMember) return null;

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
      {sampleData.length > 25 && (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: "0.3rem" }}>
          showing 25 of {sampleData.length} samples — see the Study design tab for all
        </div>
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
              {sampleData.slice(0, 25).map((row, i) => (
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
      {/* Full SDRF table + factors moved to the dedicated Study-design tab. */}
      <div style={{ marginTop: "0.5rem" }}><StudyDesignCta /></div>
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

/** UV / VIS / UV-VIS band pill. The band is classified from the observed
 *  wavelength range; an unknown range still flags that optical (wavelength) data is
 *  present. Violet accent matches the UV/VIS demo chip on the start page. */
function OpticalBandPill({ range, count }: { range: [number, number] | null; count: number }) {
  const band = range ? classifyOpticalBand(range[0], range[1]) : null;
  // Neutral label when the range is unknown/unclassifiable — "UV/VIS" is itself a real
  // band, so showing it for a range-less file would read as a (wrong) classification.
  const label = band ?? "Optical";
  const rangeText = range ? `${Math.round(range[0])}–${Math.round(range[1])} nm` : null;
  const spectra = `${count.toLocaleString()} wavelength spectr${count === 1 ? "um" : "a"}`;
  const tooltip = rangeText ? `${spectra} · ${rangeText}` : `${spectra} · range unknown`;
  return (
    <div>
      <span
        data-testid="summary-optical-pill"
        title={tooltip}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: "0.15rem 0.6rem",
          border: "1px solid var(--violet-600, #8a3ffc)",
          borderRadius: "var(--radius-pill, 999px)",
          background: "var(--surface-card, #fff)",
          color: "var(--violet-600, #8a3ffc)",
          fontSize: "var(--text-xs, 0.72rem)",
          fontWeight: "var(--weight-semibold, 600)",
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ textTransform: "uppercase" }}>{label}</span>
        {rangeText && (
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 400, color: "var(--text-muted, #64748b)" }}>{rangeText}</span>
        )}
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

const QUALITY_TEXT: Record<string, string> = {
  teach_points: "registered by teach points (Bruker FlexImaging .mis)",
};
const SOURCE_TEXT: Record<string, string> = {
  declared: "declared by the source",
  user_supplied: "user-supplied at conversion",
  unknown: "unknown",
};

/** True when the image is only laid over the MS extent (nothing registered it). */
const unregistered = (img: OpticalImageMeta) =>
  !img.registration?.quality || img.registration.quality === "assumed_full_extent";

/** Scale text for an axis-aligned affine (b = d = 0): image px per MS px, µm per image px, and
 *  a warning when the two axes disagree (the placement distorts the image). */
function scaleText(m: number[], umPerMsPx: number | null): string {
  const [a, , , , e] = m as [number, number, number, number, number, number];
  if (m[1] !== 0 || m[3] !== 0 || a === 0 || e === 0) return "affine with rotation/shear";
  const um = umPerMsPx ? ` (≈ ${formatCompact(umPerMsPx * Math.abs(a))} µm/image px)` : "";
  const uneven = Math.abs(Math.abs(a / e) - 1) > 0.05 ? " — stretched unevenly (aspect ratios differ)" : "";
  return `1 MS px = ${formatCompact(1 / a)} × ${formatCompact(1 / e)} image px${um}${uneven}`;
}

/** Imaging registration: MS pixel size, each image's registration to the MS grid (the index's
 *  `images[].affine`: quality + scale), and how the images relate to one another. */
function RegistrationRows({ grid, images }: { grid: ImagingGridWire | null; images: OpticalImageMeta[] }) {
  const ps = grid?.pixelSizeUm ?? null;
  const src = grid?.pixelSizeSource ?? null;
  const ext = grid?.canvas ?? (grid ? { width: grid.width, height: grid.height } : null);
  const srcText = src ? ` (${SOURCE_TEXT[src] ?? src})` : "";
  const pixelSize = ps ? `${ps.x} × ${ps.y} µm${srcText}` : `not stated${src === "unknown" ? "" : srcText}`;
  return (
    <>
      <StatRow label="MS pixel size" value={pixelSize} testid="summary-ms-pixel-size" />
      {images.map((img) => {
        const m = img.registration?.matrix;
        const quality = unregistered(img)
          ? `not registered — laid over the full MS extent${ext ? ` (${ext.width} × ${ext.height} px)` : ""}`
          : QUALITY_TEXT[img.registration!.quality!] ?? img.registration!.quality!;
        const size = img.width != null && img.height != null ? `${img.width} × ${img.height} px` : null;
        const scale = m ? scaleText(m, ps ? (ps.x + ps.y) / 2 : null) : null;
        return (
          <StatRow
            key={img.archivePath}
            label={`Image ↔ MS: ${img.name ?? img.archivePath}`}
            value={
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.15rem" }}>
                <span>{quality}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                  {[size, scale].filter(Boolean).join(" · ")}
                </span>
              </span>
            }
          />
        );
      })}
      {images.length > 1 && (
        <StatRow
          label="Image ↔ image"
          value={
            images.every(unregistered)
              ? "not registered to each other — each is only laid over the MS extent, so their relative placement is assumed"
              : "via the MS grid (no direct image-to-image registration is stored)"
          }
        />
      )}
    </>
  );
}
