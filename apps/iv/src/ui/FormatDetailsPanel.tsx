import { useStore } from "../state/store";
import { Panel } from "./ds";
import { MetadataPanel } from "./MetadataPanel";
import { CapabilitiesPanel } from "./CapabilitiesPanel";
import { GridDiagnosticsPanel } from "./GridDiagnosticsPanel";

/**
 * "Format details" (UAT-r3): a single collapsed accordion that gathers everything
 * a researcher does NOT need in their primary view — the parquet manifest +
 * storage layout, encodings, coordinate-source strategy + grid diagnostics, the
 * raw file-level metadata JSON, and unsupported-feature flags. Demoting these out
 * of the top-level rail removes the dimensions/spectra triplication and the
 * parquet-internals noise the operator flagged, while keeping them one click away
 * for format implementers and debugging.
 */
export function FormatDetailsPanel() {
  const capabilities = useStore((s) => s.capabilities);
  if (!capabilities) return null;

  return (
    <Panel title="Format details" testid="format-details-panel" defaultOpen={false}>
      <div className="format-details">
        <MetadataPanel />
        <CapabilitiesPanel />
        <GridDiagnosticsPanel />
      </div>
    </Panel>
  );
}
