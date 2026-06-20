// Engine optical-image decode: read an embedded optical TIFF ZIP member and decode
// it to RGBA pixels.
//
// Two parts: the TIFF→RGBA decode (`decodeTiff`, utif2) with size/pixel decode guards,
// and the ZIP-member read (find the entry by archive path, narrow to a FILE entry with
// getData, inflate via Uint8ArrayWriter).
//
// mzPeak MAY embed optical images (microscopy / histology overviews) as separate
// TIFF ZIP members (`images/image_NNNN.tiff`), described in `mzpeak_index.json`
// → `metadata.imaging.images[]`. The descriptors are parsed cheaply at open
// (engine/open.ts `parseOpticalImages` → OpticalImageMeta[]); the PIXELS are decoded
// lazily here, on demand, by archive path.
//
// The reader's `store.entries` are the raw zip.js entries; only this engine function
// and open.ts reach into `reader.store`. Nothing here imports mzpeakts (it reaches
// `reader.store` opaquely).

import { Uint8ArrayWriter } from "@zip.js/zip.js";
import * as UTIF from "utif2";
import type { Reader } from "../reader/openUrl";

/**
 * Decode guards (defense-in-depth): optical images come from an untrusted index
 * naming an arbitrary ZIP member. Cap the raw byte size and
 * decoded pixel count so a malformed/hostile file can't exhaust memory. ~256 MB /
 * 64 Mpx are generous for real microscopy overviews while bounding the worst case.
 */
export const MAX_OPTICAL_BYTES = 256 * 1024 * 1024;
export const MAX_OPTICAL_PIXELS = 64 * 1024 * 1024;

/** A decoded optical image (native pixel grid, RGBA row-major). */
export type DecodedOptical = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

/**
 * Decode a TIFF byte blob to RGBA via utif2. Handles the common baseline subtypes
 * (8/16-bit grayscale,
 * 8-bit RGB(A), palette, packbits/LZW) that utif2 supports. Throws a clear error on
 * an oversized or undecodable blob; the caller surfaces it as a graceful optical
 * error (optical images are auxiliary, never fatal to the load).
 */
export function decodeTiff(bytes: Uint8Array): DecodedOptical {
  if (bytes.byteLength > MAX_OPTICAL_BYTES)
    throw new Error(`TIFF too large: ${bytes.byteLength} bytes (cap ${MAX_OPTICAL_BYTES})`);
  // utif2 wants a standalone ArrayBuffer of exactly the image bytes. Copy into a
  // fresh buffer so decode/decodeImage share one buffer and IFD offsets stay valid.
  const ab = new Uint8Array(bytes).buffer as ArrayBuffer;
  const ifds = UTIF.decode(ab);
  if (!ifds || ifds.length === 0) throw new Error("TIFF: no IFDs");
  const ifd = ifds[0]!;
  // Pre-decode pixel cap from raw IFD tags (ImageWidth=256, ImageLength=257), which
  // `decode` populates before the (expensive) `decodeImage` step.
  const tag = (t: unknown): number => (Array.isArray(t) ? Number(t[0]) : Number(t));
  const w0 = tag((ifd as Record<string, unknown>).t256);
  const h0 = tag((ifd as Record<string, unknown>).t257);
  if (Number.isFinite(w0) && Number.isFinite(h0) && w0 * h0 > MAX_OPTICAL_PIXELS)
    throw new Error(`TIFF too large: ${w0}×${h0} px (cap ${MAX_OPTICAL_PIXELS})`);
  UTIF.decodeImage(ab, ifd);
  // Re-validate decoded dimensions BEFORE materializing RGBA — a malformed TIFF can
  // hide/mutate its size past the pre-decode tag check.
  const width = ifd.width;
  const height = ifd.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error("TIFF: invalid decoded dimensions");
  if (width * height > MAX_OPTICAL_PIXELS)
    throw new Error(`TIFF too large: ${width}×${height} px (cap ${MAX_OPTICAL_PIXELS})`);
  const rgbaArr = UTIF.toRGBA8(ifd); // Uint8Array, RGBA row-major
  return {
    width,
    height,
    rgba: new Uint8ClampedArray(rgbaArr.buffer, rgbaArr.byteOffset, rgbaArr.byteLength),
  };
}

/** A raw zip.js file entry exposing the fields the optical read needs. */
type ZipFileEntry = {
  filename: string;
  directory?: boolean;
  uncompressedSize?: number;
  getData?: (writer: unknown) => Promise<Uint8Array>;
};

/** Reach the raw zip.js entries off the opaque reader's store. */
function readerEntries(reader: Reader): ZipFileEntry[] {
  const store = (reader as unknown as { store?: { entries?: ZipFileEntry[] } }).store;
  const entries = store?.entries;
  return Array.isArray(entries) ? entries : [];
}

/**
 * Read an embedded optical TIFF ZIP member by its archive path and decode it to RGBA.
 *
 * Find the entry by `archivePath`, narrow it to a FILE entry exposing `getData`
 * (zip.js Entry is FileEntry | DirectoryEntry — only
 * file entries inflate), reject an oversized member BEFORE inflating it (so a hostile
 * index can't name a huge member and exhaust memory), inflate via `Uint8ArrayWriter`,
 * then decode via {@link decodeTiff}.
 *
 * Throws a clear error when the member is missing (`no archive open` / `ZIP member not
 * found`) or undecodable — callers surface it as an `opticalImageError` (auxiliary,
 * never fatal to the load).
 */
export async function engineGetOpticalImage(
  reader: Reader,
  archivePath: string,
): Promise<DecodedOptical> {
  const entries = readerEntries(reader);
  if (entries.length === 0) throw new Error("no archive open");
  const entry = entries.find((e) => e.filename === archivePath);
  if (!entry || entry.directory || typeof entry.getData !== "function")
    throw new Error(`ZIP member not found: ${archivePath}`);
  // Defense-in-depth: reject an oversized member BEFORE inflating it.
  if (typeof entry.uncompressedSize === "number" && entry.uncompressedSize > MAX_OPTICAL_BYTES)
    throw new Error(`optical member too large: ${entry.uncompressedSize} bytes`);
  const bytes: Uint8Array = await entry.getData(new Uint8ArrayWriter());
  return decodeTiff(bytes);
}
