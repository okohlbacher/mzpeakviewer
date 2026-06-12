// Normalize the reader's file-level metadata + manifest into plain shapes for
// the hierarchical Metadata tab. Imports only the opaque Reader and plainify.
import type { Reader } from "./open";
import { plainify } from "./plainify";
import type { FileMeta, ManifestEntry } from "./types";

/** Normalize the five file-level metadata groups into a plain {@link FileMeta}. */
export function fileMeta(reader: Reader): FileMeta {
  const fm = reader.fileMetadata as Record<string, unknown> | undefined;
  return {
    fileDescription: plainify(fm?.fileDescription) ?? null,
    instrumentConfigurations:
      (plainify(fm?.instrumentConfigurations) as unknown[]) ?? [],
    software: (plainify(fm?.software) as unknown[]) ?? [],
    dataProcessing:
      (plainify(fm?.dataProcessing ?? fm?.dataProcessingMethods) as unknown[]) ??
      [],
    run: plainify(fm?.run) ?? null,
    samples: (plainify(fm?.samples) as unknown[]) ?? [],
  };
}

/** Parse `mzpeak_index.json` into a plain {@link ManifestEntry}[]. */
export function manifest(reader: Reader): ManifestEntry[] {
  const files = reader.store?.fileIndex?.files ?? [];
  return files.map((e) => ({
    name: String(e.name),
    entityType: String(e.entityType ?? ""),
    dataKind: String(e.dataKind ?? ""),
  }));
}

/** The raw `mzpeak_index.json` metadata discovery block (imaging, etc.). */
export function indexMetadata(reader: Reader): unknown {
  return plainify(reader.store?.fileIndex?.metadata) ?? null;
}
