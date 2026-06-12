/**
 * Minimal TIFF encoder for ion image export.
 *
 * Supports:
 *  - Single-channel 32-bit IEEE float TIFF (encodeSingleChannelTiff)
 *  - RGB 8-bit-per-channel interleaved TIFF (encodeRgbTiff)
 *  - Browser download helper (downloadTiff)
 *
 * No external dependencies. All values are written little-endian per the 'II'
 * byte-order mark.
 */

// TIFF field type codes
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

// TIFF tag codes
const TAG_IMAGE_WIDTH = 256;
const TAG_IMAGE_LENGTH = 257;
const TAG_BITS_PER_SAMPLE = 258;
const TAG_COMPRESSION = 259;
const TAG_PHOTOMETRIC_INTERPRETATION = 262;
const TAG_STRIP_OFFSETS = 273;
const TAG_SAMPLES_PER_PIXEL = 277;
const TAG_ROWS_PER_STRIP = 278;
const TAG_STRIP_BYTE_COUNTS = 279;
const TAG_X_RESOLUTION = 282;
const TAG_Y_RESOLUTION = 283;
const TAG_RESOLUTION_UNIT = 296;
const TAG_SAMPLE_FORMAT = 339;

/** One 12-byte IFD entry, before layout is resolved. */
interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Inline value (fits in 4 bytes) or placeholder 0 when value goes to extraData. */
  inlineValue: number;
  /** Raw bytes to place in the extra-data area (when count * typeSize > 4). */
  extraData?: Uint8Array;
}

/**
 * Write a little-endian TIFF header into buf at offset 0.
 * - Byte order: 'II' (0x4949)
 * - Magic: 42 (0x002A)
 * - Offset of first IFD: ifdOffset
 */
function writeHeader(view: DataView, ifdOffset: number): void {
  view.setUint8(0, 0x49); // 'I'
  view.setUint8(1, 0x49); // 'I'
  view.setUint16(2, 42, true); // magic
  view.setUint32(4, ifdOffset, true); // offset to first IFD
}

/**
 * Lay out and write a list of IFD entries into buf.
 *
 * @param view     DataView wrapping the full output buffer
 * @param ifdOffset Byte offset in buf where the IFD starts
 * @param entries  IFD entries (already sorted by tag, ascending)
 * @param extraDataStart Byte offset where extra-data area begins (right after IFD)
 */
function writeIfd(
  view: DataView,
  ifdOffset: number,
  entries: IfdEntry[],
  extraDataStart: number,
): void {
  let pos = ifdOffset;
  view.setUint16(pos, entries.length, true);
  pos += 2;

  let extraPos = extraDataStart;

  for (const entry of entries) {
    view.setUint16(pos, entry.tag, true);
    view.setUint16(pos + 2, entry.type, true);
    view.setUint32(pos + 4, entry.count, true);

    if (entry.extraData !== undefined) {
      // Value doesn't fit in 4 bytes → write offset, copy bytes to extra area
      view.setUint32(pos + 8, extraPos, true);
      new Uint8Array(view.buffer).set(entry.extraData, extraPos);
      extraPos += entry.extraData.byteLength;
    } else {
      // Value fits inline (always written as 4 bytes, little-endian)
      view.setUint32(pos + 8, entry.inlineValue, true);
    }

    pos += 12;
  }

  // Next-IFD pointer = 0 (no more IFDs)
  view.setUint32(pos, 0, true);
}

/**
 * Build extra-data bytes for a RATIONAL field (two LONG values: numerator / denominator).
 */
function rationalBytes(numerator: number, denominator: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setUint32(0, numerator, true);
  dv.setUint32(4, denominator, true);
  return new Uint8Array(buf);
}

/**
 * Build extra-data bytes for an array of SHORT values.
 */
function shortArrayBytes(values: number[]): Uint8Array {
  const buf = new ArrayBuffer(values.length * 2);
  const dv = new DataView(buf);
  for (let i = 0; i < values.length; i++) {
    dv.setUint16(i * 2, values[i], true);
  }
  return new Uint8Array(buf);
}

/**
 * Size in bytes of a single element of the given TIFF type.
 */
function typeSize(type: number): number {
  switch (type) {
    case TYPE_SHORT:
      return 2;
    case TYPE_LONG:
      return 4;
    case TYPE_RATIONAL:
      return 8;
    default:
      return 4;
  }
}

/**
 * Determine whether an IFD entry's value fits inline (≤ 4 bytes).
 */
function fitsInline(entry: IfdEntry): boolean {
  return entry.count * typeSize(entry.type) <= 4;
}

/**
 * Compute total bytes needed for the extra-data area of a set of entries.
 */
function extraDataSize(entries: IfdEntry[]): number {
  let size = 0;
  for (const entry of entries) {
    if (!fitsInline(entry) && entry.extraData !== undefined) {
      size += entry.extraData.byteLength;
    }
  }
  return size;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a single-channel 32-bit IEEE float TIFF.
 *
 * The Float32Array data is written as-is (little-endian float32 values).
 * Pixel layout: row-major, y=0 at top (standard raster scan).
 *
 * @param data   Pixel data, indexed y*width + x, values in any float range.
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @returns      TIFF file as a Uint8Array.
 */
export function encodeSingleChannelTiff(
  data: Float32Array,
  width: number,
  height: number,
): Uint8Array {
  const pixelBytes = width * height * 4; // 4 bytes per float32 pixel

  // IFD is at offset 8 (right after the 8-byte header)
  const ifdOffset = 8;

  // Build entries (sorted by tag, ascending — TIFF spec requirement)
  // For inline SHORT values stored in the 4-byte value field, the value
  // occupies the first 2 bytes (little-endian), leaving the upper 2 as 0.
  const entries: IfdEntry[] = [
    { tag: TAG_IMAGE_WIDTH, type: TYPE_SHORT, count: 1, inlineValue: width },
    { tag: TAG_IMAGE_LENGTH, type: TYPE_SHORT, count: 1, inlineValue: height },
    { tag: TAG_BITS_PER_SAMPLE, type: TYPE_SHORT, count: 1, inlineValue: 32 },
    { tag: TAG_COMPRESSION, type: TYPE_SHORT, count: 1, inlineValue: 1 },
    {
      tag: TAG_PHOTOMETRIC_INTERPRETATION,
      type: TYPE_SHORT,
      count: 1,
      inlineValue: 1,
    }, // BlackIsZero
    // StripOffsets placeholder — filled in after layout
    {
      tag: TAG_STRIP_OFFSETS,
      type: TYPE_LONG,
      count: 1,
      inlineValue: 0 /* placeholder */,
    },
    { tag: TAG_SAMPLES_PER_PIXEL, type: TYPE_SHORT, count: 1, inlineValue: 1 },
    {
      tag: TAG_ROWS_PER_STRIP,
      type: TYPE_SHORT,
      count: 1,
      inlineValue: height,
    },
    {
      tag: TAG_STRIP_BYTE_COUNTS,
      type: TYPE_LONG,
      count: 1,
      inlineValue: pixelBytes,
    },
    {
      tag: TAG_X_RESOLUTION,
      type: TYPE_RATIONAL,
      count: 1,
      inlineValue: 0,
      extraData: rationalBytes(1, 1),
    },
    {
      tag: TAG_Y_RESOLUTION,
      type: TYPE_RATIONAL,
      count: 1,
      inlineValue: 0,
      extraData: rationalBytes(1, 1),
    },
    { tag: TAG_RESOLUTION_UNIT, type: TYPE_SHORT, count: 1, inlineValue: 1 }, // no absolute unit
    { tag: TAG_SAMPLE_FORMAT, type: TYPE_SHORT, count: 1, inlineValue: 3 }, // IEEEFP
  ];

  // IFD size: 2 (count) + 13 entries * 12 bytes + 4 (next-IFD)
  const ifdSize = 2 + entries.length * 12 + 4;
  const extraStart = ifdOffset + ifdSize;
  const extra = extraDataSize(entries);
  const dataOffset = extraStart + extra;

  // Fix up StripOffsets
  const stripOffsetsEntry = entries.find((e) => e.tag === TAG_STRIP_OFFSETS)!;
  stripOffsetsEntry.inlineValue = dataOffset;

  const totalSize = dataOffset + pixelBytes;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  writeHeader(view, ifdOffset);
  writeIfd(view, ifdOffset, entries, extraStart);

  // Copy pixel data as raw float32 bytes
  bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), dataOffset);

  return bytes;
}

/**
 * Encode an RGB 8-bit-per-channel interleaved TIFF.
 *
 * Each channel is normalised to [0, 1]; values are clamped and scaled to
 * [0, 255] uint8. Pixels are written interleaved: R₀G₀B₀ R₁G₁B₁ …
 *
 * @param r      Red channel, indexed y*width + x, values in [0, 1].
 * @param g      Green channel, same layout.
 * @param b      Blue channel, same layout.
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @returns      TIFF file as a Uint8Array.
 */
export function encodeRgbTiff(
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
): Uint8Array {
  const nPixels = width * height;
  const pixelBytes = nPixels * 3; // 3 uint8 per pixel

  // BitsPerSample = [8, 8, 8] — 3 SHORT values = 6 bytes → needs extra-data area
  const bpsData = shortArrayBytes([8, 8, 8]);
  // SampleFormat = [1, 1, 1] — UNSIGNED INTEGER, 3 SHORT values = 6 bytes
  const sfData = shortArrayBytes([1, 1, 1]);

  const ifdOffset = 8;

  const entries: IfdEntry[] = [
    { tag: TAG_IMAGE_WIDTH, type: TYPE_SHORT, count: 1, inlineValue: width },
    { tag: TAG_IMAGE_LENGTH, type: TYPE_SHORT, count: 1, inlineValue: height },
    {
      tag: TAG_BITS_PER_SAMPLE,
      type: TYPE_SHORT,
      count: 3,
      inlineValue: 0,
      extraData: bpsData,
    },
    { tag: TAG_COMPRESSION, type: TYPE_SHORT, count: 1, inlineValue: 1 },
    {
      tag: TAG_PHOTOMETRIC_INTERPRETATION,
      type: TYPE_SHORT,
      count: 1,
      inlineValue: 2,
    }, // RGB
    {
      tag: TAG_STRIP_OFFSETS,
      type: TYPE_LONG,
      count: 1,
      inlineValue: 0 /* placeholder */,
    },
    { tag: TAG_SAMPLES_PER_PIXEL, type: TYPE_SHORT, count: 1, inlineValue: 3 },
    {
      tag: TAG_ROWS_PER_STRIP,
      type: TYPE_SHORT,
      count: 1,
      inlineValue: height,
    },
    {
      tag: TAG_STRIP_BYTE_COUNTS,
      type: TYPE_LONG,
      count: 1,
      inlineValue: pixelBytes,
    },
    {
      tag: TAG_X_RESOLUTION,
      type: TYPE_RATIONAL,
      count: 1,
      inlineValue: 0,
      extraData: rationalBytes(1, 1),
    },
    {
      tag: TAG_Y_RESOLUTION,
      type: TYPE_RATIONAL,
      count: 1,
      inlineValue: 0,
      extraData: rationalBytes(1, 1),
    },
    { tag: TAG_RESOLUTION_UNIT, type: TYPE_SHORT, count: 1, inlineValue: 1 },
    {
      tag: TAG_SAMPLE_FORMAT,
      type: TYPE_SHORT,
      count: 3,
      inlineValue: 0,
      extraData: sfData,
    },
  ];

  const ifdSize = 2 + entries.length * 12 + 4;
  const extraStart = ifdOffset + ifdSize;
  const extra = extraDataSize(entries);
  const dataOffset = extraStart + extra;

  const stripOffsetsEntry = entries.find((e) => e.tag === TAG_STRIP_OFFSETS)!;
  stripOffsetsEntry.inlineValue = dataOffset;

  const totalSize = dataOffset + pixelBytes;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  writeHeader(view, ifdOffset);
  writeIfd(view, ifdOffset, entries, extraStart);

  // Write interleaved RGB pixel data
  let out = dataOffset;
  for (let k = 0; k < nPixels; k++) {
    bytes[out++] = Math.min(255, Math.max(0, Math.round(r[k] * 255)));
    bytes[out++] = Math.min(255, Math.max(0, Math.round(g[k] * 255)));
    bytes[out++] = Math.min(255, Math.max(0, Math.round(b[k] * 255)));
  }

  return bytes;
}

/**
 * Encode an RGBA byte raster (e.g. a canvas's ImageData) as an 8-bit RGB TIFF.
 * The alpha channel is dropped. Used by the generic "Download Image → TIFF"
 * export, which saves the displayed raster of any image tab.
 *
 * @param rgba   Interleaved RGBA bytes, length width*height*4 (row-major).
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 */
export function encodeRgba8Tiff(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const n = width * height;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    r[k] = rgba[k * 4] / 255;
    g[k] = rgba[k * 4 + 1] / 255;
    b[k] = rgba[k * 4 + 2] / 255;
  }
  return encodeRgbTiff(r, g, b, width, height);
}

/**
 * Trigger a browser download of a TIFF file.
 *
 * Creates a Blob with MIME type `image/tiff`, synthesises a temporary object
 * URL, programmatically clicks a hidden anchor, then revokes the URL.
 *
 * This function is a no-op in environments where `document` is not available
 * (e.g. Node.js / Vitest / SSR), so it is safe to import unconditionally.
 *
 * @param data     TIFF bytes produced by encodeSingleChannelTiff or encodeRgbTiff.
 * @param filename Suggested filename for the download (e.g. `"ion-image.tiff"`).
 */
export function downloadTiff(data: Uint8Array, filename: string): void {
  if (typeof document === 'undefined') {
    return; // no-op in non-browser environments
  }
  const blob = new Blob([data.buffer as ArrayBuffer], { type: 'image/tiff' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
