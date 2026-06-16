// Chromatograms view — the file's STORED chromatograms (with full metadata: type,
// polarity, SRM/MRM precursor→product, CV params) + a computed TIC fallback.
//   • Stored list: one row per chromatogram in chromatograms_metadata; click → load its
//     trace + show a CV-resolved metadata tree (the comprehensive view).
//   • Build TIC: the per-spectrum total-ion chromatogram computed from the RT index.
import { useEffect, useState } from "react";
import { useStore, seriesToPoints } from "../store";
import { engine } from "../engine";
import { ChromPlot, Button, TreeView, useCvTerms, cvName } from "@mzpeak/ui-kit";
import type { ChromatogramInfo } from "@mzpeak/contracts";

export function Chromatograms() {
  const phase = useStore((s) => s.phase);
  const chrom = useStore((s) => s.chrom);
  const chromLoading = useStore((s) => s.chromLoading);
  const loadChrom = useStore((s) => s.loadChrom);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const browse = useStore((s) => s.browse);
  const selector = useStore((s) => s.selector);
  const cv = useCvTerms();

  // The file's stored chromatograms (fetched once when the file is ready).
  const [list, setList] = useState<ChromatogramInfo[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "ready") {
      setList(null);
      setSelectedId(null);
      return;
    }
    let live = true;
    engine
      .chromatogramList()
      .then((cs) => { if (live) setList(cs); })
      .catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [phase]);

  if (phase !== "ready") {
    return (
      <p data-testid="chrom-empty" style={{ color: "var(--text-muted)", padding: "1rem 0" }}>
        Open a file to view chromatograms.
      </p>
    );
  }

  const points = chrom ? seriesToPoints(chrom) : [];
  const selected = list?.find((c) => c.id === selectedId) ?? null;

  // Navigate to the spectrum nearest a clicked retention time (TIC only).
  function handlePick(time: number) {
    if (!browse) return;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < browse.rt.length; i++) {
      const rt = browse.rt[i] as number;
      if (!Number.isFinite(rt)) continue;
      const d = Math.abs(rt - time);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    void selectSpectrum(bestIdx);
  }

  let selectedTime: number | null = null;
  if (selector && browse) {
    const rt = browse.rt[selector.index] as number | undefined;
    selectedTime = rt != null && Number.isFinite(rt) ? rt : null;
  }

  function pickStored(c: ChromatogramInfo) {
    setSelectedId(c.id);
    void loadChrom({ mode: "stored", id: c.id });
  }

  const fmtMz = (m: number | null) => (m == null ? "—" : m.toFixed(4));
  const typeLabel = (acc: string | null) =>
    acc ? (cvName(cv, acc) ?? acc) : "—";

  return (
    <div data-testid="chromatograms-view" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Computed TIC */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <Button variant="secondary" size="sm" onClick={() => { setSelectedId(null); void loadChrom({ mode: "tic" }); }} disabled={chromLoading} data-testid="tic-btn">
          {chromLoading ? "Computing…" : "Build TIC"}
        </Button>
        {chrom && (
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            {chrom.kind === "stored" ? `stored: ${chrom.id ?? ""}` : "TIC"} · {chrom.time.length} points
          </span>
        )}
      </div>

      {/* Stored chromatograms list */}
      {list && list.length > 0 && (
        <div data-testid="chrom-stored-list">
          <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.35rem" }}>
            Stored chromatograms <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({list.length})</span>
          </h3>
          <table style={{ borderCollapse: "collapse", fontSize: "var(--text-sm, 0.82rem)", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", borderBottom: "1px solid var(--border-hairline, #eee)" }}>
                <th style={{ padding: "0.2rem 0.6rem 0.2rem 0", fontWeight: 500 }}>id</th>
                <th style={{ padding: "0.2rem 0.6rem", fontWeight: 500 }}>type</th>
                <th style={{ padding: "0.2rem 0.6rem", fontWeight: 500 }}>pol.</th>
                <th style={{ padding: "0.2rem 0.6rem", fontWeight: 500, textAlign: "right" }}>precursor m/z</th>
                <th style={{ padding: "0.2rem 0.6rem", fontWeight: 500, textAlign: "right" }}>product m/z</th>
                <th style={{ padding: "0.2rem 0 0.2rem 0.6rem", fontWeight: 500, textAlign: "right" }}>points</th>
              </tr>
            </thead>
            <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
              {list.map((c) => (
                <tr
                  key={c.id}
                  data-testid={`chrom-row-${c.index}`}
                  onClick={() => pickStored(c)}
                  style={{
                    cursor: "pointer",
                    borderTop: "1px solid var(--border-hairline, #f0f0f0)",
                    background: selectedId === c.id ? "var(--surface-panel, #f1f5f9)" : undefined,
                  }}
                >
                  <td style={{ padding: "0.25rem 0.6rem 0.25rem 0", color: "var(--text-link, #2563eb)", wordBreak: "break-all" }}>{c.id}</td>
                  <td style={{ padding: "0.25rem 0.6rem", fontFamily: "var(--font-sans)" }}>{typeLabel(c.typeAccession)}</td>
                  <td style={{ padding: "0.25rem 0.6rem" }}>{c.polarity ?? "—"}</td>
                  <td style={{ padding: "0.25rem 0.6rem", textAlign: "right" }}>{fmtMz(c.precursorMz)}</td>
                  <td style={{ padding: "0.25rem 0.6rem", textAlign: "right" }}>{fmtMz(c.productMz)}</td>
                  <td style={{ padding: "0.25rem 0 0.25rem 0.6rem", textAlign: "right" }}>{c.nPoints ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list && list.length === 0 && (
        <p data-testid="chrom-no-stored" style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: 0 }}>
          This file has no stored chromatograms. Build the TIC from the per-spectrum retention-time index.
        </p>
      )}

      {chromLoading && (
        <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Computing chromatogram…</div>
      )}

      {/* Plot of whatever chromatogram is loaded */}
      {chrom && points.length > 0 && (
        <>
          <div data-testid="chrom-plot-host">
            <ChromPlot points={points} onPick={chrom.kind === "stored" ? () => {} : handlePick} selectedTime={chrom.kind === "stored" ? null : selectedTime} />
          </div>
          <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            {chrom.kind === "stored"
              ? "Stored chromatogram · scroll to zoom · double-click to reset"
              : "Click a point to select the nearest spectrum · scroll to zoom · double-click to reset"}
          </p>
        </>
      )}

      {/* Full per-chromatogram metadata (CV-resolved) for the selected stored chromatogram */}
      {selected && (
        <details data-testid="chrom-metadata-panel" open style={{ marginTop: "0.1rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "var(--text-sm)", color: "var(--text-muted)", userSelect: "none" }}>
            Chromatogram metadata — {selected.id}
          </summary>
          <div style={{ marginTop: "0.5rem", maxWidth: 820 }}>
            <TreeView label="chromatogram" value={selected.meta} defaultOpen={3} />
          </div>
        </details>
      )}
    </div>
  );
}
