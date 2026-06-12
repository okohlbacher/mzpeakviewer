import { useState } from "react";
import { useStore } from "../state/store";
import type { Cell, ChannelAssignment, ChannelRole, StudyMetadata, StudyRow } from "../reader/types";
import { useCvTerms, cvTitle } from "./cvTerms";
import { olsUrl } from "../reader/curie";

const ROLE_LABEL: Record<ChannelRole, string> = {
  experimental: "Experimental", reference: "Reference", carrier: "Carrier",
  norm: "Norm", empty: "Empty", unknown: "—",
};
const FORMAT_LABEL: Record<StudyMetadata["format"], string> = {
  sdrf: "SDRF", "isa-tab": "ISA-Tab", "isa-json": "ISA-JSON",
};

function accessionUrl(accession: string | null): string | null {
  if (!accession) return null;
  if (/^PXD\d+/i.test(accession)) return `https://www.ebi.ac.uk/pride/archive/projects/${accession}`;
  if (/^MTBLS\d+/i.test(accession)) return `https://www.ebi.ac.uk/metabolights/${accession}`;
  return null;
}

/** Characteristic value by case-insensitive key (SDRF lowercase vs ISA Title-Case). */
function charVal(row: StudyRow, key: string): Cell | null {
  const hit = Object.keys(row.characteristics).find((k) => k.toLowerCase() === key);
  return hit ? row.characteristics[hit] : null;
}

/** Render one cell's value with a CV tooltip / reserved-word styling. */
function CvCell({ cell }: { cell: Cell | null }) {
  const cv = useCvTerms();
  if (!cell) return <>—</>;
  if (cell.reserved) {
    return <span className="chip" title="SDRF reserved value" style={{ opacity: 0.6 }}>{cell.reserved}</span>;
  }
  const text = cell.value ?? "—";
  if (!cell.cv) return <>{text}</>;
  const def = cvTitle(cv, cell.cv.id);
  if (def) return <span title={def} style={{ cursor: "help" }}>{text}</span>;
  // Accession not in the bundled CV map (NCBITaxon/EFO/Unimod/…): link out to OLS
  // so the term stays resolvable rather than showing a dead tooltip (spec §8.1).
  return (
    <a
      href={olsUrl(cell.cv)} target="_blank" rel="noopener noreferrer" title={`${cell.cv.id} · look up in OLS`}
      style={{ color: "inherit", textDecoration: "none", borderBottom: "1px dotted var(--text-muted)" }}
    >{text}</a>
  );
}

/** Deferred long-tail: the full characteristics × sample matrix, behind an expander. */
function AllCharacteristics({ rows }: { rows: StudyRow[] }) {
  const charKeys = [...new Set(rows.flatMap((r) => Object.keys(r.characteristics)))];
  const factorKeys = [...new Set(rows.flatMap((r) => Object.keys(r.factors)))];
  if (charKeys.length === 0 && factorKeys.length === 0) return null;
  return (
    <details style={{ marginTop: "0.5rem" }}>
      <summary className="hint" style={{ cursor: "pointer" }}>
        All characteristics &amp; factors ({charKeys.length + factorKeys.length} columns × {rows.length} rows)
      </summary>
      <div style={{ overflowX: "auto", marginTop: "0.3rem" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Sample</th>
              {charKeys.map((k) => <th key={k}>{k}</th>)}
              {factorKeys.map((k) => <th key={`f:${k}`}>factor: {k}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.sourceName}:${r.label ?? ""}:${i}`}>
                <td>{r.sourceName}{r.label ? <span className="hint"> · {r.label}</span> : null}</td>
                {charKeys.map((k) => <td key={k}><CvCell cell={r.characteristics[k] ?? null} /></td>)}
                {factorKeys.map((k) => <td key={`f:${k}`}><CvCell cell={r.factors[k] ?? null} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function RoleBadge({ role }: { role: ChannelRole }) {
  if (role === "experimental" || role === "unknown") return <>{ROLE_LABEL[role]}</>;
  return (
    <span className="chip" style={{ background: "var(--accent-soft)", color: "var(--accent-active)" }}>
      {ROLE_LABEL[role]}
    </span>
  );
}

function ChannelTable({ rows }: { rows: StudyRow[] }) {
  const cv = useCvTerms();
  // Group by data file (the run).
  const files = [...new Set(rows.map((r) => r.dataFile ?? ""))];
  return (
    <>
      {files.map((file) => {
        const group = rows
          .filter((r) => (r.dataFile ?? "") === file)
          .sort((a, b) => (a.reporterMz ?? 0) - (b.reporterMz ?? 0));
        return (
          <div key={file || "—"} style={{ marginBottom: "0.6rem" }}>
            {files.length > 1 && (
              <div className="hint mono" style={{ margin: "0.3rem 0 0.15rem" }}>{file || "(no data file)"}</div>
            )}
            <table className="data">
              <thead>
                <tr>
                  <th>Channel</th><th>Reporter m/z</th><th>Sample</th>
                  <th>Organism</th><th>Disease</th><th>Cell type</th><th>Role</th><th>Tag</th>
                </tr>
              </thead>
              <tbody>
                {group.map((r, i) => (
                  <tr key={`${r.label}:${r.sourceName}:${i}`}>
                    <td className="mono" title={r.tag ? undefined : undefined}>{r.label ?? "—"}</td>
                    <td title={r.reporterMz == null ? "reporter m/z unresolved" : undefined}>
                      {r.reporterMz == null ? "—" : r.reporterMz.toFixed(3)}
                    </td>
                    <td>
                      {r.sourceName}
                      {r.poolMembers.length > 0 && (
                        <span className="hint"> (pool: {r.poolMembers.join(", ")})</span>
                      )}
                    </td>
                    <td><CvCell cell={charVal(r, "organism")} /></td>
                    <td><CvCell cell={charVal(r, "disease")} /></td>
                    <td><CvCell cell={charVal(r, "cell type")} /></td>
                    <td><RoleBadge role={r.role} /></td>
                    <td className="mono" title={r.tag ? cvTitle(cv, r.tag.id) ?? r.tag.id : undefined}>
                      {r.tag?.label ?? r.tag?.id ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

function SampleTable({ rows }: { rows: StudyRow[] }) {
  return (
    <table className="data">
      <thead>
        <tr><th>Sample</th><th>Organism</th><th>Tissue</th><th>Disease</th><th>Cell type</th><th>Data file</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.sourceName}:${i}`}>
            <td>{r.sourceName}</td>
            <td><CvCell cell={charVal(r, "organism")} /></td>
            <td><CvCell cell={charVal(r, "organism part")} /></td>
            <td><CvCell cell={charVal(r, "disease")} /></td>
            <td><CvCell cell={charVal(r, "cell type")} /></td>
            <td className="mono">{r.dataFile ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Role badge for the producer's channel-role vocabulary (sample | pooled |
 *  reference | carrier | normalization | empty). Non-"sample" roles are emphasised. */
function ProjRoleBadge({ role }: { role: string | null }) {
  const r = (role ?? "").toLowerCase();
  if (!r || r === "sample" || r === "experimental") return <>{role ?? "—"}</>;
  return (
    <span className="chip" style={{ background: "var(--accent-soft)", color: "var(--accent-active)" }}>
      {role}
    </span>
  );
}

/** The dedicated, run-scoped Channel Assignments view — read from the ENCODED
 *  projection (sample_list ⋈ run_sample_binding), the authoritative per-run map. */
function ChannelAssignments({ channels, runId }: { channels: ChannelAssignment[]; runId: string | null }) {
  const cv = useCvTerms();
  const bound = channels
    .filter((c) => c.boundToThisRun)
    .sort((a, b) => (a.reporterMz ?? 0) - (b.reporterMz ?? 0));
  if (bound.length === 0) {
    return <p className="hint">No isobaric channels are bound to this run.</p>;
  }
  return (
    <>
      <h4 className="stage-h" style={{ marginTop: "0.6rem" }}>
        Channel assignments
        <span className="stage-meta">
          {bound.length} channel{bound.length === 1 ? "" : "s"}
          {runId ? ` · run ${runId}` : ""}
        </span>
      </h4>
      <table className="data">
        <thead>
          <tr><th>Channel</th><th>Reporter m/z</th><th>Sample</th><th>Role</th><th>Tag</th></tr>
        </thead>
        <tbody>
          {bound.map((c, i) => (
            <tr key={`${c.channelLabel ?? ""}:${c.sampleId ?? ""}:${i}`}>
              <td className="mono">{c.channelLabel ?? "—"}</td>
              <td title={c.reporterMz == null ? "reporter m/z unresolved" : undefined}>
                {c.reporterMz == null ? "—" : c.reporterMz.toFixed(4)}
              </td>
              <td>
                {c.sampleName ?? "—"}
                {c.sampleId && <span className="hint"> ({c.sampleId})</span>}
              </td>
              <td><ProjRoleBadge role={c.role} /></td>
              <td className="mono" title={c.tag ? cvTitle(cv, c.tag.id) ?? c.tag.id : undefined}>
                {c.tag?.label ?? c.tag?.id ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="stage-hint" style={{ marginTop: "0.25rem" }}>
        Read from the file's encoded index (<code>run_sample_binding</code> ⋈ <code>sample_list</code>) —
        the authoritative per-run mapping. The full study table lives in the embedded SDRF
        (View raw below, or download it from the Structure tab).
      </p>
    </>
  );
}

const HASH_BADGE: Record<string, { text: string; color: string }> = {
  verified: { text: "sha256 ✓ verified", color: "var(--accent-active)" },
  declared: { text: "sha256 declared (unverified)", color: "var(--text-muted)" },
  mismatch: { text: "sha256 ⚠ MISMATCH", color: "#b00" },
  none: { text: "", color: "var(--text-muted)" },
};

export function StudySection() {
  const study = useStore((s) => s.studyMeta);
  const getStudyBlob = useStore((s) => s.getStudyBlob);
  const [raw, setRaw] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);

  if (!study) return null;

  const { investigation: inv, labeling, counts, biology, factors, provenance, rows } = study;
  const isProjection = study.source === "projection";
  const matched = rows.filter((r) => r.matchesThisFile);
  const display = matched.length > 0 ? matched : rows;
  const isobaric = labeling.kind === "isobaric";
  const accUrl = accessionUrl(inv.accession);
  const plexLabel =
    labeling.kind === "isobaric"
      ? `${labeling.reagent ?? "isobaric"}${labeling.plex ? ` ${labeling.plex}-plex` : ""}`
      : labeling.kind === "silac" ? "SILAC"
      : labeling.kind === "label-free" ? "Label-free"
      : "Labeling: unclassified";

  async function toggleRaw() {
    if (!rawOpen && raw == null) setRaw((await getStudyBlob()) ?? "(could not read the embedded document)");
    setRawOpen((o) => !o);
  }

  const hash = HASH_BADGE[provenance.hashState] ?? HASH_BADGE.none;

  return (
    <>
      <h3 className="section">Study &amp; samples</h3>

      {/* Banner */}
      <div className="chips" style={{ marginBottom: "0.4rem" }}>
        {inv.accession && (
          <span className="chip">
            {accUrl ? <a href={accUrl} target="_blank" rel="noopener noreferrer">{inv.accession}</a> : inv.accession}
          </span>
        )}
        <span className="chip">{FORMAT_LABEL[study.format]}</span>
        <span className="chip">{plexLabel}</span>
        {isobaric && (
          <span className="chip">
            {counts.channels} channel{counts.channels === 1 ? "" : "s"}{isProjection ? " · this run" : ""}
          </span>
        )}
        <span className="chip">{counts.sourceSamples} samples{isProjection ? " · study" : ""}</span>
        {!isProjection && <span className="chip">{counts.dataFiles} files</span>}
      </div>
      {inv.title && inv.title !== inv.accession && (
        <p style={{ margin: "0 0 0.5rem", fontWeight: "var(--weight-medium)" }}>{inv.title}</p>
      )}

      {/* Factors — the experimental design (blob path; not projected in v0.8) */}
      {factors.length > 0 && (
        <div style={{ marginBottom: "0.5rem" }}>
          <span className="hint">Factors: </span>
          <span className="chips" style={{ display: "inline-flex" }}>
            {factors.map((f) => (
              <span key={f.name} className="chip" title={f.levels.join(", ")}>
                {f.name}{f.levels.length ? ` (${f.levels.length})` : ""}
              </span>
            ))}
          </span>
        </div>
      )}

      {/* Biology summary (blob path) */}
      {(biology.organisms.length || biology.diseases.length || biology.tissues.length) > 0 && (
        <table className="data" style={{ maxWidth: 560, marginBottom: "0.5rem" }}>
          <tbody>
            {biology.organisms.length > 0 && (<tr><th style={{ width: 160 }}>Organism(s)</th><td>{biology.organisms.join(", ")}</td></tr>)}
            {biology.tissues.length > 0 && (<tr><th>Tissue</th><td>{biology.tissues.join(", ")}</td></tr>)}
            {biology.diseases.length > 0 && (<tr><th>Disease(s)</th><td>{biology.diseases.join(", ")}</td></tr>)}
            {biology.cellTypes.length > 0 && (<tr><th>Cell type(s)</th><td>{biology.cellTypes.join(", ")}</td></tr>)}
          </tbody>
        </table>
      )}

      {/* Channel / sample assignment */}
      {isProjection ? (
        isobaric ? (
          <ChannelAssignments channels={study.channels} runId={study.runId} />
        ) : (
          <p className="hint">
            Label-free study — no isobaric channels. The sample list and full study
            metadata are in the embedded document (View raw below).
          </p>
        )
      ) : (
        <>
          {display.length > 0 && (isobaric ? <ChannelTable rows={display} /> : <SampleTable rows={display} />)}
          {display.length > 0 && <AllCharacteristics rows={display} />}
        </>
      )}

      {/* Provenance + raw access */}
      <p className="hint" style={{ marginTop: "0.5rem" }}>
        Source: {FORMAT_LABEL[study.format]}
        {isProjection ? " · index projection (run-scoped)" : " · embedded blob (parsed)"}
        {provenance.embedScope ? ` · ${provenance.embedScope}` : ""}
        {provenance.retrievedAt ? ` · ${provenance.retrievedAt}` : ""}
        {hash.text ? <> · <span style={{ color: hash.color }}>{hash.text}</span></> : null}
        {provenance.member && (
          <> · <button
            onClick={() => void toggleRaw()}
            style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}
          >{rawOpen ? "Hide raw" : "View raw"}</button></>
        )}
      </p>
      {rawOpen && raw != null && (
        <pre style={{
          maxHeight: 280, overflow: "auto", fontSize: "var(--text-xs)",
          background: "var(--surface-panel)", border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-sm)", padding: "0.6rem",
        }}>{raw}</pre>
      )}

      {study.diagnostics.length > 0 && (
        <ul className="hint" style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
          {study.diagnostics.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
    </>
  );
}
