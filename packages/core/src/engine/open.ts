// Engine open: the file→capabilities→spectrum round-trip entry point.
//
// HARVESTED boundary: opens the vendored mzpeakts reader via the IV node-proven
// path (openBlob, src/reader/openUrl.ts), then drives the pure detection +
// adapter layer:
//   1. probeImagingSignals (the 3-signal IV probe, enumerated) + layout/encoding
//      (computeCapabilities) → buildCapabilityModel.
//   2. numChromatograms / optical count straight off the reader + index metadata.
//   3. when imaging, extractCoords + readGridGeometry → buildImagingGrid →
//      flattenGrid (passing the grid's REAL coordinateBase, never defaulting to 0).
//   4. a dense per-pixel TIC keyed y0*width+x0 from the spectrum total-ion-current
//      column (mirrors IV buildGridFast); null for non-imaging.
//
// The live `reader` is RETURNED but never serialized — the worker keeps it
// module-global and reads spectra through `readEngineSpectrum`. Only the wire
// payload (capabilities/manifest/fileMeta/stats/grid/tic/opticalImages) crosses
// the boundary.

import type {
  CapabilityModel,
  FileMeta as WireFileMeta,
  FileStats as WireFileStats,
  ImagingGridWire,
  Manifest,
  OpticalImageMeta,
} from "@mzpeak/contracts";
import { buildCapabilityModel } from "../adapt/capability";
import { wavelengthRange } from "./wavelength";
import { flattenGrid } from "../adapt/grid";
import { fileMeta, manifest as readManifest } from "../reader/fileMeta";
import { openBlob, openUrl, type Reader } from "../reader/openUrl";
import { CorruptFileError, UnsupportedEncodingError } from "../reader/errors";
import { readMsLevels } from "../reader/columns";
import { buildImagingGrid } from "../reader/grid";
import { extractCoords, readGridGeometry } from "../reader/scanCoords";
import {
  computeCapabilities,
  computeStats,
  probeImagingSignals,
} from "../reader/stats";
import type { ImagingGrid } from "../reader/imagingTypes";

// MS:1000285 = total ion current (promoted column name in the spectrum meta bag).
const TIC_COL = "MS_1000285_total_ion_current_unit_MS_1000131";

/** What the engine `open` returns. The live reader stays in-process. */
export type EngineFile = {
  reader: Reader;
  capabilities: CapabilityModel;
  manifest: Manifest;
  fileMeta: WireFileMeta;
  stats: WireFileStats;
  grid: ImagingGridWire | null;
  tic: Float32Array | null;
  opticalImages: OpticalImageMeta[];
};

/** Parse embedded optical-image descriptors from the index metadata.imaging block. */
function parseOpticalImages(imagingMeta: unknown): OpticalImageMeta[] {
  if (!imagingMeta || typeof imagingMeta !== "object") return [];
  const images = (imagingMeta as Record<string, unknown>).images;
  if (!Array.isArray(images)) return [];
  const out: OpticalImageMeta[] = [];
  for (const raw of images) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const archivePath = typeof o.archive_path === "string" ? o.archive_path : null;
    if (!archivePath) continue;
    const w = Number(o.width);
    const h = Number(o.height);
    out.push({
      archivePath,
      name: typeof o.source_name === "string" ? o.source_name : null,
      width: Number.isFinite(w) ? w : null,
      height: Number.isFinite(h) ? h : null,
      bytes: Number.isFinite(Number(o.size_bytes)) ? Number(o.size_bytes) : null,
    });
  }
  return out;
}

/** A minimal view over the top-level `spectra` Arrow Struct vector (promoted columns). */
type SpectraStruct = {
  length: number;
  getChild(name: string): { get(i: number): unknown } | null;
};

/**
 * Bulk-read the promoted per-spectrum TIC column (MS:1000285) once, vectorized — the
 * same columnar discipline the grid build uses (scanCoords.fromPromotedColumns). This
 * replaces the old per-pixel `sm.get(index)` record materialization, which made imaging
 * open O(spectrum-count) with a huge constant (I-05: a 34,840-pixel file never finished).
 * Returns `null` when the promoted column isn't available (caller falls back per-record).
 */
function readAllTics(reader: Reader): Float64Array | null {
  const sm = reader.spectrumMetadata as unknown as
    | { spectra?: SpectraStruct | null; length?: number }
    | null
    | undefined;
  const spectra = sm?.spectra;
  if (!spectra || typeof spectra.getChild !== "function") return null;
  const ticCol = spectra.getChild(TIC_COL);
  if (!ticCol) return null;
  const n = sm?.length ?? spectra.length ?? 0;
  const tics = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = ticCol.get(i);
    tics[i] = typeof v === "number" && Number.isFinite(v) ? v : NaN;
  }
  return tics;
}


/**
 * Read one spectrum's TIC from the metadata table (NaN when absent). GUARDED: some
 * vendor metadata rows throw inside the reader's record materialization (see
 * stats.ts safeRecord) — a single bad row must NOT abort the whole imaging open, so a
 * throw degrades to NaN (that pixel stays 0). Only the per-record FALLBACK path; the
 * fast path is the vectorized `readAllTics`.
 */
function readSpectrumTic(reader: Reader, index: number): number {
  const sm = reader.spectrumMetadata;
  if (!sm) return NaN;
  try {
    const rec = sm.get(index);
    const meta = (rec.meta ?? {}) as Record<string, unknown>;
    const v = meta[TIC_COL];
    return typeof v === "number" && Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

/**
 * Build a dense per-pixel TIC keyed `y0*width+x0` (IV buildGridFast semantics): for
 * each filled grid cell, look up the spectrum's total ion current. Cells with no
 * spectrum or no TIC value stay 0. Uses the vectorized column read when available
 * (fast), falling back to a guarded per-record read otherwise.
 *
 * MS1-ONLY: the TIC aggregates MS1 spectra only — a pixel whose spectrum is MS2/MSn is
 * left at 0. FALLBACK: if the grid declares NO MS1 spectrum at all (a misannotated /
 * level-0 file), every pixel contributes (mirrors the LC chrom `ticRows` rule).
 */
function buildTic(reader: Reader, grid: ImagingGrid): Float32Array {
  const tic = new Float32Array(grid.width * grid.height);
  const allTics = readAllTics(reader);
  const allLevels = readMsLevels(reader);
  // Does any grid spectrum carry MS level 1? If not, don't filter (fallback).
  let hasMs1 = false;
  if (allLevels) {
    for (const [, si] of grid.coordToSpectrumIndex) {
      if (si >= 0 && si < allLevels.length && allLevels[si] === 1) {
        hasMs1 = true;
        break;
      }
    }
  }
  const ms1Only = allLevels != null && hasMs1;
  for (const [key, spectrumIndex] of grid.coordToSpectrumIndex) {
    if (
      ms1Only &&
      !(spectrumIndex >= 0 && spectrumIndex < allLevels!.length && allLevels![spectrumIndex] === 1)
    )
      continue; // skip non-MS1 pixels when the file carries MS1 data
    const v =
      allTics && spectrumIndex >= 0 && spectrumIndex < allTics.length
        ? allTics[spectrumIndex]!
        : readSpectrumTic(reader, spectrumIndex);
    if (Number.isFinite(v) && key >= 0 && key < tic.length) tic[key] = v;
  }
  return tic;
}

/**
 * Classify an open/parse failure into the reader taxonomy so the dispatcher maps it to a
 * specific wire class (not the catch-all "internal"). UnsupportedEncodingError passes through
 * (it carries findings). A remote fetch/CORS/404 failure is tagged `network`. Anything else at
 * the open boundary means we got bytes that aren't a readable mzPeak (bad ZIP / missing index /
 * corrupt parquet) → CorruptFileError (→ "parse"). Always throws.
 */
function rethrowOpenError(e: unknown, remote: boolean): never {
  if (e instanceof UnsupportedEncodingError || e instanceof CorruptFileError) throw e;
  const msg = e instanceof Error ? e.message : String(e);
  if (remote && (e instanceof TypeError || /failed to fetch|networkerror|\bcors\b|err_|load failed|404|not found/i.test(msg))) {
    throw Object.assign(new Error(`Could not fetch the file: ${msg}`), { engineClass: "network" });
  }
  throw new CorruptFileError(msg);
}

/**
 * Open a local File/Blob and assemble the wire payload. zip.js reads the Blob LAZILY
 * (Blob.slice on demand via BlobReader) — only the ZIP directory + the Parquet pages
 * actually needed, never a whole-file read. This is the local mirror of openEngineUrl's
 * HTTP range reads: a multi-GB archive opens in metadata-time with no whole-file memory
 * cost (the old path slurped the entire file into an ArrayBuffer → OOM at ~3.5 GB).
 *
 * The production caller (the worker) ALWAYS passes a Blob, which streams through to the
 * lazy reader untouched. Raw ArrayBuffer/Uint8Array is accepted only as a test-harness
 * convenience (small in-memory fixtures) and wrapped in a Blob with no copy.
 */
export async function openEngineFile(
  src: Blob | ArrayBuffer | Uint8Array,
  _name?: string,
): Promise<EngineFile> {
  const blob = src instanceof Blob ? src : new Blob([src as unknown as BlobPart]);
  try {
    return await assembleEngineFile(await openBlob(blob));
  } catch (e) {
    rethrowOpenError(e, false); // local file → any failure is a parse/corrupt error
  }
}

/**
 * Open a remote URL and assemble the wire payload. Uses the reader's URL path
 * (HTTP RANGE reads via zip.js) — NOT a whole-file fetch — so a large remote file
 * isn't fully downloaded just to open it (review MAJOR: the dispatcher must not
 * `fetch().arrayBuffer()` the whole archive).
 */
export async function openEngineUrl(url: string | URL): Promise<EngineFile> {
  try {
    return await assembleEngineFile(await openUrl(url));
  } catch (e) {
    rethrowOpenError(e, true);
  }
}

/**
 * Assemble the wire `opened` payload from an already-open reader. Imaging grid +
 * TIC are built only when the file is detected as imaging.
 */
async function assembleEngineFile(reader: Reader): Promise<EngineFile> {
  // ── Detection + capability model ──────────────────────────────────────────
  const manifestEntries = readManifest(reader);
  const ivCaps = computeCapabilities(reader, manifestEntries); // layout/encodings/isImaging
  const imagingSignals = probeImagingSignals(reader); // 3-signal provenance

  const capabilities = buildCapabilityModel({
    imagingSignals,
    probed: true, // full probe ran (not just the index hint)
    numChromatograms: reader.numChromatograms ?? 0,
    ticColumn: "unknown", // resolved by the scan pass downstream; unknown at open
    opticalCount: 0, // filled below from the parsed optical images
    // Wavelength (UV/VIS) count is known immediately — the wavelength metadata table is
    // loaded eagerly at open (reader.init), so numWavelengthSpectra is final here.
    wavelengthCount: reader.numWavelengthSpectra ?? 0,
    layout: ivCaps.layout,
    encodings: ivCaps.encodings,
    unsupported: ivCaps.unsupported,
  });

  // ── Optical images (cheap — already in the in-memory index) ────────────────
  const opticalImages = parseOpticalImages(reader.store?.fileIndex?.metadata?.imaging);
  capabilities.optical = {
    hasOptical: opticalImages.length > 0,
    count: opticalImages.length,
  };

  // MG-11: observed wavelength range for the Summary UV/VIS band pill, materialized
  // ONCE from the first wavelength spectrum (PDA scans share one grid). One small read.
  if (capabilities.wavelength.present) {
    capabilities.wavelength.range = await wavelengthRange(reader);
  }

  // ── File metadata + stats ──────────────────────────────────────────────────
  const fm = fileMeta(reader);
  const ivStats = computeStats(reader, manifestEntries);
  const stats: WireFileStats = {
    numSpectra: ivStats.numSpectra,
    numEntities: ivStats.numEntities,
    mzRange: ivStats.mzRange,
    rtRange: null,
    msLevels: ivStats.msLevels,
    spectraPerLevel: ivStats.spectraPerLevel,
    representationCounts: ivStats.representationCounts,
  };

  // ── Imaging grid + TIC (only when imaging) ─────────────────────────────────
  let gridWire: ImagingGridWire | null = null;
  let tic: Float32Array | null = null;
  if (capabilities.imaging.isImaging) {
    const cr = extractCoords(reader);
    const geometry = readGridGeometry(reader);
    const grid = cr
      ? buildImagingGrid(cr.coords, cr.spectrumIndices, geometry, cr.strategy)
      : null;
    if (grid) {
      gridWire = flattenGrid({
        width: grid.width,
        height: grid.height,
        coordinateBase: grid.coordinateBase, // REAL base — never default to 0
        coordToSpectrumIndex: grid.coordToSpectrumIndex,
        presenceMask: grid.presenceMask,
      });
      tic = buildTic(reader, grid);
    }
  }

  return {
    reader,
    capabilities,
    manifest: manifestEntries.map((e) => ({ path: e.name, role: e.dataKind })),
    fileMeta: fm,
    stats,
    grid: gridWire,
    tic,
    opticalImages,
  };
}
