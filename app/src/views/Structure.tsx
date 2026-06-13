// Structure view — the parquet/archive inspector. Lists ZIP members; clicking a
// parquet member shows its footer (row count + per-column type/codec/stats) via the
// engine worker. The Structure/Parquet spike, surfaced.
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { engine } from "../engine";
import type { ArchiveMemberList, ParquetFooter } from "@mzpeak/contracts";

type Member = ArchiveMemberList["members"][number];

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The mzpeak manifest — always pinned to the top of the member list. */
function isManifest(path: string): boolean {
  return path.split("/").pop()?.toLowerCase() === "mzpeak_index.json";
}

/** Manifest first (it's the archive's table of contents), then the original order
 *  preserved (stable). */
function orderMembers(members: Member[]): Member[] {
  return members
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const ra = isManifest(a.m.path) ? 0 : 1;
      const rb = isManifest(b.m.path) ? 0 : 1;
      return ra - rb || a.i - b.i;
    })
    .map((x) => x.m);
}

export function Structure() {
  const phase = useStore((s) => s.phase);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [footer, setFooter] = useState<ParquetFooter | null>(null);
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
    try {
      setFooter(await engine.parquetFooter(m.path));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div data-testid="structure-view" style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>
      <div style={{ minWidth: 280 }}>
        <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Archive members</h2>
        {error && <p data-testid="structure-error" style={{ color: "var(--danger, #c00)" }}>{error}</p>}
        <ul data-testid="structure-members" style={{ listStyle: "none", margin: 0, padding: 0, fontFamily: "var(--font-mono, monospace)", fontSize: "var(--text-sm, 0.85rem)" }}>
          {orderMembers(members).map((m) => {
            const manifest = isManifest(m.path);
            return (
              <li key={m.path}>
                <button
                  onClick={() => void pick(m)}
                  disabled={!m.isParquet}
                  title={m.kind ?? undefined}
                  data-testid={manifest ? "structure-manifest" : undefined}
                  style={{
                    display: "flex", width: "100%", justifyContent: "space-between", gap: "0.75rem", alignItems: "center",
                    padding: "0.25rem 0.4rem", border: "none", borderRadius: "var(--radius-sm, 4px)",
                    background: selected === m.path
                      ? "var(--surface-panel, #f1f5f9)"
                      : manifest ? "var(--accent-subtle, #f2f4fe)" : "transparent",
                    color: m.isParquet ? "var(--text-link, #2563eb)" : "var(--text-body, #353c43)",
                    cursor: m.isParquet ? "pointer" : "default", textAlign: "left",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    {manifest && (
                      <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.62rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--accent, #3b54da)", background: "var(--gray-0, #fff)", border: "1px solid var(--accent, #3b54da)", borderRadius: 3, padding: "0 0.3rem", flexShrink: 0 }}>
                        manifest
                      </span>
                    )}
                    {m.path}
                  </span>
                  <span style={{ color: "var(--text-muted, #94a3b8)", flexShrink: 0 }}>{fmtBytes(m.bytes)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {footer ? (
          <div data-testid="structure-footer">
            <h2 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>
              {selected} · {footer.numRows.toLocaleString()} rows · {footer.numRowGroups} row group(s)
              {footer.createdBy ? ` · ${footer.createdBy}` : ""}
            </h2>
            <table style={{ borderCollapse: "collapse", fontSize: "var(--text-sm, 0.85rem)", width: "100%" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-muted, #94a3b8)" }}>
                  <th style={{ padding: "0.2rem 0.6rem 0.2rem 0" }}>column</th>
                  <th style={{ padding: "0.2rem 0.6rem" }}>type</th>
                  <th style={{ padding: "0.2rem 0.6rem" }}>codec</th>
                  <th style={{ padding: "0.2rem 0.6rem" }}>values</th>
                  <th style={{ padding: "0.2rem 0.6rem" }}>min</th>
                  <th style={{ padding: "0.2rem 0.6rem" }}>max</th>
                </tr>
              </thead>
              <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
                {footer.columns.map((c) => (
                  <tr key={c.name} style={{ borderTop: "1px solid var(--border-hairline, #eee)" }}>
                    <td style={{ padding: "0.2rem 0.6rem 0.2rem 0" }}>{c.name}</td>
                    <td style={{ padding: "0.2rem 0.6rem" }}>{c.logicalType ?? c.type}</td>
                    <td style={{ padding: "0.2rem 0.6rem" }}>{c.codec ?? "—"}</td>
                    <td style={{ padding: "0.2rem 0.6rem" }}>{c.numValues ?? "—"}</td>
                    <td style={{ padding: "0.2rem 0.6rem" }}>{c.min ?? "—"}</td>
                    <td style={{ padding: "0.2rem 0.6rem" }}>{c.max ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: "var(--text-muted, #94a3b8)" }}>Select a parquet member to inspect its columns.</p>
        )}
      </div>
    </div>
  );
}
