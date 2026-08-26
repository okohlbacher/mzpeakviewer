// Study design view — comprehensive display of the embedded SDRF sample metadata.
//
// Shaped by an adversarial plan review (kimi + codex, 2026-08-18):
//  - gzip-aware member decode (0x1f8b sniff → gunzipBytes); truncation surfaces a
//    warning and suppresses aggregates instead of silently reporting wrong counts.
//  - counts shown separately (rows / sources / assays / data files) — SDRF semantics.
//  - filter runs over the FULL model, then this-run rows are pinned, then the render
//    cap applies (filter→partition→cap ordering; a match past the cap is never lost).
//  - compact-columns mode hides constant columns but always keeps source/assay/
//    data file/label/factors, states how many are hidden, and resurfaces the hidden
//    protocol metadata as the "Acquisition & processing" card.
//  - this-run rows get a textual "◂ this run" marker (tint is not the only signal).
//  - explicit empty states: no study data (deep-link case) and projection-only
//    (channels/samples but no embedded SDRF member).
import { useEffect, useMemo, useState } from "react";
import { engine } from "../engine";
import { useStore, showStudy } from "../store";
import { parseSdrf } from "../sdrf";
import { gunzipBytes } from "../gunzip";
import { buildSdrfDesign, compactColumns, sdrfValueName, type SdrfDesign } from "../sdrfDesign";
import { Button } from "@mzpeak/ui-kit";

const SDRF_MAX_BYTES = 8 * 1024 * 1024;
const RENDER_MAX_ROWS = 500;
const RENDER_MAX_COLS = 80;

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; design: SdrfDesign; truncated: boolean }
  | { kind: "error"; message: string };

// Cache the last fetch so tab switches don't refetch/reparse (the view unmounts on every
// switch). Keyed by source+file+member; a new open with the same key would serve a stale
// model only for two different files with identical name AND member path — acceptable.
let cache: { key: string; state: LoadState } | null = null;

/** Accession → external link, ALLOWLISTED (anchored full-string match; review finding). */
function accessionUrl(acc: string): string | null {
  if (/^PXD\d+$/.test(acc)) return `https://www.ebi.ac.uk/pride/archive/projects/${acc}`;
  if (/^MTBLS\d+$/.test(acc)) return `https://www.ebi.ac.uk/metabolights/${acc}`;
  return null;
}

export function StudyDesign() {
  const phase = useStore((s) => s.phase);
  const sdrfMember = useStore((s) => s.sdrfMember);
  const sdrfMeta = useStore((s) => s.sdrfMeta);
  const channels = useStore((s) => s.channels);
  const channelsSource = useStore((s) => s.channelsSource);
  const study = useStore((s) => s.study);
  const studyRunId = useStore((s) => s.studyRunId);
  const sourceUrl = useStore((s) => s.sourceUrl);
  const fileName = useStore((s) => s.fileName);
  const available = useStore(showStudy);

  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [filter, setFilter] = useState("");
  const [showAllCols, setShowAllCols] = useState(false);

  const cacheKey = `${sourceUrl ?? "local"}::${fileName ?? ""}::${sdrfMember ?? ""}::${studyRunId ?? ""}`;

  useEffect(() => {
    let alive = true;
    if (!sdrfMember) {
      setLoad({ kind: "idle" });
      return;
    }
    if (cache?.key === cacheKey && cache.state.kind === "loaded") {
      setLoad(cache.state);
      return;
    }
    setLoad({ kind: "loading" });
    (async () => {
      try {
        const res = await engine.archiveMemberBytes(sdrfMember, SDRF_MAX_BYTES);
        let bytes = new Uint8Array(res.bytes);
        // Gzip sniff — .sdrf.tsv.gz members are real (review finding F2).
        if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
          bytes = await gunzipBytes(bytes);
        }
        let text = new TextDecoder().decode(bytes);
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
        const { columns, rows } = parseSdrf(text);
        // A truncated read may cut the last row mid-line — drop it rather than show garbage.
        const safeRows = res.truncated ? rows.slice(0, -1) : rows;
        const design = buildSdrfDesign(columns, safeRows, studyRunId);
        const state: LoadState = { kind: "loaded", design, truncated: res.truncated };
        cache = { key: cacheKey, state };
        if (alive) setLoad(state);
      } catch (err) {
        if (alive) setLoad({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [sdrfMember, cacheKey, studyRunId]);

  if (phase !== "ready") return null;

  // Deep-link to a file without study data: explicit empty state (review finding F6).
  if (!available) {
    return (
      <p data-testid="study-empty" style={{ color: "var(--text-muted)" }}>
        This file carries no study metadata (no embedded SDRF, no sample annotations).
      </p>
    );
  }

  const s = (study && typeof study === "object" ? study : null) as { dataset_accession?: unknown; title?: unknown } | null;
  const accession =
    (typeof s?.dataset_accession === "string" ? s.dataset_accession : null) ??
    sdrfMeta?.datasetAccession ??
    null;
  const title = typeof s?.title === "string" ? s.title : null;
  const accUrl = accession ? accessionUrl(accession) : null;

  const design = load.kind === "loaded" ? load.design : null;

  return (
    <div data-testid="study-view" style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 1100 }}>
      {/* ── Header strip ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.6rem" }}>
        {accession && (
          <span data-testid="study-accession" style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-heading)" }}>
            {accUrl ? (
              <a href={accUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue-600, #3b54da)" }}>
                {accession} ↗
              </a>
            ) : (
              accession
            )}
          </span>
        )}
        {title && <span style={{ color: "var(--text-secondary)" }}>{title}</span>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        {sdrfMember && <Chip label={`member: ${sdrfMember}`} />}
        {sdrfMeta?.sha256 && <Chip label={`declared SHA-256: ${sdrfMeta.sha256.slice(0, 12)}…`} title={sdrfMeta.sha256} />}
        {sdrfMeta?.embedScope && <Chip label={`scope: ${sdrfMeta.embedScope}`} />}
        {sdrfMeta?.precedence && <Chip label={`precedence: ${sdrfMeta.precedence}`} />}
      </div>

      {load.kind === "loading" && <p style={{ color: "var(--text-muted)" }}>Loading SDRF…</p>}
      {load.kind === "error" && (
        <p data-testid="study-error" style={{ color: "var(--red-600, #dc2626)" }}>
          Couldn’t load the embedded SDRF: {load.message}
        </p>
      )}
      {!sdrfMember && (
        <p data-testid="study-projection-only" style={{ color: "var(--text-muted)" }}>
          No SDRF file is embedded in this archive — showing the producer-encoded sample
          annotations only.
        </p>
      )}

      {load.kind === "loaded" && load.truncated && (
        <Banner text={`The SDRF member exceeds the ${(SDRF_MAX_BYTES / 1048576).toFixed(0)} MB read cap — the table below is PARTIAL and aggregate counts are suppressed.`} />
      )}
      {design?.warnings.map((w, i) => <Banner key={i} text={w} />)}

      {/* ── Overview cards ───────────────────────────────────────────── */}
      {design && !(load.kind === "loaded" && load.truncated) && (
        <div data-testid="study-overview" style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
          <Card label="SDRF rows" value={String(design.counts.rows)} />
          <Card label="samples (source names)" value={String(design.counts.sources)} />
          <Card label="assays" value={String(design.counts.assays)} />
          <Card label="data files" value={String(design.counts.dataFiles)} />
          <Card
            label={`label scheme${design.scheme.scope === "study" ? " (study-wide)" : ""}`}
            value={design.scheme.label}
            accent={design.scheme.kind !== "none"}
          />
          <Card label="this run" value={design.runRowIndices.length > 0 ? `${design.runRowIndices.length} row${design.runRowIndices.length === 1 ? "" : "s"}` : "not matched"} />
        </div>
      )}

      {/* ── Highlights (organism / part / disease …) ─────────────────── */}
      {design && design.highlights.length > 0 && (
        <section aria-label="Sample characteristics overview">
          <SectionTitle text="Samples" />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {design.highlights.map((h) => (
              <LevelRow key={h.label} label={h.label} levels={h.levels} total={h.totalLevels} />
            ))}
          </div>
        </section>
      )}

      {/* ── Experimental factors ─────────────────────────────────────── */}
      <section aria-label="Experimental factors">
        <SectionTitle text="Experimental factors" />
        {design && design.factors.length === 0 && (
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            No <code>factor value[…]</code> columns — the experimental design is not annotated in this SDRF.
          </p>
        )}
        {design && design.factors.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {design.factors.map((f) => (
              <LevelRow
                key={f.columnIndex}
                label={f.name}
                levels={f.levels}
                total={f.totalLevels}
                unit="rows"
                accent
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Channel map (isobaric) ───────────────────────────────────── */}
      {channels.length > 0 && (
        <section aria-label="Isobaric channel map">
          <SectionTitle
            text={`Channel map${channelsSource === "sdrf-study" ? " — study-wide (this run was not matched in the SDRF)" : ""}`}
          />
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: "var(--text-sm)" }}>
              <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                Isobaric channels with reporter m/z and assigned samples
              </caption>
              <thead>
                <tr>
                  {["channel", "reporter m/z", "sample", "bound to this run"].map((h) => (
                    <th key={h} scope="col" style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {channels.map((c, i) => (
                  <tr key={i} data-testid={`study-channel-${i}`}>
                    <th scope="row" style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontWeight: 600, textAlign: "left" }}>{c.channelLabel ?? "?"}</th>
                    <td style={{ ...tdStyle, fontFamily: "var(--font-mono)" }}>{c.reporterMz != null ? c.reporterMz.toFixed(4) : "—"}</td>
                    <td style={tdStyle}>{c.sampleName ?? "—"}</td>
                    <td style={tdStyle}>{c.boundToThisRun ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Acquisition & processing (from constant protocol columns) ── */}
      {design && design.protocol.length > 0 && (
        <section aria-label="Acquisition and processing">
          <SectionTitle text="Acquisition & processing" />
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "0.25rem 1rem", fontSize: "var(--text-sm)" }}>
            {design.protocol.map((p) => (
              <ProtocolRow key={p.label} label={p.label} values={p.values} />
            ))}
          </dl>
        </section>
      )}

      {/* ── Sample table ─────────────────────────────────────────────── */}
      {design && <SampleTable design={design} filter={filter} setFilter={setFilter} showAllCols={showAllCols} setShowAllCols={setShowAllCols} />}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.25rem 0.7rem",
  borderBottom: "1px solid var(--border-default)",
  color: "var(--text-muted)",
  fontWeight: 600,
  fontSize: "var(--text-xs)",
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  zIndex: 2,
  background: "var(--surface-card, #fff)",
};
const tdStyle: React.CSSProperties = {
  padding: "0.22rem 0.7rem",
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
  borderBottom: "1px solid var(--border-hairline, #f1f5f9)",
};

function Chip({ label, title }: { label: string; title?: string }) {
  return (
    <span title={title} style={{ border: "1px solid var(--border-default)", borderRadius: 999, padding: "0.1rem 0.55rem", background: "var(--surface-card, #fff)", fontFamily: "var(--font-mono)" }}>
      {label}
    </span>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <p role="status" style={{ margin: 0, padding: "0.4rem 0.7rem", borderRadius: 6, background: "var(--amber-50, #fffbeb)", border: "1px solid var(--amber-300, #fcd34d)", color: "var(--amber-900, #78350f)", fontSize: "var(--text-sm)" }}>
      ⚠ {text}
    </p>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ border: `1px solid ${accent ? "var(--blue-600, #3b54da)" : "var(--border-default, #e2e8f0)"}`, borderRadius: 8, padding: "0.45rem 0.8rem", minWidth: 110 }}>
      <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: accent ? "var(--blue-600, #3b54da)" : "var(--text-heading)", fontFamily: "var(--font-mono)" }}>{value}</div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function SectionTitle({ text }: { text: string }) {
  return <h3 style={{ margin: "0.4rem 0 0.4rem", fontSize: "var(--text-md, 1rem)", color: "var(--text-heading)" }}>{text}</h3>;
}

function LevelRow({ label, levels, total, unit, accent }: { label: string; levels: { value: string; count: number }[]; total: number; unit?: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.4rem", fontSize: "var(--text-sm)" }}>
      <span style={{ minWidth: 130, color: "var(--text-muted)" }}>{label}</span>
      {levels.map((l) => (
        <span key={l.value} style={{ border: `1px solid ${accent ? "var(--blue-600, #3b54da)" : "var(--border-default)"}`, borderRadius: 999, padding: "0.05rem 0.55rem", color: accent ? "var(--blue-600, #3b54da)" : "var(--text-secondary)" }}>
          {l.value} <span style={{ color: "var(--text-muted)" }}>×{l.count}{unit ? ` ${unit}` : ""}</span>
        </span>
      ))}
      {total > levels.length && <span style={{ color: "var(--text-muted)" }}>+{total - levels.length} more</span>}
    </div>
  );
}

function ProtocolRow({ label, values }: { label: string; values: string[] }) {
  return (
    <>
      <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd style={{ margin: 0, color: "var(--text-secondary)" }}>{values.map(sdrfValueName).join(" · ")}</dd>
    </>
  );
}

/** The full SDRF table: filter over the FULL model → pin this-run rows → render cap. */
function SampleTable({
  design, filter, setFilter, showAllCols, setShowAllCols,
}: {
  design: SdrfDesign;
  filter: string;
  setFilter: (v: string) => void;
  showAllCols: boolean;
  setShowAllCols: (v: boolean) => void;
}) {
  const visibleCols = useMemo(() => {
    const cols = showAllCols ? design.columns : compactColumns(design.columns);
    return cols.slice(0, RENDER_MAX_COLS);
  }, [design, showAllCols]);
  const hiddenCount = design.columns.length - visibleCols.length;

  const runSet = useMemo(() => new Set(design.runRowIndices), [design]);

  // filter (full model, ALL columns — a hidden-column match still matches) → partition → cap
  const { shown, matched } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const idxs: number[] = [];
    for (let i = 0; i < design.rows.length; i++) {
      if (!q || design.rows[i]!.some((c) => c.toLowerCase().includes(q))) idxs.push(i);
    }
    const pinned = idxs.filter((i) => runSet.has(i));
    const rest = idxs.filter((i) => !runSet.has(i));
    return { shown: [...pinned, ...rest].slice(0, RENDER_MAX_ROWS), matched: idxs.length };
  }, [design, filter, runSet]);

  return (
    <section aria-label="SDRF sample table">
      <SectionTitle text="Sample table (SDRF)" />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
        <label style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", display: "flex", gap: "0.35rem", alignItems: "center" }}>
          Filter
          <input
            data-testid="study-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="any column…"
            style={{ padding: "0.25rem 0.5rem", border: "1px solid var(--border-default)", borderRadius: 6, background: "var(--surface-input)", color: "var(--text-heading)" }}
          />
        </label>
        <label style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", display: "flex", gap: "0.3rem", alignItems: "center" }}>
          <input type="checkbox" checked={showAllCols} onChange={(e) => setShowAllCols(e.target.checked)} data-testid="study-allcols" />
          show all columns
        </label>
        <span role="status" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          {matched.toLocaleString()} of {design.rows.length.toLocaleString()} rows match
          {shown.length < matched ? ` · showing first ${shown.length}` : ""}
          {!showAllCols && hiddenCount > 0 ? ` · ${hiddenCount} constant columns hidden` : ""}
          {showAllCols && hiddenCount > 0 ? ` · ${hiddenCount} columns beyond render cap` : ""}
        </span>
      </div>
      <div tabIndex={0} aria-label="SDRF table scroll region" style={{ overflow: "auto", maxHeight: 480, border: "1px solid var(--border-default)", borderRadius: 6 }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
          <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Full SDRF sample and data relationship table
          </caption>
          <thead>
            <tr>
              <th scope="col" style={{ ...thStyle, position: "sticky", left: 0, zIndex: 3 }} aria-label="this-run marker" />
              {visibleCols.map((c) => (
                <th key={c.index} scope="col" style={{ ...thStyle, ...(c.cls === "factor" ? { color: "var(--blue-600, #3b54da)" } : {}) }} title={c.raw}>
                  {c.raw}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((ri) => {
              const isRun = runSet.has(ri);
              const row = design.rows[ri]!;
              return (
                <tr key={ri} data-testid={isRun ? "study-run-row" : undefined} style={isRun ? { background: "var(--blue-50, #eef2ff)" } : undefined}>
                  <td style={{ ...tdStyle, position: "sticky", left: 0, zIndex: 1, background: isRun ? "var(--blue-50, #eef2ff)" : "var(--surface-card, #fff)", color: "var(--blue-600, #3b54da)", fontWeight: 700 }}>
                    {isRun ? "◂ this run" : ""}
                  </td>
                  {visibleCols.map((c) => (
                    <td key={c.index} style={{ ...tdStyle, ...(isRun ? { background: "var(--blue-50, #eef2ff)" } : {}) }}>
                      {row[c.index] ?? ""}
                      {isRun && c.index === design.dataFileColumnIndex && (
                        <span
                          data-testid="study-this-file-pill"
                          style={{ marginLeft: "0.4rem", border: "1px solid var(--blue-600, #3b54da)", color: "var(--blue-600, #3b54da)", borderRadius: 999, padding: "0 0.4rem", fontSize: "0.85em", fontFamily: "var(--font-sans)", whiteSpace: "nowrap" }}
                        >
                          this file
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function StudyDesignCta() {
  const available = useStore(showStudy);
  const setView = useStore((s) => s.setView);
  if (!available) return null;
  return (
    <Button variant="secondary" size="sm" onClick={() => setView("study")} data-testid="summary-open-study">
      Open Study design →
    </Button>
  );
}
