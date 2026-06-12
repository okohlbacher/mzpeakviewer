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
import { flattenGrid } from "../adapt/grid";
import { fileMeta, manifest as readManifest } from "../reader/fileMeta";
import { openBlob, type Reader } from "../reader/openUrl";
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

function toBlob(bytes: ArrayBuffer | Uint8Array): Blob {
  // mzpeakts reads via zip.js BlobReader; wrap the bytes in a Blob (node-proven path).
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Copy into a fresh ArrayBuffer-backed view so the BlobPart type is satisfied.
  return new Blob([u8.slice().buffer]);
}

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

/** Read the per-spectrum total ion current from the metadata table (NaN when absent). */
function readSpectrumTic(reader: Reader, index: number): number {
  const sm = reader.spectrumMetadata;
  if (!sm) return NaN;
  const rec = sm.get(index);
  const meta = (rec.meta ?? {}) as Record<string, unknown>;
  const v = meta[TIC_COL];
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}

/**
 * Build a dense per-pixel TIC keyed `y0*width+x0` (IV buildGridFast semantics): for
 * each filled grid cell, look up the spectrum's total ion current. Cells with no
 * spectrum or no TIC value stay 0.
 */
function buildTic(reader: Reader, grid: ImagingGrid): Float32Array {
  const tic = new Float32Array(grid.width * grid.height);
  for (const [key, spectrumIndex] of grid.coordToSpectrumIndex) {
    const v = readSpectrumTic(reader, spectrumIndex);
    if (Number.isFinite(v) && key >= 0 && key < tic.length) tic[key] = v;
  }
  return tic;
}

/**
 * Open `bytes` as an mzPeak file and assemble the wire `opened` payload.
 * Imaging grid + TIC are built only when the file is detected as imaging.
 */
export async function openEngineFile(
  bytes: ArrayBuffer | Uint8Array,
  _name?: string,
): Promise<EngineFile> {
  const reader = await openBlob(toBlob(bytes));

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
