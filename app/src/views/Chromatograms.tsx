// Chromatograms view — the file's STORED chromatograms (with full metadata: type,
// polarity, SRM/MRM precursor→product, CV params) + a computed TIC fallback.
//   • Stored list: one row per chromatogram in chromatograms_metadata; click → load its
//     trace + show a CV-resolved metadata tree (the comprehensive view).
//   • Build TIC: the per-spectrum total-ion chromatogram computed from the RT index.
import { useEffect, useState, type CSSProperties } from "react";
import { useStore, seriesToPoints } from "../store";
import { engine } from "../engine";
import { ChromPlot, MultiChromPlot, Button, TreeView, useCvTerms, cvName, type ChromTrace } from "@mzpeak/ui-kit";
import type { ChromatogramInfo } from "@mzpeak/contracts";

// Categorical palette for the overlaid DIA fragment traces.
const DIA_PALETTE = ["#3b54da", "#c00000", "#2e9e5b", "#e8820c", "#8a3ffc", "#0e9bb5", "#d6336c", "#7cb518"];

// Shared style for the XIC numeric inputs (width in rem to fit m/z vs. tolerance).
const xicInputStyle = (widthRem: number): CSSProperties => ({
  width: `${widthRem}rem`,
  padding: "0.3rem 0.4rem",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-sm)",
  background: "var(--surface-input)",
  color: "var(--text-heading)",
});

export function Chromatograms() {
  const phase = useStore((s) => s.phase);
  const chrom = useStore((s) => s.chrom);
  const chromReq = useStore((s) => s.chromReq);
  const chromLoading = useStore((s) => s.chromLoading);
  const loadChrom = useStore((s) => s.loadChrom);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const browse = useStore((s) => s.browse);
  const selector = useStore((s) => s.selector);
  const cv = useCvTerms();

  // The file's stored chromatograms (fetched once when the file is ready).
  const [list, setList] = useState<ChromatogramInfo[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // XIC (extracted-ion chromatogram) inputs: m/z center + half-window in Da.
  const [xicMz, setXicMz] = useState("");
  const [xicTol, setXicTol] = useState("0.01");

  // DIA fragment extractor (Stage A): a precursor m/z (selects the isolation window) + a
  // list of fragment m/z transitions → one MS2 window-filtered XIC per transition,
  // overlaid. No peptide→m/z chemistry yet (the user enters m/z directly).
  const [diaPrecursor, setDiaPrecursor] = useState("");
  const [diaFragments, setDiaFragments] = useState("");
  const [diaTol, setDiaTol] = useState("0.02");
  const [diaRtCenter, setDiaRtCenter] = useState("");
  const [diaTraces, setDiaTraces] = useState<ChromTrace[] | null>(null);
  const [diaBusy, setDiaBusy] = useState(false);
  const [diaNote, setDiaNote] = useState<string | null>(null);

  // Keep the controls + stored-row highlight in sync with the loaded request (chromReq):
  //  - xic   → prefill the m/z + tol inputs (so a ?xic= deep link mirrors the trace);
  //  - stored→ highlight the row + open its metadata panel (so a ?chrom=<id> deep link
  //            isn't left with a blank selection — the row click sets this too);
  //  - null  → new file: clear the inputs back to defaults (no stale m/z from file A).
  // A tic load leaves the typed m/z untouched (so "type m/z, click Build TIC to compare"
  // doesn't wipe the user's input). selectedId clears for tic/xic.
  useEffect(() => {
    if (chromReq?.mode === "xic") {
      setXicMz(String(chromReq.mz));
      setXicTol(String(chromReq.tolDa));
    } else if (chromReq == null) {
      setXicMz("");
      setXicTol("0.01");
    }
    setSelectedId(chromReq?.mode === "stored" ? chromReq.id : null);
  }, [chromReq]);

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

  // XIC extraction: m/z center ± tolerance (Da). Both must be finite and positive.
  const xicMzNum = Number(xicMz);
  const xicTolNum = Number(xicTol);
  const xicValid =
    xicMz.trim() !== "" && Number.isFinite(xicMzNum) && xicMzNum > 0 && Number.isFinite(xicTolNum) && xicTolNum > 0;
  function extractXic() {
    if (!xicValid) return;
    setSelectedId(null); // an XIC is not one of the stored chromatograms
    void loadChrom({ mode: "xic", mz: xicMzNum, tolDa: xicTolNum });
  }

  // DIA: parse the fragment list (any of comma / whitespace / newline separated), keep
  // finite positives. The precursor m/z selects the isolation window; each fragment is a
  // transition extracted over that window's MS2 spectra.
  const diaPrecursorNum = Number(diaPrecursor);
  const diaTolNum = Number(diaTol);
  const diaFragmentMzs = diaFragments
    .split(/[\s,;]+/)
    .map((s) => Number(s))
    .filter((v) => Number.isFinite(v) && v > 0);
  const diaValid =
    Number.isFinite(diaPrecursorNum) && diaPrecursorNum > 0 &&
    Number.isFinite(diaTolNum) && diaTolNum > 0 &&
    diaFragmentMzs.length > 0;

  async function extractDia() {
    if (!diaValid || diaBusy) return;
    setDiaBusy(true);
    setDiaNote(null);
    // Optional RT focus: center ± 60 s narrows the read (faster) and frames the peak.
    const c = Number(diaRtCenter);
    const rt: [number, number] | undefined =
      diaRtCenter.trim() !== "" && Number.isFinite(c) ? [c - 60, c + 60] : undefined;
    try {
      const series = await Promise.all(
        diaFragmentMzs.map((mz) =>
          engine.extractChrom({ mode: "diaXic", precursorMz: diaPrecursorNum, mz, tolDa: diaTolNum, ...(rt ? { rt } : {}) }),
        ),
      );
      const traces: ChromTrace[] = series.map((s, i) => ({
        label: `m/z ${diaFragmentMzs[i]!.toFixed(3)}`,
        color: DIA_PALETTE[i % DIA_PALETTE.length]!,
        points: seriesToPoints(s),
      }));
      setDiaTraces(traces);
      if (traces.every((t) => t.points.length === 0)) {
        setDiaNote(
          `No MS2 isolation window contains m/z ${diaPrecursorNum.toFixed(4)} — check the precursor m/z, or this file may not be DIA.`,
        );
      }
    } catch (err) {
      setDiaNote(err instanceof Error ? err.message : String(err));
      setDiaTraces(null);
    } finally {
      setDiaBusy(false);
    }
  }

  // Label for the loaded trace. The series carries only kind/id, so the XIC m/z window
  // comes from the retained request (chromReq).
  const chromLabel = !chrom
    ? ""
    : chrom.kind === "stored"
      ? `stored: ${chrom.id ?? ""}`
      : chrom.kind === "xic"
        ? chromReq?.mode === "xic"
          ? `XIC m/z ${chromReq.mz.toFixed(4)} ± ${chromReq.tolDa} Da`
          : "XIC"
        : "TIC";

  const fmtMz = (m: number | null) => (m == null ? "—" : m.toFixed(4));
  const typeLabel = (acc: string | null) =>
    acc ? (cvName(cv, acc) ?? acc) : "—";

  return (
    <div data-testid="chromatograms-view" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Computed TIC + extracted-ion chromatogram (XIC) */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="secondary" size="sm" onClick={() => { setSelectedId(null); void loadChrom({ mode: "tic" }); }} disabled={chromLoading} data-testid="tic-btn">
          {chromLoading ? "Computing…" : "Build TIC"}
        </Button>

        {/* XIC extractor: sum intensity over m/z ± tol across the run's spectra. */}
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
          title="Extracted-ion chromatogram: intensity summed over m/z ± tolerance across every spectrum, plotted against retention time."
        >
          <label htmlFor="xic-mz-input" style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>XIC m/z</label>
          <input
            id="xic-mz-input"
            data-testid="xic-mz-input"
            type="number"
            step="any"
            placeholder="445.12"
            value={xicMz}
            onChange={(e) => setXicMz(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") extractXic(); }}
            style={xicInputStyle(7)}
          />
          <span style={{ color: "var(--text-muted)" }}>±</span>
          <input
            data-testid="xic-tol-input"
            type="number"
            step="any"
            aria-label="XIC m/z tolerance in daltons"
            value={xicTol}
            onChange={(e) => setXicTol(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") extractXic(); }}
            style={xicInputStyle(4.5)}
          />
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Da</span>
          <Button variant="secondary" size="sm" onClick={extractXic} disabled={!xicValid || chromLoading} data-testid="xic-btn">
            Extract XIC
          </Button>
        </span>

        {chrom && (
          <span data-testid="chrom-loaded-label" style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            {chromLabel} · {chrom.time.length} points
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

      {/* ── DIA fragment extractor (Stage A) ───────────────────────────────────────
          Enter a precursor m/z (picks the DIA isolation window) + a list of fragment
          m/z transitions → one MS2 window-filtered XIC per fragment, overlaid. */}
      <details data-testid="dia-extractor" style={{ marginTop: "0.4rem", borderTop: "1px solid var(--border-hairline, #eee)", paddingTop: "0.6rem" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.9rem", fontWeight: 600, userSelect: "none" }}>
          DIA fragment extractor
        </summary>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: "0.4rem 0" }}>
          Enter a precursor m/z (selects the DIA isolation window) and one or more fragment
          m/z values; each is extracted over that window&apos;s MS2 spectra and overlaid by
          retention time. Fragment m/z are entered directly here — peptide→fragment
          calculation is a later stage.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            Precursor m/z
            <input data-testid="dia-precursor-input" type="number" step="any" placeholder="620.83" value={diaPrecursor}
              onChange={(e) => setDiaPrecursor(e.target.value)} style={xicInputStyle(7)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "var(--text-sm)", color: "var(--text-muted)", flex: "1 1 16rem", minWidth: "12rem" }}>
            Fragment m/z (comma / space separated)
            <input data-testid="dia-fragments-input" type="text" placeholder="545.30, 802.45, 917.48" value={diaFragments}
              onChange={(e) => setDiaFragments(e.target.value)}
              style={{ ...xicInputStyle(7), width: "100%", fontFamily: "var(--font-mono)" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            ± Da
            <input data-testid="dia-tol-input" type="number" step="any" value={diaTol}
              onChange={(e) => setDiaTol(e.target.value)} style={xicInputStyle(4.5)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            RT center (s, optional)
            <input data-testid="dia-rt-input" type="number" step="any" placeholder="full run" value={diaRtCenter}
              onChange={(e) => setDiaRtCenter(e.target.value)} style={xicInputStyle(6)} />
          </label>
          <Button variant="secondary" size="sm" onClick={() => void extractDia()} disabled={!diaValid || diaBusy} data-testid="dia-extract-btn">
            {diaBusy ? "Extracting…" : "Extract fragments"}
          </Button>
        </div>
        {diaNote && (
          <p data-testid="dia-note" style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0.25rem 0" }}>{diaNote}</p>
        )}
        {diaTraces && diaTraces.some((t) => t.points.length > 0) && (
          <div data-testid="dia-plot-host">
            <MultiChromPlot traces={diaTraces} />
            <p style={{ margin: "0.25rem 0 0", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              {diaTraces.length} transition{diaTraces.length === 1 ? "" : "s"} · scroll to zoom · double-click to reset
            </p>
          </div>
        )}
      </details>
    </div>
  );
}
