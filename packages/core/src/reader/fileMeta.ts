// Normalize the reader's metadata into plain POJOs / primitives.
//
// Converts any `bigint` to `number` and never returns Arrow `Vector`/`Table`
// (ARCHITECTURE anti-pattern 2). Imports only the opaque `Reader` handle from
// openUrl.ts — never `mzpeakts` directly.
import type { Reader } from "./openUrl";
import type {
  FileMeta,
  FileStats,
  ManifestEntry,
  SpectrumMeta,
  SpectrumRepresentation,
} from "./types";

// MS:1000128 = profile spectrum; MS:1000127 = centroid spectrum (PSI-MS CV).
const REPR_ACCESSION = "MS_1000525_spectrum_representation";
const REPR_PROFILE = "MS:1000128";
const REPR_CENTROID = "MS:1000127";
const MS_LEVEL_ACCESSION = "MS_1000511_ms_level";

/**
 * Recursively convert a value into something structured-clone- and
 * JSON-friendly: `bigint` -> `number`, Arrow/class instances -> plain objects.
 * Defensive at the boundary because the reader hands us mixed
 * Arrow/class/bigint shapes (only validate at system boundaries — CLAUDE.md).
 */
function plainify(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return Number(value);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth > 12) return undefined; // guard against pathological cycles
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => plainify(v, depth + 1));
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "function") continue;
      out[k] = plainify(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

/** Normalize file-level metadata groups into a plain {@link FileMeta} (FMT-02). */
export function fileMeta(reader: Reader): FileMeta {
  const fm = reader.fileMetadata;
  return {
    fileDescription: plainify(fm?.fileDescription) ?? null,
    instrumentConfigurations:
      (plainify(fm?.instrumentConfigurations) as unknown[]) ?? [],
    software: (plainify(fm?.software) as unknown[]) ?? [],
    run: plainify(fm?.run) ?? null,
    samples: (plainify(fm?.samples) as unknown[]) ?? [],
  };
}

/** Parse `mzpeak_index.json` into a plain {@link ManifestEntry}[] (FMT-01). */
export function manifest(reader: Reader): ManifestEntry[] {
  const files = reader.store?.fileIndex?.files ?? [];
  return files.map((e) => ({
    name: String(e.name),
    entityType: String(e.entityType ?? ""),
    dataKind: String(e.dataKind ?? ""),
  }));
}

/** Map a raw MS:1000525 representation accession to the UI-facing enum. */
function toRepresentation(raw: unknown): SpectrumRepresentation {
  if (raw === REPR_PROFILE) return "profile";
  if (raw === REPR_CENTROID) return "centroid";
  return null;
}

/**
 * Per-spectrum metadata accessor (R-01a): exposes `representation` as a typed
 * field so Phase 3 signal-file routing builds on the boundary. Reads the
 * promoted MS:1000525 column from the spectrum record.
 */
export function spectrumMeta(reader: Reader, index: number): SpectrumMeta {
  const sm = reader.spectrumMetadata;
  if (!sm) throw new Error("Reader has no spectrum metadata");
  const rec = sm.get(index);
  // Spectrum.meta holds the raw promoted columns by accession-derived name.
  const rawMeta = (rec.meta ?? {}) as Record<string, unknown>;
  const reprRaw =
    rawMeta[REPR_ACCESSION] ?? (rec.isProfile ? REPR_PROFILE : undefined);
  const msLevelRaw = rawMeta[MS_LEVEL_ACCESSION];
  return {
    index,
    id: String(rec.id),
    msLevel: typeof msLevelRaw === "number" ? msLevelRaw : (rec.msLevel ?? null),
    representation: toRepresentation(reprRaw),
  };
}

/**
 * Minimal per-file stats (used by the store test mock and legacy readers).
 * Production code now calls `computeStats` from `stats.ts` which fills
 * all fields including `mzRange`, `msLevels`, and `representationCounts`.
 */
export function fileStats(reader: Reader): FileStats {
  return {
    numSpectra: reader.numSpectra,
    numEntities: manifest(reader).length,
    mzRange: null,
    msLevels: [],
    representationCounts: { profile: 0, centroid: 0 },
  };
}
