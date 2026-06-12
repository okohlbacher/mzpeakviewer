import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { SpectrumPlot } from "./SpectrumPlot";
import { TreeView } from "./TreeView";
import { Button, PlotSpinner, Select, TextField } from "./components";
import { spectrumReporters, type ReporterPeak } from "./reporters";
import { compactIntensity } from "./chartTheme";

/** Reporter-ion quant pills: per-channel intensity extracted from the spectrum's
 *  reporter peaks (shown only when channels exist and reporters were detected). */
function ReporterPills({ reporters }: { reporters: ReporterPeak[] }) {
  const matched = reporters.filter((r) => r.intensity != null);
  if (matched.length === 0) return null;
  const total = matched.reduce((s, r) => s + (r.intensity ?? 0), 0);
  const max = Math.max(...matched.map((r) => r.intensity ?? 0), 1);
  return (
    <div style={{ marginTop: "0.45rem" }}>
      <div className="hint" style={{ marginBottom: "0.25rem" }}>
        Reporter ions — {matched.length}/{reporters.length} channels detected (extracted at ±5 mDa)
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        {reporters.map((r, i) => {
          const has = r.intensity != null;
          const pct = has && total > 0 ? (100 * (r.intensity ?? 0)) / total : 0;
          return (
            <div
              key={`${r.channelLabel ?? ""}:${i}`}
              title={`${r.channelLabel ?? "?"} · ${r.sampleName ?? ""} · reporter m/z ${r.reporterMz.toFixed(4)}${
                has ? ` · ${(r.intensity ?? 0).toExponential(3)} (${pct.toFixed(1)}%)` : " · not detected"
              }`}
              style={{
                display: "flex", flexDirection: "column", gap: 2, minWidth: 86,
                padding: "0.3rem 0.45rem", border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-sm)", background: "var(--surface-card)", opacity: has ? 1 : 0.5,
              }}
            >
              <span style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <span className="mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-heading)" }}>{r.channelLabel}</span>
                <span className="hint" style={{ fontSize: "var(--text-xs)" }}>{has ? `${pct.toFixed(0)}%` : "—"}</span>
              </span>
              <span style={{ fontSize: "var(--text-sm)", fontVariantNumeric: "tabular-nums" }}>
                {has ? compactIntensity(r.intensity ?? 0) : "—"}
              </span>
              <span style={{ height: 3, borderRadius: 2, background: "var(--surface-panel)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${has ? (100 * (r.intensity ?? 0)) / max : 0}%`, background: "var(--accent)" }} />
              </span>
              <span className="hint" style={{ fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 92 }}>
                {r.sampleName ?? ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The Spectra view: navigate + inspect individual spectra (optionally filtered
 *  by MS level). The TIC / XIC chromatogram lives in the Chromatograms tab. */
export function SpectraTab() {
  const initBrowse = useStore((s) => s.initBrowse);
  useEffect(() => {
    void initBrowse();
  }, [initBrowse]);

  const numSpectra = useStore((s) => s.summary?.numSpectra ?? 0);
  const msLevelCounts = useStore((s) => s.summary?.msLevelCounts);
  const spectra = useStore((s) => s.spectra);
  const selectedIndex = useStore((s) => s.selectedIndex);
  const selectedSpectrum = useStore((s) => s.selectedSpectrum);
  const selectedMeta = useStore((s) => s.selectedMeta);
  const spectrumLoading = useStore((s) => s.spectrumLoading);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const scanned = useStore((s) => s.scanned);
  const msLevelFilter = useStore((s) => s.msLevelFilter);
  const setMsLevelFilter = useStore((s) => s.setMsLevelFilter);
  const stepSpectrum = useStore((s) => s.stepSpectrum);
  const chromMode = useStore((s) => s.chromMode);
  const xicParams = useStore((s) => s.xicParams);
  const study = useStore((s) => s.studyMeta);
  const spectrumZoom = useStore((s) => s.spectrumZoom);
  const setSpectrumZoom = useStore((s) => s.setSpectrumZoom);

  // The spectrum-number field commits on Enter/blur (not on every keystroke),
  // so typing e.g. "10000" fires ONE load, not five — each cold spectrum read
  // over HTTP is a ~12 MB row group (see the navigation perf analysis).
  const [posDraft, setPosDraft] = useState<string | null>(null);

  // Reporter-ion quant overlay: only when the file has isobaric channels and the
  // selected spectrum (MSn≥2) actually contains the reporter ions.
  const { reporters, matched } = useMemo(
    () => spectrumReporters(study?.channels, selectedSpectrum),
    [study, selectedSpectrum],
  );
  const reporterMarkers = matched > 0
    ? reporters.map((r) => ({ mz: r.reporterMz, label: r.channelLabel ?? "", matched: r.intensity != null }))
    : undefined;

  const n = numSpectra;
  if (n === 0) {
    return <p className="hint">This file contains no spectra to browse.</p>;
  }

  const selRow = selectedIndex != null ? spectra[selectedIndex] : undefined;

  // Levels known from the scan; before it runs we can't know, so offer the
  // common levels speculatively. Always include the active filter so the
  // dropdown shows the current selection even when the file has none of it.
  const knownLevels = scanned
    ? Object.keys(msLevelCounts ?? {}).map(Number)
    : [1, 2, 3];
  const levelSet = new Set(knownLevels);
  if (msLevelFilter != null) levelSet.add(msLevelFilter);
  const levels = [...levelSet].sort((a, b) => a - b);
  const levelOptions = [
    { value: "all", label: `All${scanned ? ` (${numSpectra.toLocaleString()})` : ""}` },
    ...levels.map((lvl) => {
      const c = msLevelCounts?.[lvl] ?? 0;
      return {
        value: String(lvl),
        label: `MS${lvl}${scanned ? ` (${c.toLocaleString()})` : ""}`,
      };
    }),
  ];

  // When an MS level is selected, the index + counter are relative to that level.
  const filtering = msLevelFilter != null;
  const filtered = filtering ? spectra.filter((r) => r.msLevel === msLevelFilter) : null;
  // Resolving = filter chosen but the scan that knows MS levels hasn't finished.
  const resolving = filtering && !scanned;
  // No matches = the file genuinely has no spectra at the chosen level.
  const noMatches = filtering && scanned && (filtered?.length ?? 0) === 0;
  const usingFilter = filtering && (filtered?.length ?? 0) > 0;
  const total = filtering ? filtered?.length ?? 0 : n;
  const pos = usingFilter
    ? Math.max(0, filtered!.findIndex((r) => r.index === selectedIndex))
    : selectedIndex ?? 0;
  const navDisabled = resolving || noMatches;

  // Commit the typed spectrum position (Enter/blur) → exactly one load.
  const commitPos = () => {
    if (posDraft == null) return;
    const v = Number(posDraft);
    setPosDraft(null);
    if (!Number.isFinite(v) || v < 0 || v >= total) return;
    if (usingFilter) void selectSpectrum(filtered![v].index);
    else if (!filtering) void selectSpectrum(v);
  };

  const repr = selectedSpectrum?.representation;
  const reprHint =
    repr === "centroid"
      ? "centroid spectrum — drawn as a stick spectrum"
      : repr
        ? "profile spectrum — drawn as a line"
        : null;

  return (
    <div className="browse view-narrow">
      <div className="browse-controls">
        <div className="control-row">
          <Button
            size="sm"
            disabled={navDisabled || pos <= 0}
            onClick={() => { setPosDraft(null); void stepSpectrum(-1); }}
          >
            ‹ Prev
          </Button>
          <TextField
            label={usingFilter ? `Spectrum (MS${msLevelFilter})` : "Spectrum"}
            type="number"
            width="5rem"
            min={0}
            max={Math.max(0, total - 1)}
            value={navDisabled ? 0 : posDraft ?? pos}
            disabled={navDisabled}
            suffix={`of ${Math.max(0, total - 1)}`}
            onChange={(e) => setPosDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitPos();
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={commitPos}
          />
          <Button
            size="sm"
            disabled={navDisabled || pos >= total - 1}
            onClick={() => { setPosDraft(null); void stepSpectrum(1); }}
          >
            Next ›
          </Button>
        </div>

        <Select
          label="MS level"
          value={msLevelFilter == null ? "all" : String(msLevelFilter)}
          options={levelOptions}
          onChange={(e) => void setMsLevelFilter(e.target.value === "all" ? null : Number(e.target.value))}
        />
      </div>

      {resolving ? (
        <div className="data-stage">
          <div className="stage-plot">
            <p className="stage-hint" style={{ padding: "1.4rem 0.2rem" }}>
              Resolving MS levels — scanning the per-spectrum index…
            </p>
          </div>
        </div>
      ) : noMatches ? (
        <div className="data-stage">
          <div className="stage-plot">
            <p className="stage-hint" style={{ padding: "1.4rem 0.2rem" }}>
              <strong style={{ color: "var(--text-heading)" }}>
                No MS{msLevelFilter} spectra in this file.
              </strong>{" "}
              This file contains{" "}
              {levels
                .filter((l) => (msLevelCounts?.[l] ?? 0) > 0)
                .map((l) => `MS${l}`)
                .join(", ") || "no level-tagged"}{" "}
              spectra.{" "}
              <button className="link-btn" onClick={() => void setMsLevelFilter(null)}>
                Show all spectra
              </button>
            </p>
          </div>
        </div>
      ) : (
        <div className="data-stage">
        <div className="stage-plot">
          <h4 className="stage-h">
            Spectrum
            <span className="stage-meta">
              {(() => {
                const meta = selectedSpectrum ?? selRow;
                if (!meta && !spectrumLoading) return "";
                return [
                  meta ? `id: ${meta.id}` : null,
                  meta?.msLevel != null ? `MS${meta.msLevel}` : null,
                  meta?.representation ?? null,
                  meta?.time != null ? `RT ${meta.time.toFixed(2)} s` : null,
                  selectedSpectrum ? `${selectedSpectrum.mz.length} pts` : null,
                  spectrumLoading ? "loading…" : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
              })()}
            </span>
          </h4>
          <div style={{ position: "relative" }}>
            <SpectrumPlot
              spectrum={selectedSpectrum}
              xicWindow={chromMode === "xic" ? xicParams : null}
              reporters={reporterMarkers}
              zoom={spectrumZoom}
              onZoomChange={setSpectrumZoom}
            />
            {spectrumLoading && <PlotSpinner label="Loading spectrum…" />}
          </div>
          {matched > 0 && <ReporterPills reporters={reporters} />}
          <p className="stage-hint" style={{ marginTop: "0.25rem" }}>
            {reprHint ? `${reprHint} · ` : ""}scroll to zoom · drag a box to zoom
            m/z · middle-drag to pan · double-click to reset
            {matched > 0 ? " · reporter ions marked in red" : ""}
          </p>
        </div>
        </div>
      )}

      {!navDisabled && selectedMeta != null && (
        <details style={{ marginTop: "0.1rem" }}>
          <summary
            style={{
              cursor: "pointer",
              fontWeight: "var(--weight-semibold)",
              fontSize: "var(--text-body)",
              color: "var(--text-heading)",
            }}
          >
            Spectrum metadata
          </summary>
          <div style={{ marginTop: "0.4rem" }}>
            <TreeView label="spectrum" value={selectedMeta} defaultOpen={2} />
          </div>
        </details>
      )}
    </div>
  );
}
