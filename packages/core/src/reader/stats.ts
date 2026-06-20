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
} from "./types";

// ── CV accession constants ────────────────────────────────────────────────────

// NOTE (perf): the per-spectrum aggregates that used MS-level / representation
// CV accessions (ms level, spectrum representation) moved OUT of the blocking open
// path into the async engineScanBreakdown (scanBreakdown.ts), which derives the SAME
// mzRange / msLevels / representationCounts via the faster columnar `scanSpectra`.
// computeStats below is now O(1).

// IMS:1000050 = position x; IMS:1000051 = position y (imaging-mzpeak-spec v0.3).
// Promoted column names in the scan table (authoritative path).
const IMS_POS_X_COL = "IMS_1000050_position_x";
const IMS_POS_Y_COL = "IMS_1000051_position_y";
// Accession strings (for fallback CV-param probing).
const IMS_POS_X_ACC = "IMS:1000050";
const IMS_POS_Y_ACC = "IMS:1000051";

// BufferFormat identifiers from the array index.
const BF_POINT = "point";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
 *   returns `null` when not derivable (explicit "not available" path).
 * - `msLevels` — unique sorted MS levels read from the spectrum metadata table.
 * - `representationCounts` — profile vs centroid counts.
 */
/**
 * Read a spectrum-metadata record, tolerating reader exceptions on unusual vendor
 * metadata layouts. Some files (e.g. Thermo-centroid, Bruker-PASEF) carry spectrum
 * param columns the vendored reader's `Param.fromArrow` (metadata.ts) can't parse —
 * it assumes a struct column and calls `.getChild` on a null / non-struct vector,
 * throwing a TypeError. A single unreadable record must degrade gracefully (the file
 * still opens with whatever IS derivable) rather than crashing the whole open.
 * Returns `null` for a record that throws.
 */
function safeRecord<T>(sm: { get(i: number): T }, i: number): T | null {
  try {
    return sm.get(i);
  } catch {
    return null;
  }
}

/**
 * Compute the O(1) per-file stats available at open WITHOUT a per-spectrum scan.
 *
 * PERF: this used to iterate `sm.get(i)` for EVERY spectrum (materializing a full
 * record per row) to derive mzRange / msLevels / representationCounts — minutes on a
 * 30k-spectrum file, and it BLOCKED the open ("ready"). That work is entirely redundant
 * with `engineScanBreakdown`, which derives the same aggregates (plus rtRange +
 * instrument) via the faster columnar `scanSpectra`, runs ASYNC after "ready", and is
 * merged into the store. So the blocking open now reports only the cheap counts; the
 * ranges/levels/representation fill in a moment later. Views render the null/empty
 * stats gracefully until then.
 */
export function computeStats(
  reader: Reader,
  manifest: ManifestEntry[],
): FileStats {
  const sm = reader.spectrumMetadata;
  const n = sm?.length ?? 0;
  return {
    numSpectra: n,
    numEntities: manifest.length,
    mzRange: null, // → filled by engineScanBreakdown (async, off the open path)
    msLevels: [], // → engineScanBreakdown
    spectraPerLevel: {}, // → engineScanBreakdown
    representationCounts: { profile: 0, centroid: 0 }, // → engineScanBreakdown
  };
}

/**
 * Detect layout, encodings, and whether this file contains imaging data.
 *
 * - `layout` — inferred from the spectrum array index buffer formats.
 * - `encodings` — unique CURIE strings from `arrayTypeCURIE` in the array index.
 * - `isImaging` — BOOLEAN probe only (NO coordinate reconstruction here).
 *   TRUE when:
 *     (a) the spectra scan table has promoted `IMS_1000050_position_x` /
 *         `IMS_1000051_position_y` columns (authoritative per imaging-mzpeak-spec
 *         v0.3), OR
 *     (b) any spectrum's scans expose IMS:1000050 / IMS:1000051 as CV params, OR
 *     (c) the mzpeak_index.json `metadata.imaging.is_imaging` flag is set.
 * - `unsupported` — left empty here; populated by capability.ts.
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

  // ── Imaging detection (boolean probe) ─────────────────────────────────────
  const isImaging = probeIsImaging(reader);

  return {
    layout,
    encodings: Array.from(encodingCuries).sort(),
    isImaging,
    unsupported: [], // populated by capability.ts
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
 * Accession-keyed, not column-name-grepped, per imaging-mzpeak-spec v0.3.
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
    const rec = safeRecord(sm, i);
    if (!rec) continue;

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

/** The three independent imaging signals (mirrors @mzpeak/contracts ImagingSignal). */
export type ImagingSignalName = "ims-columns" | "cv-params" | "metadata-flag";

/**
 * Signal-enumerating imaging probe — the same 3 sources as `probeIsImaging`, but
 * returns the FULL set of signals that fired (not a single boolean) so the
 * capability model can report provenance (CapabilityModel.imaging.signals).
 * Unlike the boolean probe it does not early-return: every source is checked.
 */
export function probeImagingSignals(reader: Reader): ImagingSignalName[] {
  const signals = new Set<ImagingSignalName>();

  // Source 3: mzpeak_index.json metadata.imaging.is_imaging discovery flag.
  const fileIndexMeta = reader.store?.fileIndex?.metadata;
  if (fileIndexMeta && typeof fileIndexMeta === "object") {
    const imaging = (fileIndexMeta as Record<string, unknown>)["imaging"];
    if (imaging && typeof imaging === "object") {
      if ((imaging as Record<string, unknown>)["is_imaging"] === true) {
        signals.add("metadata-flag");
      }
    }
  }

  const sm = reader.spectrumMetadata;
  if (sm && sm.length > 0) {
    const probeLimit = Math.min(sm.length, 5);
    for (let i = 0; i < probeLimit; i++) {
      const rec = safeRecord(sm, i);
      if (!rec || !rec.scans || rec.scans.length === 0) continue;
      for (const scan of rec.scans) {
        const scanMeta = scan.meta ?? {};
        // Source 1: promoted IMS position columns on scans.
        if (
          metaValue(scanMeta, IMS_POS_X_COL) !== undefined ||
          metaValue(scanMeta, IMS_POS_Y_COL) !== undefined
        ) {
          signals.add("ims-columns");
        }
        // Source 2: CV params by accession (non-promoted storage).
        if (
          scan.getParamByAccession?.(IMS_POS_X_ACC) !== undefined ||
          scan.getParamByAccession?.(IMS_POS_Y_ACC) !== undefined
        ) {
          signals.add("cv-params");
        }
      }
    }
  }

  return Array.from(signals);
}
