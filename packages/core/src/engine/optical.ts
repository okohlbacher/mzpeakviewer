// Engine optical-image decode: read an embedded optical image ZIP member and decode it to RGBA.
//
// mzPeak MAY embed optical images (microscopy / histology overviews) as ZIP members
// (`images/image_NNNN.<tif|svs|png|jpg>`), described in `mzpeak_index.json` →
// `metadata.imaging.images[]`. The descriptors are parsed cheaply at open (engine/open.ts
// `parseOpticalImages`); the PIXELS are decoded lazily here, on demand, by archive path.
//
// TIFF (incl. Aperio .svs whole-slide pyramids) is read with geotiff.js through RANGE reads of
// the (stored, uncompressed) ZIP member: only the IFDs and the chosen level's strips/tiles are
// fetched — never the whole 172 MB slide — and the largest level that fits MAX_OPTICAL_PIXELS
// in a codec geotiff decodes (not JPEG 2000) is shown. PNG/JPEG decode natively
// (createImageBitmap + OffscreenCanvas, available in the worker).
//
// Nothing here imports mzpeakts (it reaches `reader.store` opaquely).

import { Uint8ArrayWriter } from "@zip.js/zip.js";
import { GeoTIFF } from "geotiff";
import type { Reader } from "../reader/openUrl";
import { readerStore, type RemoteBlob } from "./store";

/**
 * Decode guards (defense-in-depth): optical images come from an untrusted index
 * naming an arbitrary ZIP member. Cap the bytes read whole and the
 * decoded pixel count so a malformed/hostile file can't exhaust memory.
 */
export const MAX_OPTICAL_BYTES = 256 * 1024 * 1024;
export const MAX_OPTICAL_PIXELS = 64 * 1024 * 1024;

/** A decoded optical image (native pixel grid, RGBA row-major). */
export type DecodedOptical = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

const BLOCK = 1024 * 1024;

/**
 * A geotiff source over a member's bytes. IFD parsing makes many tiny reads and strips are
 * small, so reads under 4 MiB go through a 1 MiB block cache (one range request per block,
 * fetched in parallel); a larger read is fetched directly as one range.
 */
function rangeSource(blob: RemoteBlob) {
  const blocks = new Map<number, Promise<Uint8Array>>();
  const read = async (offset: number, length: number) =>
    new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + length)).arrayBuffer());
  const block = (i: number) => {
    let b = blocks.get(i);
    if (!b) blocks.set(i, (b = read(i * BLOCK, BLOCK)));
    return b;
  };
  const fetchOne = async ({ offset, length }: { offset: number; length: number }): Promise<ArrayBuffer> => {
    if (length >= 4 * BLOCK) return (await read(offset, length)).buffer as ArrayBuffer;
    const first = Math.floor(offset / BLOCK), last = Math.floor((offset + length - 1) / BLOCK);
    const got = await Promise.all(Array.from({ length: last - first + 1 }, (_, k) => block(first + k)));
    const out = new Uint8Array(length);
    got.forEach((b, k) => {
      const base = (first + k) * BLOCK;
      const from = Math.max(offset, base), to = Math.min(offset + length, base + b.length);
      if (to > from) out.set(b.subarray(from - base, to - base), from - offset);
    });
    return out.buffer;
  };
  return {
    fileSize: blob.size,
    fetchOne,
    fetch: (slices: { offset: number; length: number }[]) => Promise.all(slices.map(fetchOne)),
    fetchSlice: async (slice: { offset: number; length: number }) => ({ ...slice, data: await fetchOne(slice) }),
    close: async () => {},
  };
}

const JPEG2000 = new Set([33003, 33004, 33005, 34712]); // Aperio J2K + standard JPEG 2000
const tooLarge = (w: number, h: number) =>
  new Error(`${w}×${h} px is too large to display (limit ${MAX_OPTICAL_PIXELS / 2 ** 20} megapixels)`);

/**
 * Decode a TIFF (any level of a pyramid) to RGBA. Candidates are the images with the main
 * image's aspect ratio (a whole-slide file's label/macro images are not), within
 * MAX_OPTICAL_PIXELS, in a codec geotiff decodes; the largest that decodes wins.
 */
export async function decodeTiffRange(source: RemoteBlob | ReturnType<typeof rangeSource>): Promise<DecodedOptical> {
  const src = "fetchOne" in source ? source : rangeSource(source);
  const tiff = await GeoTIFF.fromSource(src as never);
  const levels = [];
  for (let i = 0, n = await tiff.getImageCount(); i < n; i++) {
    const im = await tiff.getImage(i);
    levels.push({ im, w: im.getWidth(), h: im.getHeight(), compression: Number(im.fileDirectory.getValue("Compression") ?? 1) });
  }
  if (levels.length === 0) throw new Error("TIFF: no images");
  const aspect = levels[0]!.w / levels[0]!.h;
  const candidates = levels
    .filter((l) => Math.abs(l.w / l.h - aspect) / aspect < 0.02 && l.w * l.h <= MAX_OPTICAL_PIXELS && !JPEG2000.has(l.compression))
    .sort((a, b) => b.w * b.h - a.w * a.h);
  if (candidates.length === 0) {
    const desc = levels.map((l) => `${l.w}×${l.h}${JPEG2000.has(l.compression) ? " JPEG 2000" : ""}`).join(", ");
    throw new Error(`no displayable level (limit ${MAX_OPTICAL_PIXELS / 2 ** 20} megapixels, JPEG 2000 unsupported): ${desc}`);
  }
  let lastErr: unknown = null;
  for (const { im, w, h } of candidates) {
    try {
      const px = await im.readRGB({ interleave: true, enableAlpha: true });
      return { width: w, height: h, rgba: toRgba8(px as ArrayLike<number>, w * h) };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Interleaved RGB or RGBA (8- or 16-bit) → RGBA8. */
function toRgba8(px: ArrayLike<number>, n: number): Uint8ClampedArray {
  const ch = px.length / n;
  if (ch !== 3 && ch !== 4) throw new Error(`TIFF: unexpected ${ch} channels`);
  const is8 = px instanceof Uint8Array || px instanceof Uint8ClampedArray;
  if (is8 && ch === 4) return new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength);
  const out = new Uint8ClampedArray(n * 4);
  if (is8) {
    for (let i = 0, o = 0, j = 0; i < n; i++, o += 4, j += 3) {
      out[o] = px[j]!; out[o + 1] = px[j + 1]!; out[o + 2] = px[j + 2]!; out[o + 3] = 255;
    }
    return out;
  }
  let max = 0; // 16-bit (or wider): scale by the image's own maximum
  for (let i = 0; i < px.length; i++) if (px[i]! > max) max = px[i]!;
  const k = 255 / (max || 1);
  for (let i = 0; i < n; i++) {
    out[i * 4] = px[i * ch]! * k;
    out[i * 4 + 1] = px[i * ch + 1]! * k;
    out[i * 4 + 2] = px[i * ch + 2]! * k;
    out[i * 4 + 3] = ch === 4 ? px[i * ch + 3]! * k : 255;
  }
  return out;
}

/** TIFF bytes already in memory → RGBA (tests, compressed ZIP members). */
export function decodeTiff(bytes: Uint8Array): Promise<DecodedOptical> {
  return decodeTiffRange(memoryBlob(bytes));
}

function memoryBlob(bytes: Uint8Array): RemoteBlob {
  return {
    size: bytes.byteLength,
    slice: (a = 0, b = bytes.byteLength) => ({ arrayBuffer: async () => bytes.slice(a, b).buffer as ArrayBuffer }),
  };
}

/** Pixel size from a PNG IHDR or a JPEG SOF header, or null when not in `head`. */
export function headerSize(head: Uint8Array, mime: string): { width: number; height: number } | null {
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (mime === "image/png") return head.length >= 24 ? { width: dv.getUint32(16), height: dv.getUint32(20) } : null;
  for (let i = 2; i + 9 < head.length; ) { // JPEG: walk the marker segments to the first SOFn
    if (head[i] !== 0xff) return null;
    const m = head[i + 1]!;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
    i += 2 + dv.getUint16(i + 2);
  }
  return null;
}

/** PNG / JPEG → RGBA with the platform decoder (worker: createImageBitmap + OffscreenCanvas). */
async function decodeNative(bytes: Uint8Array, mime: string): Promise<DecodedOptical> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined")
    throw new Error(`${mime} decoding needs a browser (createImageBitmap)`);
  const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  try {
    const { width, height } = bmp;
    if (width * height > MAX_OPTICAL_PIXELS) throw tooLarge(width, height);
    const ctx = new OffscreenCanvas(width, height).getContext("2d");
    if (!ctx) throw new Error("no 2D canvas in this context");
    ctx.drawImage(bmp, 0, 0);
    return { width, height, rgba: ctx.getImageData(0, 0, width, height).data };
  } finally {
    bmp.close();
  }
}

/**
 * Read an embedded optical image ZIP member by its archive path and decode it to RGBA.
 * TIFF/SVS: ranged reads through geotiff (see header). PNG/JPEG: pixel size checked from the
 * header, then the whole member (size-capped) decoded natively. Throws a clear error on a missing
 * or undecodable member — callers surface it as an `opticalImageError` (auxiliary, never fatal).
 */
export async function engineGetOpticalImage(reader: Reader, archivePath: string): Promise<DecodedOptical> {
  const store = readerStore(reader);
  const entries = store?.entries ?? [];
  if (entries.length === 0) throw new Error("no archive open");
  const entry = entries.find((e) => e.filename === archivePath);
  if (!entry || entry.directory || typeof entry.getData !== "function")
    throw new Error(`ZIP member not found: ${archivePath}`);

  // Ranged access needs a STORED member (mzPeak archives are uncompressed); a deflated one is
  // inflated whole, under the byte cap.
  let blob: RemoteBlob | undefined;
  if (!entry.compressionMethod && store?.open) blob = await store.open(archivePath);
  if (!blob) {
    if (Number(entry.uncompressedSize ?? 0) > MAX_OPTICAL_BYTES)
      throw new Error(`optical member too large: ${entry.uncompressedSize} bytes`);
    blob = memoryBlob(await entry.getData(new Uint8ArrayWriter()));
  }

  const src = rangeSource(blob);
  const head = new Uint8Array(await src.fetchOne({ offset: 0, length: Math.min(64 * 1024, blob.size) }));
  if ((head[0] === 0x49 && head[1] === 0x49) || (head[0] === 0x4d && head[1] === 0x4d)) return decodeTiffRange(src);
  const mime = head[0] === 0x89 && head[1] === 0x50 ? "image/png" : head[0] === 0xff && head[1] === 0xd8 ? "image/jpeg" : null;
  if (!mime) throw new Error(`unsupported optical image format: ${archivePath}`);
  const dims = headerSize(head, mime); // reject before decoding: a small file can expand enormously
  if (dims && dims.width * dims.height > MAX_OPTICAL_PIXELS) throw tooLarge(dims.width, dims.height);
  if (blob.size > MAX_OPTICAL_BYTES) throw new Error(`optical member too large: ${blob.size} bytes`);
  return decodeNative(new Uint8Array(await src.fetchOne({ offset: 0, length: blob.size })), mime);
}
