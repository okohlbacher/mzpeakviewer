// Structure view — the parquet/archive inspector (harvested from mzPeakExplorer).
// Lists ZIP members (manifest pinned, clicking it jumps to the Metadata JSON view);
// clicking a parquet member shows its footer: archive header + per-column table. Click
// a column → deep footer stats + an on-demand "Sample value distribution" that reads
// up to ~50k rows (range reads) and computes a histogram + numeric stats (mean / median
// / stddev / quantiles).
import { Fragment, useEffect, useState } from "react";
import { useStore } from "../store";
import { engine } from "../engine";
import type { ArchiveMemberList, ParquetFooter, ParquetColumn, ColumnSample } from "@mzpeak/contracts";
import { Button } from "@mzpeak/ui-kit";
import { AdvancedTabs } from "./AdvancedTabs";
import { formatBytes } from "./render";

type Member = ArchiveMemberList["members"][number];

const SAMPLE_ROWS = 50_000; // rows read for the on-demand histogram/stats

function fmtNum(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}
function fmtFloat(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return Number.isInteger(n) ? String(n) : n.toPrecision(6).replace(/\.?0+$/, "");
}

/** The mzpeak manifest — always pinned to the top of the member list. */
function isManifest(path: string): boolean {
  return path.split("/").pop()?.toLowerCase() === "mzpeak_index.json";
}
/** Embedded raster image (optical / derived-MS overview, the images/ folder — Q10). */
function isImage(path: string): boolean {
  return /\.(tiff?|png|jpe?g|gif|bmp|webp)$/i.test(path);
}

/** Member category — drives both ordering and the row icon. */
type MemberCategory = "manifest" | "parquet" | "image" | "other";
function categoryOf(m: Member): MemberCategory {
  if (isManifest(m.path)) return "manifest";
  if (m.isParquet) return "parquet";
  if (isImage(m.path)) return "image";
  return "other"; // embedded files / anything else
}
/** Render order: index.json (the TOC) → Parquet payload → images → other embedded files.
 *  Embedded files are shown ONLY after the Parquet payload. Stable within each category. */
const CATEGORY_RANK: Record<MemberCategory, number> = { manifest: 0, parquet: 1, image: 2, other: 3 };
function orderMembers(members: Member[]): Member[] {
  return members
    .map((m, i) => ({ m, i }))
    .sort((a, b) => CATEGORY_RANK[categoryOf(a.m)] - CATEGORY_RANK[categoryOf(b.m)] || a.i - b.i)
    .map((x) => x.m);
}

/** Distinct icon per category: braces = index.json, columns = parquet arrays, picture =
 *  image, page = other embedded file. Fixed color per category so the kind is scannable. */
function MemberIcon({ category }: { category: MemberCategory }) {
  const base = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  const sz = (color: string) => ({ width: "0.95rem", height: "0.95rem", flexShrink: 0, color });
  switch (category) {
    case "manifest": // index.json — curly braces
      return (
        <svg {...base} style={sz("var(--accent, #3b54da)")}>
          <path d="M9 4H8a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1" />
          <path d="M15 4h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1" />
        </svg>
      );
    case "parquet": // columnar arrays — columns
      return (
        <svg {...base} style={sz("var(--blue-600, #3b54da)")}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="9" y1="4" x2="9" y2="20" />
          <line x1="15" y1="4" x2="15" y2="20" />
        </svg>
      );
    case "image": // embedded raster image
      return (
        <svg {...base} style={sz("var(--success, #1a8249)")}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      );
    default: // other embedded file — page with folded corner
      return (
        <svg {...base} style={sz("var(--text-muted, #94a3b8)")}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      );
  }
}

// ── Per-member raw download ──────────────────────────────────────────────────────
// Each archive member downloads AS-IS: the parquet tables are already in the best
// portable serialization (Apache Parquet — opens directly in pandas / pyarrow / DuckDB /
// Polars / Arrow), so we save the raw `.parquet` bytes rather than a lossy CSV. The
// manifest saves as JSON, the SDRF as TSV, images as-is — all just raw member bytes.

// Browsers can't reliably hold an ArrayBuffer past ~2 GiB; members over this can't be
// downloaded in-browser (the worker would have to materialize the whole thing).
const DOWNLOAD_HARD_MAX = 2 * 1024 * 1024 * 1024;
// Above this we confirm first — the full member is read into memory + transferred.
const DOWNLOAD_CONFIRM_BYTES = 256 * 1024 * 1024;

function mimeForMember(path: string): string {
  switch (path.split(".").pop()?.toLowerCase()) {
    case "parquet": return "application/vnd.apache.parquet";
    case "json": return "application/json";
    case "tsv": return "text/tab-separated-values";
    case "csv": return "text/csv";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "tif":
    case "tiff": return "image/tiff";
    default: return "application/octet-stream";
  }
}

/** Download a single archive member's raw bytes (the parquet tables stay parquet). */
function MemberDownload({ path, bytes }: { path: string; bytes: number | null | undefined }) {
  const [busy, setBusy] = useState(false);
  const name = path.split("/").pop() ?? path;
  const tooBig = typeof bytes === "number" && bytes > DOWNLOAD_HARD_MAX;

  async function download() {
    if (busy || tooBig) return;
    if (
      typeof bytes === "number" && bytes > DOWNLOAD_CONFIRM_BYTES &&
      !window.confirm(`${name} is ${formatBytes(bytes)} — it will be read fully into memory. Download?`)
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await engine.archiveMemberBytes(path, DOWNLOAD_HARD_MAX);
      if (res.truncated) {
        window.alert(`${name} is larger than the in-browser download limit (${formatBytes(DOWNLOAD_HARD_MAX)}); not downloaded (a truncated parquet would be unreadable).`);
        return;
      }
      const url = URL.createObjectURL(new Blob([res.bytes], { type: mimeForMember(path) }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(`Couldn't download ${name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy || tooBig}
      title={tooBig ? `Too large to download in-browser (${formatBytes(bytes)})` : `Download ${name}`}
      aria-label={`Download ${name}`}
      data-testid={`structure-download-${path}`}
      onClick={() => void download()}
    >
      {busy ? "…" : "⭳"}
    </Button>
  );
}

export function Structure() {
  const phase = useStore((s) => s.phase);
  const setMetadataReveal = useStore((s) => s.setMetadataReveal);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [footer, setFooter] = useState<ParquetFooter | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "ready") return;
    let live = true;
    setError(null);
    setFooter(null);
    setSelected(null);
    engine
      .archiveList()
      .then((r) => { if (live) setMembers(r.members); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [phase]);

  async function pick(m: Member) {
    if (!m.isParquet) return;
    setSelected(m.path);
    setFooter(null);
    setError(null);
    setLoading(true);
    try {
      setFooter(await engine.parquetFooter(m.path));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-testid="structure-view">
      <AdvancedTabs />
      <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>
        <div style={{ minWidth: 280, flexShrink: 0 }}>
          <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Archive members</h2>
          {error && <p data-testid="structure-error" style={{ color: "var(--danger, #c00)" }}>{error}</p>}
          <ul data-testid="structure-members" style={{ listStyle: "none", margin: 0, padding: 0, fontFamily: "var(--font-mono, monospace)", fontSize: "var(--text-sm, 0.85rem)" }}>
            {orderMembers(members).map((m) => {
              const category = categoryOf(m);
              const manifest = category === "manifest";
              const clickable = m.isParquet || manifest;
              return (
                <li key={m.path} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  <button
                    onClick={() => (manifest ? setMetadataReveal("manifest") : void pick(m))}
                    disabled={!clickable}
                    title={manifest ? "View mzpeak_index.json in Metadata" : (m.kind ?? undefined)}
                    data-testid={manifest ? "structure-manifest" : undefined}
                    data-category={category}
                    data-parquet={m.isParquet ? "true" : undefined}
                    style={{
                      display: "flex", flex: 1, minWidth: 0, justifyContent: "space-between", gap: "0.75rem", alignItems: "center",
                      padding: "0.25rem 0.4rem", border: "none", borderRadius: "var(--radius-sm, 4px)",
                      background: selected === m.path ? "var(--surface-panel, #f1f5f9)" : manifest ? "var(--accent-subtle, #f2f4fe)" : "transparent",
                      color: clickable ? "var(--text-link, #2563eb)" : "var(--text-body, #353c43)",
                      cursor: clickable ? "pointer" : "default", textAlign: "left",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <MemberIcon category={category} />
                      {manifest && (
                        <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.62rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--accent, #3b54da)", background: "var(--gray-0, #fff)", border: "1px solid var(--accent, #3b54da)", borderRadius: 3, padding: "0 0.3rem", flexShrink: 0 }}>
                          manifest
                        </span>
                      )}
                      {m.path}
                    </span>
                    <span style={{ color: "var(--text-muted, #94a3b8)", flexShrink: 0, display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      {manifest && <span style={{ color: "var(--accent, #3b54da)", fontFamily: "var(--font-sans)", fontSize: "0.7rem" }}>View JSON →</span>}
                      {formatBytes(m.bytes)}
                    </span>
                  </button>
                  <MemberDownload path={m.path} bytes={m.bytes} />
                </li>
              );
            })}
          </ul>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {loading && <p style={{ color: "var(--text-muted, #94a3b8)" }}>Reading parquet footer…</p>}
          {!loading && footer && <ParquetInspector footer={footer} />}
          {!loading && !footer && <p style={{ color: "var(--text-muted, #94a3b8)" }}>Select a parquet member to inspect its arrays.</p>}
        </div>
      </div>
    </div>
  );
}

/** Median of a numeric array (sorted copy; 0 for empty). */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A row group bigger than this, when it's the only one (or it dwarfs the rest), is the
 *  monolithic-row-group anti-pattern: a single random spectrum read decodes the whole group. */
const MONOLITHIC_BYTES = 64_000_000;

/**
 * Chunk / row-group structure for a parquet member — the signal that distinguishes a
 * well-chunked file (many uniform ~25 MB groups, seekable) from the monolithic-row-group
 * anti-pattern (one 942 MB group, no page index → every random read decodes the whole group).
 * Reads only footer metadata already on `ParquetFooter`. See the converter handoff
 * (mzML2mzPeak/docs/handoff-mzpeak-profile-rowgroup-chunking-2026-06-15.md).
 */
function ChunkStructure({ footer, numSpectra }: { footer: ParquetFooter; numSpectra: number | null }) {
  const sizes = footer.rowGroupSizes ?? [];
  if (sizes.length === 0) return null;
  const bytes = sizes.map((g) => g.bytes);
  const maxB = Math.max(...bytes);
  const minB = Math.min(...bytes);
  const medB = median(bytes);
  // chunks-per-spectrum for the spectra data facets (1 row = 1 m/z chunk; >1 ⇒ chunked m/z).
  const isSpectraFacet = /spectra_(data|peaks)\.parquet$/i.test(footer.archivePath);
  const chunksPerSpec =
    isSpectraFacet && numSpectra && numSpectra > 0 ? footer.numRows / numSpectra : null;
  // Monolithic: one big group, OR a single group dwarfing the median (>4×) and over the cap.
  const monolithic =
    (footer.numRowGroups === 1 && maxB > MONOLITHIC_BYTES) ||
    (maxB > MONOLITHIC_BYTES && maxB > 4 * Math.max(1, medB));
  const pageIdx = footer.hasPageIndex;

  return (
    <div data-testid="structure-rowgroups" style={{ margin: "0 0 0.75rem", fontSize: "var(--text-sm, 0.8rem)", color: "var(--text-muted, #6b757e)" }}>
      <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
        row groups: <strong>{footer.numRowGroups}</strong>
        {sizes.length > 1
          ? ` · sizes min ${formatBytes(minB)} / med ${formatBytes(medB)} / max ${formatBytes(maxB)}`
          : ` · ${formatBytes(maxB)} (${sizes[0]!.rows.toLocaleString()} rows)`}
        {" · page index: "}
        <strong style={{ color: pageIdx === false ? "var(--warning, #b45309)" : undefined }}>
          {pageIdx === true ? "yes" : pageIdx === false ? "no" : "—"}
        </strong>
        {chunksPerSpec != null ? ` · ${chunksPerSpec.toFixed(1)} chunks/spectrum` : ""}
      </span>
      {monolithic && (
        <div
          data-testid="structure-monolithic-warning"
          style={{
            marginTop: "0.35rem", padding: "0.3rem 0.5rem", borderRadius: "var(--radius-sm, 4px)",
            background: "var(--warning-subtle, #fef3c7)", color: "var(--warning-text, #92400e)",
            border: "1px solid var(--warning, #f59e0b)", fontFamily: "var(--font-sans)", fontSize: "0.76rem",
          }}
        >
          ⚠ Single large row group ({formatBytes(maxB)}){pageIdx === false ? " and no page index" : ""} — a
          random spectrum read must decode the whole group. Re-chunking the writer into smaller row groups
          (and emitting a page index) would make single-spectrum access fast.
        </div>
      )}
    </div>
  );
}

function ParquetInspector({ footer }: { footer: ParquetFooter }) {
  const [open, setOpen] = useState<string | null>(null);
  const numSpectra = useStore((s) => s.stats?.numSpectra ?? null);
  const totalComp = footer.columns.reduce((s, c) => s + (c.compressedBytes ?? 0), 0);
  const totalRaw = footer.columns.reduce((s, c) => s + (c.uncompressedBytes ?? 0), 0);
  const ratio = totalComp > 0 ? totalRaw / totalComp : 0;

  return (
    <div data-testid="structure-footer">
      <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.15rem", wordBreak: "break-all" }}>{footer.archivePath}</h2>
      <p style={{ margin: "0 0 0.4rem", color: "var(--text-muted, #6b757e)", fontSize: "var(--text-sm, 0.82rem)" }}>
        <strong>{footer.numRows.toLocaleString()}</strong> rows · <strong>{footer.columns.length}</strong> columns ·{" "}
        <strong>{footer.numRowGroups}</strong> row group{footer.numRowGroups === 1 ? "" : "s"} ·{" "}
        {formatBytes(totalComp)} compressed / {formatBytes(totalRaw)} raw{ratio > 0 ? ` (${ratio.toFixed(1)}×)` : ""}
        {footer.createdBy ? ` · ${footer.createdBy}` : ""}
      </p>
      <ChunkStructure footer={footer} numSpectra={numSpectra} />
      <table style={{ borderCollapse: "collapse", fontSize: "var(--text-sm, 0.82rem)", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--text-muted, #94a3b8)" }}>
            <th style={{ padding: "0.2rem 0.6rem 0.2rem 0" }}>column</th>
            <th style={{ padding: "0.2rem 0.6rem" }}>type</th>
            <th style={{ padding: "0.2rem 0.6rem" }}>codec</th>
            <th style={{ padding: "0.2rem 0.6rem", textAlign: "right" }}>values</th>
            <th style={{ padding: "0.2rem 0.6rem", textAlign: "right" }}>size</th>
            <th style={{ padding: "0.2rem 0.6rem", textAlign: "right" }}>share</th>
          </tr>
        </thead>
        <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
          {footer.columns.map((c) => {
            const isOpen = open === c.name;
            const share = totalComp > 0 ? ((c.compressedBytes ?? 0) / totalComp) * 100 : 0;
            return (
              <Fragment key={c.name}>
                <tr
                  data-testid={`structure-col-${c.name}`}
                  onClick={() => setOpen(isOpen ? null : c.name)}
                  style={{ borderTop: "1px solid var(--border-hairline, #eee)", cursor: "pointer", background: isOpen ? "var(--surface-panel, #f1f5f9)" : undefined }}
                  title="Click for deep stats + value distribution"
                >
                  <td style={{ padding: "0.25rem 0.6rem 0.25rem 0", color: "var(--text-link, #2563eb)" }}>
                    <span aria-hidden style={{ display: "inline-block", width: "0.8rem", color: "var(--text-muted)" }}>{isOpen ? "▾" : "▸"}</span>
                    {c.name}
                  </td>
                  <td style={{ padding: "0.25rem 0.6rem" }}>{c.logicalType ?? c.type}</td>
                  <td style={{ padding: "0.25rem 0.6rem" }}>{c.codec ?? "—"}</td>
                  <td style={{ padding: "0.25rem 0.6rem", textAlign: "right" }}>{fmtNum(c.numValues)}</td>
                  <td style={{ padding: "0.25rem 0.6rem", textAlign: "right" }}>{formatBytes(c.compressedBytes)}</td>
                  <td style={{ padding: "0.25rem 0.6rem", textAlign: "right" }}>{share.toFixed(0)}%</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      <DeepColumnPanel archivePath={footer.archivePath} col={c} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DeepColumnPanel({ archivePath, col }: { archivePath: string; col: ParquetColumn }) {
  return (
    <div data-testid={`structure-deep-${col.name}`} style={{ padding: "0.6rem 0.8rem", background: "var(--surface-sunken, #f4f6f8)", borderRadius: 6, margin: "0.25rem 0 0.5rem", fontFamily: "var(--font-sans)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.35rem 1rem", fontSize: "0.78rem" }}>
        <Stat label="Physical type" value={col.type} />
        <Stat label="Logical type" value={col.logicalType ?? "—"} />
        <Stat label="Encodings" value={col.encodings?.join(", ") || "—"} />
        <Stat label="Dictionary" value={col.dictionary ? `yes (${fmtNum(col.dictionaryPages)} pg)` : "no"} />
        <Stat label="Data pages" value={fmtNum(col.dataPages)} />
        <Stat label="Row groups" value={fmtNum(col.rowGroups)} />
        <Stat label="Min" value={col.min ?? "—"} />
        <Stat label="Max" value={col.max ?? "—"} />
        <Stat label="Nulls" value={fmtNum(col.nullCount)} />
        <Stat label="Distinct" value={fmtNum(col.distinctCount)} />
      </div>
      <SampleDistribution archivePath={archivePath} column={col.name} />
    </div>
  );
}

function SampleDistribution({ archivePath, column }: { archivePath: string; column: string }) {
  const [sample, setSample] = useState<ColumnSample | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      setSample(await engine.sampleColumn(archivePath, column, SAMPLE_ROWS));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const s = sample?.stats ?? null;
  const hist = sample?.histogram ?? null;
  const maxBin = hist ? Math.max(1, ...hist) : 1;

  return (
    <div style={{ marginTop: "0.6rem" }}>
      {!sample && (
        <Button variant="secondary" size="sm" disabled={busy} data-testid={`structure-sample-${column}`} onClick={() => void run()}>
          {busy ? "Reading…" : `Sample value distribution (≤${(SAMPLE_ROWS / 1000) | 0}k rows)`}
        </Button>
      )}
      {err && <p style={{ color: "var(--danger, #c00)", fontSize: "0.75rem", margin: "0.3rem 0 0" }}>{err}</p>}
      {sample && !s && <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", margin: "0.3rem 0 0" }}>No numeric values in the sample (non-numeric column).</p>}
      {sample && s && (
        <div data-testid={`structure-stats-${column}`}>
          {/* Histogram */}
          {hist && sample.histRange && (
            <div style={{ marginBottom: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 60 }}>
                {hist.map((c, i) => (
                  <div key={i} title={`${c.toLocaleString()}`} style={{ flex: 1, height: `${(c / maxBin) * 100}%`, minHeight: c > 0 ? 1 : 0, background: "var(--accent, #3b54da)", opacity: 0.75, borderRadius: "1px 1px 0 0" }} />
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                <span>{fmtFloat(sample.histRange[0])}</span>
                <span>{fmtFloat(sample.histRange[1])}</span>
              </div>
            </div>
          )}
          {/* Computed numeric stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "0.3rem 1rem", fontSize: "0.78rem" }}>
            <Stat label="n (numeric)" value={fmtNum(s.count)} />
            <Stat label="nulls/non-num" value={fmtNum(s.nulls)} />
            <Stat label="min" value={fmtFloat(s.min)} />
            <Stat label="max" value={fmtFloat(s.max)} />
            <Stat label="mean" value={fmtFloat(s.mean)} />
            <Stat label="median" value={fmtFloat(s.median)} />
            <Stat label="stddev" value={fmtFloat(s.stddev)} />
            <Stat label="p25" value={fmtFloat(s.p25)} />
            <Stat label="p75" value={fmtFloat(s.p75)} />
          </div>
          <p style={{ fontSize: "0.68rem", color: "var(--text-faint, #9aa4ad)", margin: "0.35rem 0 0" }}>
            from {s.sampled.toLocaleString()} sampled rows{sample.totalRows > s.sampled ? ` of ${sample.totalRows.toLocaleString()}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--text-muted, #6b757e)", fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-body, #353c43)", wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}
