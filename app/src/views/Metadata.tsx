// Metadata view — TreeView of fileMeta.
import { useStore } from "../store";
import { TreeView } from "@mzpeak/ui-kit";

export function Metadata() {
  const phase = useStore((s) => s.phase);
  const fileMeta = useStore((s) => s.fileMeta);

  if (phase !== "ready") {
    return (
      <p
        data-testid="metadata-empty"
        style={{ color: "var(--text-muted)", padding: "1rem 0" }}
      >
        Open a file to view metadata.
      </p>
    );
  }

  if (!fileMeta) {
    return (
      <p
        data-testid="metadata-none"
        style={{ color: "var(--text-muted)", padding: "1rem 0" }}
      >
        No metadata available in this file.
      </p>
    );
  }

  return (
    <div data-testid="metadata-view" style={{ maxWidth: 760 }}>
      <TreeView label="fileDescription" value={fileMeta.fileDescription} defaultOpen={2} />
      {fileMeta.instrumentConfigurations.length > 0 && (
        <TreeView
          label="instrumentConfigurations"
          value={fileMeta.instrumentConfigurations}
          defaultOpen={1}
        />
      )}
      {fileMeta.software.length > 0 && (
        <TreeView label="software" value={fileMeta.software} defaultOpen={1} />
      )}
      {fileMeta.samples.length > 0 && (
        <TreeView label="samples" value={fileMeta.samples} defaultOpen={1} />
      )}
      <TreeView label="run" value={fileMeta.run} defaultOpen={2} />
    </div>
  );
}
