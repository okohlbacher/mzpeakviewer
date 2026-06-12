import { useStore } from "../state/store";
import { Panel, StatRow, Badge } from "./ds";

/**
 * "Optical" sidebar panel (UAT-r3 / ADD-01): lists the embedded optical images
 * (microscopy / histology overviews, imaging-spec v0.5). Shown only when the
 * file carries `metadata.imaging.images[]`. Each entry reports source, role,
 * native dimensions, and whether a (coarse) registration affine is present.
 * Clicking selects it for the Optical image tab.
 */
export function OpticalPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const opticalImages = useStore((s) => s.opticalImages);
  const selectedOpticalPath = useStore((s) => s.selectedOpticalPath);
  const setSelectedOpticalPath = useStore((s) => s.setSelectedOpticalPath);
  const opticalDecoded = useStore((s) => s.opticalDecoded);

  if (!opticalImages || opticalImages.length === 0) return null;

  return (
    <Panel
      title="Optical"
      testid="optical-panel"
      defaultOpen={defaultOpen}
      count={opticalImages.length}
    >
      <div data-testid="optical-list">
        {opticalImages.map((im) => {
          const selected = im.archivePath === selectedOpticalPath;
          const decoded = !!opticalDecoded[im.archivePath];
          return (
            <button
              key={im.archivePath}
              type="button"
              data-testid="optical-list-item"
              data-decoded={decoded || undefined}
              aria-pressed={selected}
              onClick={() => setSelectedOpticalPath(im.archivePath)}
              className={`optical-item${selected ? " optical-item--active" : ""}`}
            >
              <div className="optical-item__head">
                <span className="optical-item__name" title={im.sourceName}>
                  {im.sourceName}
                </span>
                {decoded && (
                  <Badge tone="success" dot>
                    ready
                  </Badge>
                )}
                <Badge tone={im.role === "optical" ? "info" : "neutral"}>{im.role}</Badge>
              </div>
              <StatRow
                label="Size"
                value={
                  <>
                    {im.width.toLocaleString()} × {im.height.toLocaleString()} <em>px</em>
                  </>
                }
              />
              <StatRow
                label="Registration"
                value={
                  im.affine ? (
                    <span title="coarse display hint, not true co-registration">
                      {im.registrationQuality ?? "affine"}
                    </span>
                  ) : (
                    "none (standalone)"
                  )
                }
              />
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
