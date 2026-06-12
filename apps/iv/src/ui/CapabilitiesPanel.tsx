import { useStore } from "../state/store";
import { Panel, StatRow, Badge } from "./ds";

/**
 * Capabilities readout: storage layout, encodings present, imaging-detected
 * boolean, and any unsupported features. Reskinned to Panel + StatRow + Badge.
 * The cap-is-imaging cell keeps the lowercase "yes"/"no" word the e2e asserts.
 */
export function CapabilitiesPanel() {
  const capabilities = useStore((s) => s.capabilities);

  if (!capabilities) return null;

  const { layout, encodings, isImaging, unsupported } = capabilities;

  return (
    <Panel title="Capabilities" testid="capabilities-panel">
      <div data-testid="capabilities-table">
        <StatRow label="Layout" testid="cap-layout" value={layout} />

        <StatRow
          label="Encodings"
          testid="cap-encodings"
          value={
            encodings.length > 0 ? (
              <span style={{ display: "inline-flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                {encodings.map((enc) => (
                  <Badge key={enc} tone="neutral" mono>
                    {enc}
                  </Badge>
                ))}
              </span>
            ) : (
              "none detected"
            )
          }
        />

        <StatRow
          label="Imaging data"
          value={
            isImaging ? (
              <span data-testid="cap-is-imaging">
                <Badge tone="success" dot>
                  <span data-testid="imaging-detected-yes">yes</span>
                </Badge>
              </span>
            ) : (
              <span data-testid="cap-is-imaging">
                <Badge tone="neutral" dot>
                  <span data-testid="imaging-detected-no">no</span>
                </Badge>
              </span>
            )
          }
        />

        {unsupported.length > 0 && (
          <StatRow
            label="Unsupported"
            value={
              <span
                data-testid="cap-unsupported"
                style={{ display: "inline-flex", gap: "var(--space-2)", flexWrap: "wrap" }}
              >
                {unsupported.map((u) => (
                  <Badge key={u.code} tone="danger">
                    <span title={u.code}>{u.label}</span>
                  </Badge>
                ))}
              </span>
            }
          />
        )}
      </div>
    </Panel>
  );
}
