import { useStore } from "../state/store";
import { Panel, StatRow } from "./ds";

/** Human-readable byte size (e.g. "294.1 MB"). */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

/** Best-effort instrument model from the (format-unstable) FileMetadata. */
function instrumentModel(fileMeta: unknown): string | null {
  const ics = (fileMeta as { instrumentConfigurations?: unknown })?.instrumentConfigurations;
  if (!Array.isArray(ics)) return null;
  const scan = (o: unknown): string | null => {
    const ps = (o as { parameters?: unknown })?.parameters;
    if (!Array.isArray(ps)) return null;
    for (const p of ps as Array<{ name?: string; value?: unknown; accession?: string }>) {
      if (p.accession === "MS:1000031" || (p.name ?? "").toLowerCase().includes("instrument")) {
        const v = p.value ?? p.name;
        if (v != null && v !== "") return String(v);
      }
    }
    return null;
  };
  for (const ic of ics) {
    const direct = scan(ic);
    if (direct) return direct;
    const comps = (ic as { components?: unknown }).components;
    if (Array.isArray(comps)) for (const c of comps) {
      const m = scan(c);
      if (m) return m;
    }
  }
  return null;
}

/**
 * "Overview" — a concise file-at-a-glance summary as the FIRST rail accordion
 * (UAT): file size, dimensions, total + per-MS-level spectrum counts, m/z range,
 * and instrument when available. Detailed breakdowns live in the panels below
 * (Sample & Run, MS Image) and in Format details.
 */
export function OverviewPanel({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const stats = useStore((s) => s.stats);
  const grid = useStore((s) => s.grid);
  const capabilities = useStore((s) => s.capabilities);
  const fileSize = useStore((s) => s.fileSize);
  const fileMeta = useStore((s) => s.fileMeta);

  if (!capabilities) return null;

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });

  // Per-MS-level counts: prefer the real breakdown; otherwise, when there is a
  // single level, attribute all spectra to it (the common imaging MS1 case).
  const perLevel: Record<number, number> | null =
    stats?.spectraPerLevel ??
    (stats && stats.msLevels.length === 1
      ? { [stats.msLevels[0]]: stats.numSpectra }
      : null);
  const instrument = instrumentModel(fileMeta);

  return (
    <Panel title="Overview" testid="overview-panel" defaultOpen={defaultOpen}>
      <div data-testid="overview-table">
        {fileSize != null && (
          <StatRow label="File size" testid="ov-file-size" value={formatBytes(fileSize)} />
        )}

        {capabilities.isImaging && grid && (
          <StatRow
            label="Dimensions"
            testid="ov-dimensions"
            value={
              <>
                {grid.width.toLocaleString()} × {grid.height.toLocaleString()} <em>px</em>
              </>
            }
          />
        )}

        <StatRow
          label="Spectra"
          testid="ov-spectra"
          value={stats?.numSpectra != null ? stats.numSpectra.toLocaleString() : null}
        />

        {perLevel &&
          Object.keys(perLevel)
            .map(Number)
            .sort((a, b) => a - b)
            .map((lvl) => (
              <StatRow
                key={lvl}
                label={`· MS${lvl}`}
                testid={`ov-level-${lvl}`}
                value={perLevel[lvl].toLocaleString()}
              />
            ))}

        {stats?.mzRange && (
          <StatRow
            label="m/z range"
            testid="ov-mz-range"
            value={
              <>
                {fmt(stats.mzRange[0])} – {fmt(stats.mzRange[1])} <em>Da</em>
              </>
            }
          />
        )}

        {instrument && <StatRow label="Instrument" testid="ov-instrument" value={instrument} />}
      </div>
    </Panel>
  );
}
