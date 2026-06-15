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

type Member = ArchiveMemberList["members"][number];

const SAMPLE_ROWS = 50_000; // rows read for the on-demand histogram/stats

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
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
                <li key={m.path}>
                  <button
                    onClick={() => (manifest ? setMetadataReveal("manifest") : void pick(m))}
                    disabled={!clickable}
                    title={manifest ? "View mzpeak_index.json in Metadata" : (m.kind ?? undefined)}
                    data-testid={manifest ? "structure-manifest" : undefined}
                    data-category={category}
                    data-parquet={m.isParquet ? "true" : undefined}
                    style={{
                      display: "flex", width: "100%", justifyContent: "space-between", gap: "0.75rem", alignItems: "center",
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
                      {fmtBytes(m.bytes)}
                    </span>
                  </button>
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

function ParquetInspector({ footer }: { footer: ParquetFooter }) {
  const [open, setOpen] = useState<string | null>(null);
  const totalComp = footer.columns.reduce((s, c) => s + (c.compressedBytes ?? 0), 0);
  const totalRaw = footer.columns.reduce((s, c) => s + (c.uncompressedBytes ?? 0), 0);
  const ratio = totalComp > 0 ? totalRaw / totalComp : 0;

  return (
    <div data-testid="structure-footer">
      <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.15rem", wordBreak: "break-all" }}>{footer.archivePath}</h2>
      <p style={{ margin: "0 0 0.75rem", color: "var(--text-muted, #6b757e)", fontSize: "var(--text-sm, 0.82rem)" }}>
        <strong>{footer.numRows.toLocaleString()}</strong> rows · <strong>{footer.columns.length}</strong> columns ·{" "}
        <strong>{footer.numRowGroups}</strong> row group{footer.numRowGroups === 1 ? "" : "s"} ·{" "}
        {fmtBytes(totalComp)} compressed / {fmtBytes(totalRaw)} raw{ratio > 0 ? ` (${ratio.toFixed(1)}×)` : ""}
        {footer.createdBy ? ` · ${footer.createdBy}` : ""}
      </p>
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
                  <td style={{ padding: "0.25rem 0.6rem", textAlign: "right" }}>{fmtBytes(c.compressedBytes)}</td>
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
