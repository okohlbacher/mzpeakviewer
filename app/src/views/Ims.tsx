// Ion-mobility (IMS / timsTOF) view — browse frames as 2-D m/z × 1/K0 heatmaps.
// Each mzPeak spectrum is one timsTOF frame; when it carries per-peak mobility the frame is a
// point cloud (m/z, 1/K0, intensity). This view is a thin frame browser over the store's
// spectrum selection, rendering the shared MobilityFrameHeatmap full-size. Gated in the nav by
// capabilities.mobility.present (showMobility); the per-spectrum panel in Spectra stays too.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { MobilityFrameHeatmap, Button } from "@mzpeak/ui-kit";

export function Ims() {
  const phase = useStore((s) => s.phase);
  const stats = useStore((s) => s.stats);
  const spectrum = useStore((s) => s.spectrum);
  const spectrumLoading = useStore((s) => s.spectrumLoading);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const [go, setGo] = useState("");

  const total = stats?.numSpectra ?? 0;
  const index = spectrum?.index ?? null;

  // Load frame 0 on first mount if nothing is selected yet (route=false: stay on this view).
  const loaded = useRef(false);
  useEffect(() => {
    if (!loaded.current && phase === "ready" && total > 0 && index == null) {
      loaded.current = true;
      void selectSpectrum(0, false).catch(() => {});
    }
  }, [phase, total, index, selectSpectrum]);

  if (phase !== "ready") return null;
  if (total === 0) return <p style={{ color: "var(--text-muted)" }}>This file has no spectra.</p>;

  const step = (d: number) => {
    if (index == null) return;
    const next = index + d;
    if (next >= 0 && next < total) void selectSpectrum(next, false).catch(() => {});
  };
  const submitGo = () => {
    const n = Number(go);
    if (Number.isInteger(n) && n >= 0 && n < total) void selectSpectrum(n, false).catch(() => {});
  };

  const hasMobility = !!spectrum?.mobility;

  return (
    <div>
      {/* Frame stepper */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600 }}>Frame</span>
        <Button data-testid="ims-prev" onClick={() => step(-1)} disabled={index == null || index <= 0}>‹ Prev</Button>
        <Button data-testid="ims-next" onClick={() => step(1)} disabled={index == null || index >= total - 1}>Next ›</Button>
        <span data-testid="ims-frame-label" style={{ color: "var(--text-muted)" }}>
          {index == null ? "—" : `#${index}`} of {total}
        </span>
        <input
          data-testid="ims-go-input"
          aria-label="Go to frame index"
          value={go}
          onChange={(e) => setGo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitGo()}
          placeholder="index"
          style={{ width: "6rem", padding: "0.25rem 0.5rem" }}
        />
        <Button data-testid="ims-go" onClick={submitGo}>Go</Button>
      </div>

      {spectrumLoading && <p style={{ color: "var(--text-muted)" }}>Loading frame…</p>}

      {!spectrumLoading && hasMobility && (
        <>
          <p style={{ margin: "0 0 0.5rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
            m/z × 1/K₀ · {spectrum!.mobility!.values.length} mobility bins · {spectrum!.mz.length} peaks
          </p>
          <div data-testid="ims-heatmap-host" className="chart-host" style={{ height: 460, position: "relative" }}>
            <MobilityFrameHeatmap
              mz={spectrum!.mz}
              intensity={spectrum!.intensity}
              mobilityValues={spectrum!.mobility!.values}
              mobilityIndex={spectrum!.mobility!.index}
            />
          </div>
        </>
      )}

      {!spectrumLoading && !hasMobility && (
        <p data-testid="ims-no-mobility" style={{ color: "var(--text-muted)" }}>
          Frame {index == null ? "" : `#${index} `}carries no per-peak ion mobility — nothing to plot.
        </p>
      )}
    </div>
  );
}
