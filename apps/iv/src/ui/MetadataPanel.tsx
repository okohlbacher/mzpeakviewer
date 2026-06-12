import { useStore } from "../state/store";
import { Panel } from "./ds";

function MetaGroup({ title, value }: { title: string; value: unknown }) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && Object.keys(value as object).length === 0);
  return (
    <details open={!isEmpty} style={{ marginBottom: "var(--space-3)" }}>
      <summary
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--text-body)",
          cursor: "pointer",
        }}
      >
        <strong>{title}</strong>
        {isEmpty ? <span style={{ color: "var(--text-faint)" }}> (none)</span> : ""}
      </summary>
      {!isEmpty && (
        <pre
          className="mz-scroll"
          style={{
            maxHeight: 200,
            overflow: "auto",
            background: "var(--surface-sunken)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-4)",
            fontSize: "var(--text-2xs)",
            fontFamily: "var(--font-mono)",
            margin: "var(--space-2) 0 0",
          }}
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </details>
  );
}

/**
 * Inspector panels for the parsed manifest entity list (FMT-01) and the five
 * file-level metadata groups (FMT-02). Reskinned to Panel; manifest rendered as
 * a compact token-styled table. The file-stats line keeps the lowercase word
 * "spectra" the e2e asserts.
 */
export function MetadataPanel() {
  const fileMeta = useStore((s) => s.fileMeta);
  const manifest = useStore((s) => s.manifest);
  const stats = useStore((s) => s.stats);

  return (
    <>
      <Panel title="Manifest" count={manifest.length || null}>
        {stats && (
          <p
            data-testid="file-stats"
            className="mz-numeric"
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
              margin: "0 0 var(--space-3)",
            }}
          >
            {stats.numSpectra.toLocaleString()} spectra · {stats.numEntities} entities
          </p>
        )}
        <table
          data-testid="manifest-table"
          style={{
            width: "100%",
            fontSize: "var(--text-xs)",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-faint)" }}>
              <th style={{ fontWeight: 600, paddingBottom: "var(--space-2)" }}>name</th>
              <th style={{ fontWeight: 600, paddingBottom: "var(--space-2)" }}>entity</th>
              <th style={{ fontWeight: 600, paddingBottom: "var(--space-2)" }}>kind</th>
            </tr>
          </thead>
          <tbody>
            {manifest.map((e) => (
              <tr key={e.name} data-testid="manifest-row">
                <td style={{ fontFamily: "var(--font-mono)", paddingRight: "var(--space-3)" }}>
                  {e.name}
                </td>
                <td style={{ color: "var(--text-muted)", paddingRight: "var(--space-3)" }}>
                  {e.entityType}
                </td>
                <td style={{ color: "var(--text-muted)" }}>{e.dataKind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {fileMeta && (
        <Panel title="Metadata">
          <div data-testid="file-metadata">
            <MetaGroup title="File description" value={fileMeta.fileDescription} />
            <MetaGroup
              title="Instrument configurations"
              value={fileMeta.instrumentConfigurations}
            />
            <MetaGroup title="Software" value={fileMeta.software} />
            <MetaGroup title="Run" value={fileMeta.run} />
            <MetaGroup title="Samples" value={fileMeta.samples} />
          </div>
        </Panel>
      )}
    </>
  );
}
