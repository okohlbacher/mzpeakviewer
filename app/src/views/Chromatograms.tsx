// Chromatograms view — a managed LIST of chromatograms:
//   • the file's STORED chromatograms (browse table; "+ Add" puts one on a plot, click a
//     row to inspect its CV-resolved metadata),
//   • user-GENERATED (in-memory) TIC / XIC traces via "+ add TIC" / "+ add XIC".
// Each is a card with independent zoom (wheel / double-click reset) + drag-resize. The DIA
// fragment extractor (separate, overlaid) stays at the bottom.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useStore, seriesToPoints, CHROM_MIN_H, CHROM_MAX_H, type ChromItem } from "../store";
import { engine } from "../engine";
import { nearestSpectrumByTime } from "../nearestSpectrum";
import { parseRtRange } from "../rtRange";
import { ChromPlot, MultiChromPlot, Button, TreeView, useCvTerms, cvName, type ChromTrace } from "@mzpeak/ui-kit";
import type { ChromatogramInfo } from "@mzpeak/contracts";

const DIA_PALETTE = ["#3b54da", "#c00000", "#2e9e5b", "#e8820c", "#8a3ffc", "#0e9bb5", "#d6336c", "#7cb518"];

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
  const chromList = useStore((s) => s.chromList);
  const settings = useStore((s) => s.settings);
  const addTic = useStore((s) => s.addTic);
  const addXic = useStore((s) => s.addXic);
  const addStoredChrom = useStore((s) => s.addStoredChrom);
  const clearGeneratedChroms = useStore((s) => s.clearGeneratedChroms);
  const cv = useCvTerms();

  const [list, setList] = useState<ChromatogramInfo[] | null>(null);
  const [metaId, setMetaId] = useState<string | null>(null); // stored row whose metadata is shown

  // add-XIC form (m/z, ± tol from Settings default, optional RT window in seconds).
  const [xicMz, setXicMz] = useState("");
  const [xicTol, setXicTol] = useState(String(settings.xicTolDa));
  const [xicRtMin, setXicRtMin] = useState("");
  const [xicRtMax, setXicRtMax] = useState("");

  // DIA fragment extractor — view-local + overlaid.
  const [diaPrecursor, setDiaPrecursor] = useState("");
  const [diaFragments, setDiaFragments] = useState("");
  const [diaTol, setDiaTol] = useState("0.02");
  const [diaRtCenter, setDiaRtCenter] = useState("");
  const [diaTraces, setDiaTraces] = useState<ChromTrace[] | null>(null);
  const [diaBusy, setDiaBusy] = useState(false);
  const [diaNote, setDiaNote] = useState<string | null>(null);

  // Bumped on every file/phase change; the DIA extractor captures it before its await and
  // drops a stale commit (an extraction from a since-closed file).
  const diaRunRef = useRef(0);
  useEffect(() => {
    diaRunRef.current++;
    setDiaTraces(null); setDiaNote(null); setDiaBusy(false); // also clear busy, else a stale
    // in-flight run's guarded finally skips it and the new view's extractor stays disabled.
    if (phase !== "ready") { setList(null); setMetaId(null); return; }
    let live = true;
    engine.chromatogramList().then((cs) => { if (live) setList(cs); }).catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [phase]);
  // Invalidate any in-flight DIA extraction on unmount so its async tail can't setState on the
  // gone component (the run-token guard then drops the commit).
  useEffect(() => () => { diaRunRef.current++; }, []);

  // Keep the add-XIC ± field in sync with the Settings default when it changes while this
  // view is mounted (the field is seeded from settings only at mount otherwise).
  useEffect(() => { setXicTol(String(settings.xicTolDa)); }, [settings.xicTolDa]);

  if (phase !== "ready") {
    return (
      <p data-testid="chrom-empty" style={{ color: "var(--text-muted)", padding: "1rem 0" }}>
        Open a file to view chromatograms.
      </p>
    );
  }

  const xicMzNum = Number(xicMz);
  const xicTolNum = Number(xicTol);
  const xicRt = parseRtRange(xicRtMin, xicRtMax);
  const xicRtValid = xicRt.valid;
  const xicValid = xicMz.trim() !== "" && Number.isFinite(xicMzNum) && xicMzNum > 0 && Number.isFinite(xicTolNum) && xicTolNum > 0 && xicRtValid;
  function onAddXic() {
    if (!xicValid) return;
    addXic({ mz: xicMzNum, tolDa: xicTolNum, rt: xicRt.range });
  }

  const fmtMz = (m: number | null) => (m == null ? "—" : m.toFixed(4));
  const typeLabel = (acc: string | null) => (acc ? (cvName(cv, acc) ?? acc) : "—");
  const selectedMeta = list?.find((c) => c.id === metaId) ?? null;
  const generatedCount = chromList.filter((it) => it.source === "generated").length;

  // DIA
  const diaPrecursorNum = Number(diaPrecursor);
  const diaTolNum = Number(diaTol);
  const diaFragmentMzs = diaFragments.split(/[\s,;]+/).map((s) => Number(s)).filter((v) => Number.isFinite(v) && v > 0);
  const diaValid = Number.isFinite(diaPrecursorNum) && diaPrecursorNum > 0 && Number.isFinite(diaTolNum) && diaTolNum > 0 && diaFragmentMzs.length > 0;
  async function extractDia() {
    if (!diaValid || diaBusy) return;
    const run = diaRunRef.current; // guard: drop the commit if the file changes mid-extraction
    setDiaBusy(true); setDiaNote(null);
    const c = Number(diaRtCenter);
    const rt: [number, number] | undefined = diaRtCenter.trim() !== "" && Number.isFinite(c) ? [c - 60, c + 60] : undefined;
    try {
      const series = await Promise.all(diaFragmentMzs.map((mz) => engine.extractChrom({ mode: "diaXic", precursorMz: diaPrecursorNum, mz, tolDa: diaTolNum, ...(rt ? { rt } : {}) })));
      if (run !== diaRunRef.current) return;
      const traces: ChromTrace[] = series.map((s, i) => ({ label: `m/z ${diaFragmentMzs[i]!.toFixed(3)}`, color: DIA_PALETTE[i % DIA_PALETTE.length]!, points: seriesToPoints(s) }));
      setDiaTraces(traces);
      if (traces.every((t) => t.points.length === 0)) setDiaNote(`No MS2 isolation window contains m/z ${diaPrecursorNum.toFixed(4)} — check the precursor m/z, or this file may not be DIA.`);
    } catch (err) {
      if (run !== diaRunRef.current) return;
      setDiaNote(err instanceof Error ? err.message : String(err)); setDiaTraces(null);
    } finally { if (run === diaRunRef.current) setDiaBusy(false); }
  }

  return (
    <div data-testid="chromatograms-view" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Toolbar: add generated traces */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="secondary" size="sm" onClick={() => addTic()} data-testid="tic-btn">+ add TIC</Button>

        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
          title="Add an extracted-ion chromatogram: intensity summed over m/z ± tolerance across the run, vs retention time.">
          <label htmlFor="xic-mz-input" style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>+ add XIC m/z</label>
          <input id="xic-mz-input" data-testid="xic-mz-input" type="number" step="any" placeholder="445.12" value={xicMz}
            onChange={(e) => setXicMz(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAddXic(); }} style={xicInputStyle(7)} />
          <span style={{ color: "var(--text-muted)" }}>±</span>
          <input data-testid="xic-tol-input" type="number" step="any" aria-label="XIC m/z tolerance (Da)" value={xicTol}
            onChange={(e) => setXicTol(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAddXic(); }} style={xicInputStyle(4.5)} />
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Da · RT</span>
          <input data-testid="xic-rtmin-input" type="number" step="any" placeholder="min s" aria-label="XIC RT min (s)" value={xicRtMin}
            onChange={(e) => setXicRtMin(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAddXic(); }} style={xicInputStyle(4.5)} />
          <span style={{ color: "var(--text-muted)" }}>–</span>
          <input data-testid="xic-rtmax-input" type="number" step="any" placeholder="max s" aria-label="XIC RT max (s)" value={xicRtMax}
            onChange={(e) => setXicRtMax(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAddXic(); }} style={xicInputStyle(4.5)} />
          <Button variant="secondary" size="sm" onClick={onAddXic} disabled={!xicValid} data-testid="xic-btn">Add XIC</Button>
          {!xicRtValid && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-danger, #dc2626)" }}>RT: both min &lt; max, or both blank.</span>}
        </span>

        {generatedCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearGeneratedChroms} data-testid="chrom-clear-generated">Clear generated ({generatedCount})</Button>
        )}
      </div>

      {/* Stored chromatograms catalog — "+ Add" to plot, click a row for metadata. */}
      {list && list.length > 0 && (
        <div data-testid="chrom-stored-list">
          <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.35rem" }}>
            Stored chromatograms <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({list.length})</span>
          </h3>
          <table style={{ borderCollapse: "collapse", fontSize: "var(--text-sm, 0.82rem)", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", borderBottom: "1px solid var(--border-hairline, #eee)" }}>
                <th style={{ padding: "0.2rem 0.5rem 0.2rem 0", fontWeight: 500 }} />
                <th style={{ padding: "0.2rem 0.6rem", fontWeight: 500 }}>id</th>
                <th style={{ padding: "0.2rem 0.6rem", fontWeight: 500 }}>type</th>
                <th style={{ padding: "0.2rem 0.6rem", fontWeight: 500 }}>pol.</th>
                <th style={{ padding: "0.2rem 0.6rem", fontWeight: 500, textAlign: "right" }}>precursor m/z</th>
                <th style={{ padding: "0.2rem 0.6rem", fontWeight: 500, textAlign: "right" }}>product m/z</th>
                <th style={{ padding: "0.2rem 0 0.2rem 0.6rem", fontWeight: 500, textAlign: "right" }}>points</th>
              </tr>
            </thead>
            <tbody style={{ fontFamily: "var(--font-mono, monospace)" }}>
              {list.map((c) => {
                const added = chromList.some((it) => it.itemId === `stored:${c.index}`);
                return (
                  <tr key={c.id} data-testid={`chrom-row-${c.index}`}
                    style={{ borderTop: "1px solid var(--border-hairline, #f0f0f0)", background: metaId === c.id ? "var(--surface-panel, #f1f5f9)" : undefined }}>
                    <td style={{ padding: "0.2rem 0.5rem 0.2rem 0" }}>
                      <Button variant="ghost" size="sm" disabled={added} data-testid={`chrom-add-${c.index}`}
                        onClick={() => addStoredChrom(c.index, c.id)} title={added ? "Already added" : "Add to the chromatogram list"}>
                        {added ? "✓" : "+ Add"}
                      </Button>
                    </td>
                    <td style={{ padding: "0.25rem 0.6rem 0.25rem 0" }}>
                      <button type="button" onClick={() => setMetaId(metaId === c.id ? null : c.id)}
                        aria-expanded={metaId === c.id} aria-label={`Toggle metadata for ${c.id}`}
                        style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--text-link, #2563eb)", textAlign: "left", wordBreak: "break-all", cursor: "pointer" }}>
                        {c.id}
                      </button>
                    </td>
                    <td style={{ padding: "0.25rem 0.6rem", fontFamily: "var(--font-sans)" }}>{typeLabel(c.typeAccession)}</td>
                    <td style={{ padding: "0.25rem 0.6rem" }}>{c.polarity ?? "—"}</td>
                    <td style={{ padding: "0.25rem 0.6rem", textAlign: "right" }}>{fmtMz(c.precursorMz)}</td>
                    <td style={{ padding: "0.25rem 0.6rem", textAlign: "right" }}>{fmtMz(c.productMz)}</td>
                    <td style={{ padding: "0.25rem 0 0.25rem 0.6rem", textAlign: "right" }}>{c.nPoints ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {selectedMeta && (
            <details data-testid="chrom-metadata-panel" open style={{ marginTop: "0.4rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "var(--text-sm)", color: "var(--text-muted)", userSelect: "none" }}>Chromatogram metadata — {selectedMeta.id}</summary>
              <div style={{ marginTop: "0.5rem", maxWidth: 820 }}><TreeView label="chromatogram" value={selectedMeta.meta} defaultOpen={3} /></div>
            </details>
          )}
        </div>
      )}
      {list && list.length === 0 && (
        <p data-testid="chrom-no-stored" style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: 0 }}>
          This file has no stored chromatograms. Add a TIC or XIC above.
        </p>
      )}

      {/* The managed card list. */}
      {chromList.length === 0 ? (
        <p data-testid="chrom-list-empty" style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: 0 }}>
          No chromatograms yet — add a TIC or XIC, or pick a stored one.
        </p>
      ) : (
        <div data-testid="chrom-card-list" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {chromList.map((item) => <ChromCard key={item.itemId} item={item} />)}
        </div>
      )}

      {/* ── DIA fragment extractor ────────────────────────────────────────────── */}
      <details data-testid="dia-extractor" style={{ marginTop: "0.4rem", borderTop: "1px solid var(--border-hairline, #eee)", paddingTop: "0.6rem" }}>
        <summary style={{ cursor: "pointer", fontSize: "0.9rem", fontWeight: 600, userSelect: "none" }}>DIA fragment extractor</summary>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: "0.4rem 0" }}>
          Enter a precursor m/z (selects the DIA isolation window) and one or more fragment m/z values; each is extracted over that window&apos;s MS2 spectra and overlaid by retention time.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Precursor m/z
            <input data-testid="dia-precursor-input" type="number" step="any" placeholder="620.83" value={diaPrecursor} onChange={(e) => setDiaPrecursor(e.target.value)} style={xicInputStyle(7)} /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "var(--text-sm)", color: "var(--text-muted)", flex: "1 1 16rem", minWidth: "12rem" }}>Fragment m/z (comma / space separated)
            <input data-testid="dia-fragments-input" type="text" placeholder="545.30, 802.45, 917.48" value={diaFragments} onChange={(e) => setDiaFragments(e.target.value)} style={{ ...xicInputStyle(7), width: "100%", fontFamily: "var(--font-mono)" }} /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>± Da
            <input data-testid="dia-tol-input" type="number" step="any" value={diaTol} onChange={(e) => setDiaTol(e.target.value)} style={xicInputStyle(4.5)} /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>RT center (s, optional)
            <input data-testid="dia-rt-input" type="number" step="any" placeholder="full run" value={diaRtCenter} onChange={(e) => setDiaRtCenter(e.target.value)} style={xicInputStyle(6)} /></label>
          <Button variant="secondary" size="sm" onClick={() => void extractDia()} disabled={!diaValid || diaBusy} data-testid="dia-extract-btn">{diaBusy ? "Extracting…" : "Extract fragments"}</Button>
        </div>
        {diaNote && <p data-testid="dia-note" style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0.25rem 0" }}>{diaNote}</p>}
        {diaTraces && diaTraces.some((t) => t.points.length > 0) && (
          <div data-testid="dia-plot-host">
            <MultiChromPlot traces={diaTraces} />
            <p style={{ margin: "0.25rem 0 0", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{diaTraces.length} transition{diaTraces.length === 1 ? "" : "s"} · scroll to zoom · double-click to reset</p>
          </div>
        )}
      </details>
    </div>
  );
}

/** One chromatogram card: header (label · points · remove) + ChromPlot + drag-resize handle.
 *  Stored traces don't RT-click-select (no reliable scan mapping); generated TIC/XIC do. */
function ChromCard({ item }: { item: ChromItem }) {
  const removeChrom = useStore((s) => s.removeChrom);
  const setChromHeight = useStore((s) => s.setChromHeight);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const browse = useStore((s) => s.browse);
  const selector = useStore((s) => s.selector);

  // Memoize by series so a selection / settings / sibling-resize re-render doesn't rebuild
  // this plot (and lose its zoom) — only a new series rebuilds it.
  const points = useMemo(() => (item.series ? seriesToPoints(item.series) : []), [item.series]);

  // RT-click → nearest spectrum. Restrict to the trace's effective MS level so the click
  // lands on a same-level scan: the XIC's own msLevel, or MS1 for a TIC (the engine TIC sums
  // MS1 when present, so a DDA run must not pick an interleaved MS2 scan).
  const pickLevel =
    item.req.mode === "xic" ? item.req.msLevel
    : item.req.mode === "tic" && browse?.msLevel.some((l) => l === 1) ? 1
    : undefined;
  function pickNearestSpectrum(time: number) {
    if (!browse || item.source === "stored") return;
    const best = nearestSpectrumByTime(browse, time, pickLevel ?? undefined);
    if (best >= 0) void selectSpectrum(best);
  }
  // Only mark the selected spectrum on this trace if it belongs to the trace's level — a
  // marker for a scan not summed into this card would be misleading.
  let selectedTime: number | null = null;
  if (item.source !== "stored" && selector && browse && (pickLevel == null || browse.msLevel[selector.index] === pickLevel)) {
    const rt = browse.rt[selector.index] as number | undefined;
    selectedTime = rt != null && Number.isFinite(rt) ? rt : null;
  }

  return (
    <div data-testid={`chrom-card-${item.itemId}`} style={{ border: "1px solid var(--border-default, #e2e8f0)", borderRadius: 8, background: "var(--surface-card, #fff)", padding: "0.5rem 0.6rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: item.source === "stored" ? "var(--text-muted, #94a3b8)" : "var(--blue-600, #3b54da)" }} aria-hidden />
        <strong style={{ fontSize: "var(--text-sm)", color: "var(--text-heading, #1e293b)" }}>{item.label}</strong>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          {item.loading ? "loading…" : item.error ? `error: ${item.error}` : item.series ? `${item.series.time.length} pts` : ""}
        </span>
        <Button variant="ghost" size="sm" data-testid={`chrom-remove-${item.itemId}`} onClick={() => removeChrom(item.itemId)} aria-label="Remove chromatogram" style={{ marginLeft: "auto" }}>×</Button>
      </div>
      {points.length > 0 ? (
        <div data-testid="chrom-plot-host">
          <ChromPlot points={points} height={item.height} onPick={pickNearestSpectrum} selectedTime={selectedTime} />
        </div>
      ) : (
        !item.loading && <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: "0.25rem 0" }}>{item.error ? "Could not load this chromatogram." : "No data points."}</p>
      )}
      <ResizeHandle height={item.height} onResize={(h) => setChromHeight(item.itemId, h)} />
    </div>
  );
}

/** Bottom drag handle — pointer-captured, clamped, with keyboard ↑/↓ nudge (a11y).
 *  Commits height on pointer-UP only (one rebuild per resize, not per tick);
 *  the plot snaps to the new size on release. Live setSize would need uPlot-instance
 *  plumbing through useUplot — not worth it. */
function ResizeHandle({ height, onResize }: { height: number; onResize: (h: number) => void }) {
  const startY = useRef(0);
  const startH = useRef(height);
  const pending = useRef(height);
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    startY.current = e.clientY;
    startH.current = height;
    pending.current = height;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    pending.current = startH.current + (e.clientY - startY.current);
  }
  function onPointerUpOrCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      onResize(pending.current);
    }
  }
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize chromatogram"
      aria-valuemin={CHROM_MIN_H}
      aria-valuemax={CHROM_MAX_H}
      aria-valuenow={height}
      tabIndex={0}
      data-testid="chrom-resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUpOrCancel}
      onPointerCancel={onPointerUpOrCancel}
      onLostPointerCapture={() => { /* released */ }}
      onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); onResize(height + 20); } else if (e.key === "ArrowUp") { e.preventDefault(); onResize(height - 20); } }}
      style={{ height: 8, marginTop: 2, cursor: "ns-resize", touchAction: "none", display: "flex", justifyContent: "center", alignItems: "center" }}
    >
      <span aria-hidden style={{ width: 28, height: 3, borderRadius: 2, background: "var(--border-strong, #c5ccd3)" }} />
    </div>
  );
}
