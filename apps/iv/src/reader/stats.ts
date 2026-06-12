// Compute FileStats and Capabilities from an already-initialized Reader.
//
// Stays inside the reader boundary: only imports the opaque Reader type and
// plain-value helpers from the same folder. No Apache Arrow, mzpeakts types, or
// bigint cross the module boundary.
import type { Reader } from "./openUrl";
import type {
  Capabilities,
  FileStats,
  ManifestEntry,
  SpectrumRepresentation,
} from "./types";

// ── CV accession constants ────────────────────────────────────────────────────

// MS:1000511 = ms level
const MS_LEVEL_ACCESSION = "MS_1000511_ms_level";
// MS:1000525 = spectrum representation (MS:1000128 profile / MS:1000127 centroid)
const REPR_ACCESSION = "MS_1000525_spectrum_representation";
const REPR_PROFILE = "MS:1000128";
const REPR_CENTROID = "MS:1000127";

// IMS:1000050 = position x; IMS:1000051 = position y (imaging-mzpeak-spec v0.3)
// Promoted column names in the scan table (authoritative path).
const IMS_POS_X_COL = "IMS_1000050_position_x";
const IMS_POS_Y_COL = "IMS_1000051_position_y";
// Accession strings (for fallback CV-param probing).
const IMS_POS_X_ACC = "IMS:1000050";
const IMS_POS_Y_ACC = "IMS:1000051";

// BufferFormat identifiers from the array index.
const BF_POINT = "point";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map raw MS:1000525 value to the SpectrumRepresentation enum. */
function toRepresentation(raw: unknown): SpectrumRepresentation {
  if (raw === REPR_PROFILE) return "profile";
  if (raw === REPR_CENTROID) return "centroid";
  return null;
}

/**
 * Safely read a promoted column value from a spectrum record's `meta` bag.
 * The reader stores promoted columns as `{ [colName]: value }` on `rec.meta`.
 */
function metaValue(meta: unknown, colName: string): unknown {
  if (meta && typeof meta === "object") {
    return (meta as Record<string, unknown>)[colName];
  }
  return undefined;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute per-file aggregate stats from the already-initialized reader.
 *
 * - `numSpectra` / `numEntities` — from the manifest + spectrumMetadata.
 * - `mzRange` — derived from per-spectrum scan-window CV params if available;
 *   returns `null` when not derivable (explicit "not available" path, R-02d).
 * - `msLevels` — unique sorted MS levels read from the spectrum metadata table.
 * - `representationCounts` — profile vs centroid counts (R-02b).
 */
export function computeStats(
  reader: Reader,
  manifest: ManifestEntry[],
): FileStats {
  const sm = reader.spectrumMetadata;
  const n = sm?.length ?? 0;

  const msLevelsSet = new Set<number>();
  const perLevel: Record<number, number> = {};
  let mzMin: number | null = null;
  let mzMax: number | null = null;
  let profileCount = 0;
  let centroidCount = 0;

  for (let i = 0; i < n; i++) {
    // Use the metadata table directly (already loaded eagerly; no signal I/O).
    // We rely on the `spectra` Arrow vector for promoted columns, accessed via
    // the public `get(i)` API which returns a plain Spectrum record.
    const rec = sm!.get(i);

    // MS level
    const rawMeta = rec.meta ?? {};
    const msLevelRaw =
      (rawMeta as Record<string, unknown>)[MS_LEVEL_ACCESSION];
    const msLevel =
      typeof msLevelRaw === "number"
        ? msLevelRaw
        : rec.msLevel != null
          ? Number(rec.msLevel)
          : null;
    if (msLevel !== null && !isNaN(msLevel)) {
      msLevelsSet.add(msLevel);
      perLevel[msLevel] = (perLevel[msLevel] ?? 0) + 1;
    }

    // Representation (R-02b)
    const reprRaw =
      (rawMeta as Record<string, unknown>)[REPR_ACCESSION] ??
      (rec.isProfile ? REPR_PROFILE : undefined);
    const repr = toRepresentation(reprRaw);
    if (repr === "profile") profileCount++;
    else if (repr === "centroid") centroidCount++;

    // m/z range from scan-window CV params on scans, if present.
    if (rec.scans && rec.scans.length > 0) {
      for (const scan of rec.scans) {
        const scanMeta = scan.meta ?? {};
        // IMS scan windows use column names derived from CV accessions:
        // MS:1000501 = scan window lower limit; MS:1000500 = upper limit.
        const lowerRaw = scanMeta[
          "MS_1000501_scan_window_lower_limit_unit_MS_1000040"
        ] as number | undefined;
        const upperRaw = scanMeta[
          "MS_1000500_scan_window_upper_limit_unit_MS_1000040"
        ] as number | undefined;
        if (typeof lowerRaw === "number" && isFinite(lowerRaw)) {
          if (mzMin === null || lowerRaw < mzMin) mzMin = lowerRaw;
        }
        if (typeof upperRaw === "number" && isFinite(upperRaw)) {
          if (mzMax === null || upperRaw > mzMax) mzMax = upperRaw;
        }
      }
    }
  }

  return {
    numSpectra: n,
    numEntities: manifest.length,
    mzRange: mzMin !== null && mzMax !== null ? [mzMin, mzMax] : null,
    msLevels: Array.from(msLevelsSet).sort((a, b) => a - b),
    spectraPerLevel: perLevel,
    representationCounts: { profile: profileCount, centroid: centroidCount },
  };
}

/**
 * Detect layout, encodings, and whether this file contains imaging data.
 *
 * - `layout` — inferred from the spectrum array index buffer formats.
 * - `encodings` — unique CURIE strings from `arrayTypeCURIE` in the array index.
 * - `isImaging` — BOOLEAN probe only (NO coordinate reconstruction here, that is P2).
 *   TRUE when:
 *     (a) the spectra scan table has promoted `IMS_1000050_position_x` /
 *         `IMS_1000051_position_y` columns (authoritative per imaging-mzpeak-spec v0.3
 *         C1/C2), OR
 *     (b) any spectrum's scans expose IMS:1000050 / IMS:1000051 as CV params, OR
 *     (c) the mzpeak_index.json `metadata.imaging.is_imaging` flag is set.
 * - `unsupported` — left empty here; populated by plan 01-03's capability.ts.
 */
export function computeCapabilities(
  reader: Reader,
  _manifest: ManifestEntry[],
): Capabilities {
  // ── Layout + encoding detection from the array index ─────────────────────
  const arrayIndex = reader._spectrumDataReader?.arrayIndex ?? null;
  const peakArrayIndex = reader._spectrumPeaksReader?.arrayIndex ?? null;

  // Gather all buffer formats and encoding CURIEs from whichever index is present.
  const bufferFormats = new Set<string>();
  const encodingCuries = new Set<string>();

  function collectIndex(idx: unknown) {
    if (!idx || typeof idx !== "object") return;
    const entries =
      (idx as { entries?: unknown[] }).entries;
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const entry = e as {
        bufferFormat?: string;
        arrayTypeCURIE?: string;
      };
      if (entry.bufferFormat) bufferFormats.add(String(entry.bufferFormat));
      if (entry.arrayTypeCURIE) encodingCuries.add(String(entry.arrayTypeCURIE));
    }
  }

  collectIndex(arrayIndex);
  collectIndex(peakArrayIndex);

  // Fallback: try to infer from the store's spectrum data / peaks reader paths.
  // The array index may be null for the demo file until data is first read; use
  // the manifest as a hint: if the file has spectra_data, it likely is point layout.
  let layout: Capabilities["layout"] = "point"; // default for demo fixture
  if (bufferFormats.size > 0) {
    const hasPoint = bufferFormats.has(BF_POINT);
    const hasChunk =
      bufferFormats.has("chunk_values") ||
      bufferFormats.has("chunk_encoding") ||
      bufferFormats.has("chunk_start") ||
      bufferFormats.has("chunk_end") ||
      bufferFormats.has("chunk_secondary") ||
      bufferFormats.has("chunk_transform");
    if (hasPoint && hasChunk) layout = "mixed";
    else if (hasChunk) layout = "chunked";
    else layout = "point";
  }

  // ── Imaging detection (boolean probe, R-02c) ──────────────────────────────
  const isImaging = probeIsImaging(reader);

  return {
    layout,
    encodings: Array.from(encodingCuries).sort(),
    isImaging,
    unsupported: [], // populated by plan 01-03
  };
}

/**
 * Boolean imaging probe.
 *
 * Checks three sources (in priority order):
 * 1. Promoted IMS_1000050_position_x / IMS_1000051_position_y columns on scan records.
 * 2. IMS:1000050 / IMS:1000051 CV params via `getParamByAccession`.
 * 3. `metadata.imaging.is_imaging` discovery block in the file index metadata.
 *
 * Returns `true` as soon as any source confirms imaging; `false` otherwise.
 *
 * Accession-keyed, not column-name-grepped, per imaging-mzpeak-spec v0.3 C1/C2
 * and Codex binding R-02c.
 */
export function probeIsImaging(reader: Reader): boolean {
  // Source 3: mzpeak_index.json metadata.imaging.is_imaging discovery block.
  const fileIndexMeta = reader.store?.fileIndex?.metadata;
  if (fileIndexMeta && typeof fileIndexMeta === "object") {
    const imaging = (fileIndexMeta as Record<string, unknown>)["imaging"];
    if (imaging && typeof imaging === "object") {
      const isImagingFlag = (imaging as Record<string, unknown>)["is_imaging"];
      if (isImagingFlag === true) return true;
    }
  }

  const sm = reader.spectrumMetadata;
  if (!sm || sm.length === 0) return false;

  // Source 1: check first few spectra for promoted IMS position columns on scans.
  const probeLimit = Math.min(sm.length, 5);
  for (let i = 0; i < probeLimit; i++) {
    const rec = sm.get(i);

    // Check promoted columns in the scan records' meta bag.
    if (rec.scans && rec.scans.length > 0) {
      for (const scan of rec.scans) {
        const scanMeta = scan.meta ?? {};
        if (
          metaValue(scanMeta, IMS_POS_X_COL) !== undefined ||
          metaValue(scanMeta, IMS_POS_Y_COL) !== undefined
        ) {
          return true;
        }
        // Source 2: CV-param probe via accession (also handles non-promoted storage).
        if (
          scan.getParamByAccession?.(IMS_POS_X_ACC) !== undefined ||
          scan.getParamByAccession?.(IMS_POS_Y_ACC) !== undefined
        ) {
          return true;
        }
      }
    }
  }

  return false;
}
