// Ion-mobility (IMS / timsTOF) view — browse frames as 2-D m/z × 1/K0 heatmaps.
// Each mzPeak spectrum is one timsTOF frame; when it carries per-peak mobility the frame is a
// point cloud (m/z, 1/K0, intensity). This view is a thin frame browser over the store's
// spectrum selection, rendering the shared MobilityFrameHeatmap full-size. Gated in the nav by
// capabilities.mobility.present (showMobility); the per-spectrum panel in Spectra stays too.
//
// Frame stepping honours the SAME MS-level filter as the Spectra view (one shared store field),
// via the shared levelIndex helpers — Prev/Next/Go all move within the filtered set, which is what
// makes PASEF files navigable (MS1 survey frames and MS2 frames interleave).
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { buildLevelIndex, activeSet, rankOf, absoluteOf } from "../levelIndex";
import { MobilityFrameHeatmap, Button, Select } from "@mzpeak/ui-kit";

export function Ims() {
  const phase = useStore((s) => s.phase);
  const stats = useStore((s) => s.stats);
  const browse = useStore((s) => s.browse);
  const spectrum = useStore((s) => s.spectrum);
  const spectrumLoading = useStore((s) => s.spectrumLoading);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const msLevelFilter = useStore((s) => s.msLevelFilter);
  const setMsLevelFilter = useStore((s) => s.setMsLevelFilter);
  const [go, setGo] = useState("");

  const total = stats?.numSpectra ?? 0;
  const index = spectrum?.index ?? null;

  // Per-level index, rebuilt only when `browse` changes (switching levels just picks a
  // prebuilt array). Before `browse` arrives, fall back to every index in order.
  const levelIndex = useMemo(() => buildLevelIndex(browse), [browse]);
  const active = useMemo(
    () => (browse ? activeSet(levelIndex, msLevelFilter) : Array.from({ length: total }, (_, i) => i)),
    [browse, levelIndex, msLevelFilter, total],
  );
  const filtered = msLevelFilter != null && !!browse;
  const rank = index != null ? rankOf(active, index) : null; // 1-based position in the active set
  const shownLevel = browse && index != null ? (browse.msLevel[index] ?? null) : null;
  const availableLevels = stats?.msLevels ?? [];

  // Load the first frame of the active set on first mount if nothing is selected yet
  // (route=false: stay on this view).
  const loaded = useRef(false);
  useEffect(() => {
    if (!loaded.current && phase === "ready" && active.length > 0 && index == null) {
      loaded.current = true;
      void selectSpectrum(active[0]!, false).catch(() => {});
    }
  }, [phase, active, index, selectSpectrum]);

  if (phase !== "ready") return null;
  if (total === 0) return <p style={{ color: "var(--text-muted)" }}>This file has no spectra.</p>;

  // Switching level: if the current frame isn't in the new level, jump to its first frame.
  const applyFilter = (level: number | null) => {
    setMsLevelFilter(level);
    if (level != null && browse && index != null && browse.msLevel[index] !== level) {
      const first = levelIndex.byLevel.get(level)?.[0];
      if (first != null) void selectSpectrum(first, false).catch(() => {});
    }
  };
  // Prev/Next step WITHIN the active set, using the current 1-based rank.
  const step = (d: number) => {
    if (rank == null) return;
    const next = active[rank - 1 + d];
    if (next != null) void selectSpectrum(next, false).catch(() => {});
  };
  // The typed number is the 1-based position within the active set (matches Spectra).
  const submitGo = () => {
    const abs = absoluteOf(active, Number(go));
    if (abs != null) void selectSpectrum(abs, false).catch(() => {});
  };

  const hasMobility = !!spectrum?.mobility;

  return (
    <div>
      {/* Frame stepper + MS-level filter */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {availableLevels.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            MS level
            <Select
              data-testid="ims-ms-level-filter"
              value={msLevelFilter == null ? "all" : String(msLevelFilter)}
              onChange={(val) => applyFilter(val === "all" ? null : Number(val))}
              options={[
                { value: "all", label: "All" },
                ...availableLevels.map((l) => ({ value: String(l), label: `MS${l}` })),
              ]}
              ariaLabel="Filter ion-mobility frames by MS level"
              size="sm"
            />
          </label>
        )}

        <span style={{ fontWeight: 600 }}>Frame</span>
        <Button data-testid="ims-prev" onClick={() => step(-1)} disabled={rank == null || rank <= 1}>‹ Prev</Button>
        <Button data-testid="ims-next" onClick={() => step(1)} disabled={rank == null || rank >= active.length}>Next ›</Button>
        <span data-testid="ims-frame-label" style={{ color: "var(--text-muted)" }}>
          {rank == null ? "—" : `${filtered ? `MS${msLevelFilter} ` : ""}#${rank}`} of {active.length}
          {index != null ? ` · abs #${index}` : ""}
          {shownLevel != null && !filtered ? ` · MS${shownLevel}` : ""}
        </span>
        <input
          data-testid="ims-go-input"
          aria-label={filtered ? `Go to MS${msLevelFilter} frame (1–${active.length})` : `Go to frame (1–${active.length})`}
          type="number"
          min={1}
          max={active.length}
          value={go}
          onChange={(e) => setGo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitGo()}
          placeholder={rank != null ? String(rank) : ""}
          style={{ width: "6rem", padding: "0.25rem 0.5rem" }}
        />
        <Button data-testid="ims-go" onClick={submitGo}>Go</Button>
      </div>

      {active.length === 0 && (
        <p data-testid="ims-empty-level" style={{ color: "var(--text-muted)" }}>
          No frames at MS{msLevelFilter} in this file.
        </p>
      )}

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

      {!spectrumLoading && !hasMobility && active.length > 0 && (
        <p data-testid="ims-no-mobility" style={{ color: "var(--text-muted)" }}>
          Frame {index == null ? "" : `#${index} `}carries no per-peak ion mobility — nothing to plot.
        </p>
      )}
    </div>
  );
}
