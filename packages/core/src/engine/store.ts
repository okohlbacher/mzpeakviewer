// Structural views of the opaque mzpeakts Reader's store — the only internals the engine
// touches (ZIP entries, member range reads, the parsed mzpeak_index.json). One copy, shared.
import type { Reader } from "../reader/openUrl";

/** A raw zip.js entry, as the store lists it. */
export type RawZipEntry = {
  filename?: unknown;
  compressedSize?: unknown;
  uncompressedSize?: unknown;
  compressionMethod?: unknown;
  directory?: unknown;
  getData?: (writer: unknown) => Promise<Uint8Array>;
};

/** A member's bytes with range access: size + slice() → arrayBuffer(). */
export type RemoteBlob = {
  size: number;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
};

export type Store = {
  entries?: RawZipEntry[];
  fileIndex?: { files?: { name?: unknown; data_kind?: unknown }[]; metadata?: unknown };
  open?: (name: string) => Promise<RemoteBlob | undefined>;
};

export function readerStore(reader: Reader): Store | undefined {
  return (reader as unknown as { store?: Store }).store;
}

/** `mzpeak_index.json` → `metadata`, or {} . */
export function indexMeta(reader: Reader): Record<string, unknown> {
  const m = readerStore(reader)?.fileIndex?.metadata;
  return m && typeof m === "object" ? (m as Record<string, unknown>) : {};
}

/** A metadata value that may be an inlined object OR a JSON string → object, else null. */
export function asObj(v: unknown): Record<string, unknown> | null {
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}
