// UV/VIS (wavelength / PDA / DAD optical) view — a SIDEBAR entry (gated on
// capabilities.wavelength.present), not a sub-tab inside the MS Spectra view.
//
// Three sub-views (segmented control): per-time Spectrum (WavelengthSpectrumPlot),
// derived Chromatogram (PDA max trace / extracted single-λ), and the 2D time×wavelength
// Heatmap. All state lives in the store; the wavelength browse + first spectrum load
// lazily the first time this view mounts (store.ensureWavelength — the shared loader).
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import {
  WavelengthSpectrumPlot,
  WavelengthChromatogramPlot,
  WavelengthHeatmap,
  RadioSegmentedControl,
  Select,
  Button,
  TreeView,
  type SelectOption,
} from "@mzpeak/ui-kit";

type UvView = "spectrum" | "chromatogram" | "heatmap";

export function Wavelength() {
  const phase = useStore((s) => s.phase);
  const hasWavelength = useStore((s) => s.hasWavelength);
  const browse = useStore((s) => s.wavelengthBrowse);
  const spectrum = useStore((s) => s.wavelengthSpectrum);
  const loading = useStore((s) => s.wavelengthSpectrumLoading);
  const select = useStore((s) => s.selectWavelengthSpectrum);
  const ensureWavelength = useStore((s) => s.ensureWavelength);
  const matrix = useStore((s) => s.wavelengthMatrix);
  const matrixLoading = useStore((s) => s.wavelengthMatrixLoading);
  const loadMatrix = useStore((s) => s.loadWavelengthMatrix);

  // Lazy-load the wavelength browse + first spectrum when this view first mounts (MS+UV
  // files don't eager-load it at open). selectWavelengthSpectrum builds the browse on
  // first use; idempotent + stale-guarded in the store. The one-shot ref ensures a
  // persistently-failing load can't re-fire (loading false→true→false would otherwise
  // re-trigger the effect into a loop).
  const triedLoad = useRef(false);
  useEffect(() => {
    if (hasWavelength && !browse && !loading && !triedLoad.current) {
      triedLoad.current = true;
      void ensureWavelength();
    }
  }, [hasWavelength, browse, loading, ensureWavelength]);

  // Sub-view within the UV/VIS view: per-time Spectrum, derived Chromatogram, or Heatmap.
  const [uvView, setUvView] = useState<UvView>("spectrum");
  const [chromMode, setChromMode] = useState<"max" | "xwc">("max");
  const [xwcLambda, setXwcLambda] = useState<string>("");

  // The Chromatogram + Heatmap derive from the dense matrix — load it lazily the
  // first time either is opened (idempotent + stale-guarded in the store).
  const needsMatrix = uvView === "chromatogram" || uvView === "heatmap";
  useEffect(() => {
    if (needsMatrix && !matrix && !matrixLoading) void loadMatrix();
  }, [needsMatrix, matrix, matrixLoading, loadMatrix]);

  // Heatmap/chromatogram click → jump to the spectrum at the nearest retention time.
  const pickTime = (timeSec: number) => {
    if (!browse) return;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < browse.rt.length; i++) {
      const d = Math.abs((browse.rt[i] ?? NaN) - timeSec);
      if (Number.isFinite(d) && d < bestD) { bestD = d; best = i; }
    }
    void select(best);
    setUvView("spectrum");
  };

  if (phase !== "ready") {
    return (
      <p data-testid="uvvis-empty" style={{ color: "var(--text-muted)", padding: "1rem 0" }}>
        Open a file to view UV/VIS spectra.
      </p>
    );
  }

  const n = browse?.id.length ?? 0;
  const cur = spectrum?.index ?? 0;

  if (n === 0 && !spectrum) {
    return (
      <p data-testid="uvvis-empty" style={{ color: "var(--text-muted)", padding: "0.5rem 0" }}>
        {loading ? "Loading UV/VIS spectra…" : "This file has no UV/VIS spectra."}
      </p>
    );
  }

  const opts: SelectOption[] = browse
    ? browse.id.slice(0, 1000).map((id, i) => {
        const rt = browse.rt[i];
        const rtLabel = rt != null && Number.isFinite(rt) ? ` · ${rt.toFixed(1)} s` : "";
        return { value: String(i), label: `#${i + 1} · ${id}${rtLabel}` };
      })
    : [];

  const prev = cur > 0 ? cur - 1 : null;
  const next = cur < n - 1 ? cur + 1 : null;

  return (
    <div data-testid="uvvis-view" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* UV/VIS sub-navigation — Spectrum (per time) · Chromatogram (over time) · Heatmap */}
      <RadioSegmentedControl
        ariaLabel="UV/VIS view"
        options={[
          { value: "spectrum", label: "Spectrum" },
          { value: "chromatogram", label: "Chromatogram" },
          { value: "heatmap", label: "Heatmap" },
        ]}
        value={uvView}
        onChange={(v) => setUvView(v as UvView)}
      />

      {uvView === "spectrum" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            {opts.length > 0 && (
              <Select
                data-testid="uvvis-select"
                value={String(cur)}
                onChange={(v) => void select(Number(v))}
                options={opts}
                ariaLabel="Select UV/VIS spectrum"
                size="sm"
              />
            )}
            <Button variant="ghost" size="sm" disabled={prev == null || loading} onClick={() => prev != null && void select(prev)} aria-label="Previous UV/VIS spectrum" data-testid="uvvis-prev">
              ‹ Prev
            </Button>
            <Button variant="ghost" size="sm" disabled={next == null || loading} onClick={() => next != null && void select(next)} aria-label="Next UV/VIS spectrum" data-testid="uvvis-next">
              Next ›
            </Button>
            {spectrum && (
              <span data-testid="uvvis-meta" style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginLeft: "auto" }}>
                {[
                  `#${cur + 1}${n ? `/${n}` : ""}`,
                  spectrum.lambdaMax != null ? `λmax ${spectrum.lambdaMax.toFixed(1)} nm` : null,
                  spectrum.observedRange ? `${spectrum.observedRange[0].toFixed(0)}–${spectrum.observedRange[1].toFixed(0)} nm` : null,
                  Number.isFinite(spectrum.timeSec) ? `${spectrum.timeSec.toFixed(1)} s` : null,
                  `${spectrum.wavelength.length} pts`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
            {loading && <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>loading…</span>}
          </div>

          <div data-testid="uvvis-plot-host" className="chart-host" style={{ height: 320, position: "relative" }}>
            <WavelengthSpectrumPlot spectrum={spectrum} />
          </div>

          {spectrum && (
            <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              <span data-testid="uvvis-points">{spectrum.wavelength.length}</span>
              {` points · wavelength (nm) vs ${spectrum.intensityUnit} · scroll to zoom · double-click to reset`}
            </p>
          )}

          {spectrum && spectrum.meta != null && (
            <details data-testid="uvvis-metadata-panel" style={{ marginTop: "0.1rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "var(--text-sm)", color: "var(--text-muted)", userSelect: "none" }}>
                Spectrum metadata
              </summary>
              <div style={{ marginTop: "0.5rem", maxWidth: 820 }}>
                <TreeView label="wavelength spectrum" value={spectrum.meta} defaultOpen={2} />
              </div>
            </details>
          )}
        </>
      )}

      {uvView === "chromatogram" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <RadioSegmentedControl
              ariaLabel="Chromatogram mode"
              options={[
                { value: "max", label: "Max trace" },
                { value: "xwc", label: "Single λ" },
              ]}
              value={chromMode}
              onChange={(v) => setChromMode(v as "max" | "xwc")}
            />
            {chromMode === "xwc" && (
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                λ (nm)
                <input
                  data-testid="uvvis-xwc-lambda"
                  type="number"
                  value={xwcLambda}
                  placeholder="254"
                  onChange={(e) => setXwcLambda(e.target.value)}
                  style={{ width: "5.5rem", padding: "0.3rem 0.4rem", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", background: "var(--surface-input)", color: "var(--text-heading)" }}
                />
                ± 2
              </label>
            )}
            {matrixLoading && <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>building matrix…</span>}
          </div>
          <div data-testid="uvvis-chrom-host" className="chart-host" style={{ height: 320, position: "relative" }}>
            <WavelengthChromatogramPlot
              matrix={matrix}
              mode={chromMode}
              lambdaNm={chromMode === "xwc" && xwcLambda.trim() !== "" ? Number(xwcLambda) : undefined}
              tolNm={2}
            />
          </div>
          <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            {chromMode === "max"
              ? "PDA max trace — maximum absorbance across all wavelengths at each retention time."
              : "Extracted single-wavelength chromatogram — mean absorbance in λ ± 2 nm over time."}
          </p>
        </>
      )}

      {uvView === "heatmap" && (
        <>
          {matrixLoading && <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>building matrix…</span>}
          <div data-testid="uvvis-heatmap-host" className="chart-host" style={{ height: 440, position: "relative" }}>
            <WavelengthHeatmap matrix={matrix} onPickTime={pickTime} />
          </div>
          <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            Time × wavelength absorbance (viridis) · click a column to open that retention time&apos;s spectrum.
          </p>
        </>
      )}
    </div>
  );
}
