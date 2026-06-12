// Parse the `metadata.imaging` discovery block from mzpeak_index.json into a
// typed {@link ImagingInfo}. Per the mzPeak imaging spec, only `is_imaging` and
// `coordinate_base` are guaranteed; everything else (pixel grid, pixel size,
// scan geometry, and the optical `images[]` list) is optional and parsed
// defensively. This reads metadata only — no signal I/O.
import type { Reader } from "./open";
import type { ImagingInfo, OpticalImage } from "./types";

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function axisPair(v: unknown): { x: number; y: number } | null {
  const o = obj(v);
  if (!o) return null;
  const x = num(o.x);
  const y = num(o.y);
  return x !== null && y !== null ? { x, y } : null;
}

function parseImages(v: unknown): OpticalImage[] {
  if (!Array.isArray(v)) return [];
  const out: OpticalImage[] = [];
  for (const raw of v) {
    const o = obj(raw);
    if (!o) continue;
    const archivePath = str(o.archive_path);
    if (!archivePath) continue;
    out.push({
      archivePath,
      sourceName: str(o.source_name),
      mediaType: str(o.media_type),
      width: num(o.width),
      height: num(o.height),
      sizeBytes: num(o.size_bytes),
      sha256: str(o.sha256),
    });
  }
  return out;
}

/** Parse the imaging block, or return null when the file is not imaging. */
export function readImaging(reader: Reader): ImagingInfo | null {
  const meta = obj(reader.store?.fileIndex?.metadata);
  const block = meta && obj(meta.imaging);
  if (!block) return null;
  if (block.is_imaging !== true) return null;

  const pcRaw = obj(block.pixel_count);
  const pixelCount = pcRaw
    ? (() => {
        const x = num(pcRaw.x);
        const y = num(pcRaw.y);
        return x !== null && y !== null
          ? { x, y, z: num(pcRaw.z) }
          : null;
      })()
    : null;

  const mzRaw = obj(block.mz_range);
  const mzMin = mzRaw ? num(mzRaw.min) : null;
  const mzMax = mzRaw ? num(mzRaw.max) : null;

  return {
    isImaging: true,
    coordinateBase: num(block.coordinate_base),
    pixelCount,
    pixelCountSource: str(block.pixel_count_source),
    mzRange: mzMin !== null && mzMax !== null ? [mzMin, mzMax] : null,
    pixelSizeUm: axisPair(block.pixel_size_um),
    maxDimensionUm: axisPair(block.max_dimension_um),
    scanPattern: str(block.scan_pattern),
    scanType: str(block.scan_type),
    lineScanDirection: str(block.line_scan_direction),
    linescanSequence: str(block.linescan_sequence),
    images: parseImages(block.images),
  };
}
