// Chromatograms view — TIC button → loadChrom → ChromPlot.
import { useStore, seriesToPoints } from "../store";
import { ChromPlot, Button } from "@mzpeak/ui-kit";

export function Chromatograms() {
  const phase = useStore((s) => s.phase);
  const chrom = useStore((s) => s.chrom);
  const chromLoading = useStore((s) => s.chromLoading);
  const loadChrom = useStore((s) => s.loadChrom);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const browse = useStore((s) => s.browse);
  const selector = useStore((s) => s.selector);

  if (phase !== "ready") {
    return (
      <p
        data-testid="chrom-empty"
        style={{ color: "var(--text-muted)", padding: "1rem 0" }}
      >
        Open a file to view chromatograms.
      </p>
    );
  }

  const points = chrom ? seriesToPoints(chrom) : [];

  // Find the closest browse index for a given retention time
  function handlePick(time: number) {
    if (!browse) return;
    // Find spectrum nearest to this retention time
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < browse.rt.length; i++) {
      const rt = browse.rt[i] as number;
      if (!Number.isFinite(rt)) continue;
      const d = Math.abs(rt - time);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    void selectSpectrum(bestIdx);
  }

  // Compute selected time from current selector + browse
  let selectedTime: number | null = null;
  if (selector && browse) {
    const rt = browse.rt[selector.index] as number | undefined;
    selectedTime = rt != null && Number.isFinite(rt) ? rt : null;
  }

  return (
    <div
      data-testid="chromatograms-view"
      style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
    >
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void loadChrom({ mode: "tic" })}
          disabled={chromLoading}
          data-testid="tic-btn"
        >
          {chromLoading ? "Computing…" : chrom ? "Refresh TIC" : "Build TIC"}
        </Button>
        {chrom && (
          <span
            style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}
          >
            {chrom.time.length} points
          </span>
        )}
      </div>

      {!chrom && !chromLoading && (
        <p
          data-testid="chrom-prompt"
          style={{
            color: "var(--text-muted)",
            fontSize: "var(--text-sm)",
            padding: "0.5rem 0",
          }}
        >
          Click <strong>Build TIC</strong> to compute the total-ion chromatogram
          from the per-spectrum retention-time index. Click any point to navigate
          to the nearest spectrum.
        </p>
      )}

      {chromLoading && (
        <div
          style={{
            padding: "2rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            fontSize: "var(--text-sm)",
          }}
        >
          Computing chromatogram…
        </div>
      )}

      {chrom && points.length > 0 && (
        <>
          <div data-testid="chrom-plot-host">
            <ChromPlot
              points={points}
              onPick={handlePick}
              selectedTime={selectedTime}
            />
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
            }}
          >
            Click a point to select the nearest spectrum · scroll to zoom ·
            double-click to reset
          </p>
        </>
      )}
    </div>
  );
}
