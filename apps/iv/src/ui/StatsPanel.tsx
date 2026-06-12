import { useStore } from "../state/store";
import { Panel, StatRow, Badge } from "./ds";

/**
 * "MS Image" panel (UAT-r3): the single source of truth for the researcher-facing
 * image geometry + acquisition counts. Merges the former "Image Info" stats with
 * the researcher-relevant parts of the Grid panel (pixel size, physical extent,
 * fill coverage) so dimensions/spectra are no longer duplicated across panels.
 * Format-implementer diagnostics (coord source, discovery, duplicates) stay under
 * "Format details". Renamed "MS Image" to distinguish from optical images.
 */
export function StatsPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const stats = useStore((s) => s.stats);
  const grid = useStore((s) => s.grid);
  const capabilities = useStore((s) => s.capabilities);

  if (!capabilities) return null;

  const mzRange = stats?.mzRange ?? null;
  const numSpectra = stats?.numSpectra ?? null;
  const msLevels = stats?.msLevels ?? [];
  const repr = stats?.representationCounts;

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });

  // Physical extent (mm) from grid dimensions × pixel size.
  const extentMm =
    grid && grid.pixelSizeUm
      ? {
          x: (grid.width * grid.pixelSizeUm.x) / 1000,
          y: (grid.height * grid.pixelSizeUm.y) / 1000,
        }
      : null;
  const fillPct = grid ? Math.round((grid.filledCount / grid.totalCells) * 100) : null;

  return (
    <Panel title="MS Image" testid="stats-panel" defaultOpen={defaultOpen}>
      <div data-testid="stats-table">
        {capabilities.isImaging && (
          <StatRow
            label="Dimensions"
            testid="stat-dimensions"
            value={
              grid ? (
                <>
                  {grid.width.toLocaleString()} × {grid.height.toLocaleString()} <em>px</em>
                </>
              ) : null
            }
          />
        )}

        {capabilities.isImaging && grid?.pixelSizeUm && (
          <StatRow
            label="Pixel size"
            testid="stat-pixel-size"
            value={
              <>
                {grid.pixelSizeUm.x.toLocaleString()} × {grid.pixelSizeUm.y.toLocaleString()}{" "}
                <em>µm</em>
              </>
            }
          />
        )}

        {capabilities.isImaging && extentMm && (
          <StatRow
            label="Extent"
            testid="stat-extent"
            value={
              <>
                {extentMm.x.toFixed(1)} × {extentMm.y.toFixed(1)} <em>mm</em>
              </>
            }
          />
        )}

        {capabilities.isImaging && fillPct !== null && (
          <StatRow
            label="Coverage"
            testid="stat-coverage"
            value={
              <>
                {grid!.filledCount.toLocaleString()} / {grid!.totalCells.toLocaleString()}{" "}
                <em>px ({fillPct}%)</em>
              </>
            }
          />
        )}

        <StatRow
          label="Spectra"
          testid="stat-spectra"
          value={numSpectra !== null ? numSpectra.toLocaleString() : null}
        />

        <StatRow
          label="m/z range"
          testid="stat-mz-range"
          value={
            mzRange !== null ? (
              <>
                {fmt(mzRange[0])} – {fmt(mzRange[1])} <em>Da</em>
              </>
            ) : (
              // Non-empty even when absent — e2e asserts this cell is never blank.
              "not available"
            )
          }
        />

        {msLevels.length > 0 && (
          <StatRow label="MS levels" testid="stat-ms-levels" value={msLevels.join(", ")} />
        )}

        {repr && (repr.profile > 0 || repr.centroid > 0) && (
          <StatRow
            label="Mode"
            testid="stat-representation"
            value={
              <span style={{ display: "inline-flex", gap: "var(--space-3)" }}>
                {repr.profile > 0 && (
                  <Badge tone="info" mono>
                    <span data-testid="repr-profile">{repr.profile.toLocaleString()} profile</span>
                  </Badge>
                )}
                {repr.centroid > 0 && (
                  <Badge tone="accent" mono>
                    <span data-testid="repr-centroid">
                      {repr.centroid.toLocaleString()} centroid
                    </span>
                  </Badge>
                )}
              </span>
            }
          />
        )}
      </div>

      {capabilities.isImaging && !grid && (
        <p
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-faint)",
            marginTop: "var(--space-3)",
            marginBottom: 0,
          }}
        >
          Dimensions and counts appear after the first ion image loads.
        </p>
      )}
    </Panel>
  );
}
