// optical.ts — optical-image support (UAT-r3 / ADD-01, imaging-spec v0.5 Edit 7).
//
// mzPeak v0.5 MAY embed optical images (microscopy / histology overviews) as
// separate TIFF ZIP members `images/image_NNNN.tiff`, described in
// `mzpeak_index.json` → `metadata.imaging.images[]`. Each carries an `affine`
// display hint mapping 0-based image pixel centres onto the 1-based, top-left,
// y-down MS pixel grid:  (x_ms, y_ms) = (a·col + b·row + c, d·col + e·row + f).
//
// This module is the pure, DOM-free core: parse the images[] block, decode a
// TIFF blob to RGBA (via utif2), invert the affine, and resample the optical
// image into the MS grid frame so it composites directly with ion images.
import * as UTIF from "utif2";

/** Per-image descriptive metadata from `metadata.imaging.images[]`. */
export interface OpticalImageMeta {
  archivePath: string;
  sourceName: string;
  mediaType: string;
  width: number;
  height: number;
  /** optical | overview | histology | derived-MS-image | fluorescence (default optical). */
  role: string;
  derivedSubtype?: string;
  modality?: string;
  /** 6-param affine [a,b,c,d,e,f], image_px → ms_px; null when absent/invalid. */
  affine: [number, number, number, number, number, number] | null;
  /** e.g. "assumed_full_extent" — a coarse display hint, NOT true registration. */
  registrationQuality?: string;
  /** SHA-256 hex of the stored bytes (integrity; spec mismatch = WARNING). */
  sha256?: string;
  /** Declared stored size in bytes (used as a pre-decode size sanity cap). */
  sizeBytes?: number;
}

/**
 * Decode guards (defense-in-depth): optical images come from an untrusted index
 * naming an arbitrary ZIP member. Cap the raw byte size and decoded pixel count
 * so a malformed/hostile file can't exhaust browser memory. ~256 MB / 64 Mpx are
 * generous for real microscopy overviews while bounding the worst case.
 */
export const MAX_OPTICAL_BYTES = 256 * 1024 * 1024;
export const MAX_OPTICAL_PIXELS = 64 * 1024 * 1024;

/** A decoded optical image (native pixel grid, RGBA row-major). */
export interface DecodedOptical {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/**
 * Parse the `metadata.imaging.images[]` block into OpticalImageMeta[]. Defensive:
 * mzPeak is format-unstable, so every field is probed with fallbacks and a
 * malformed entry is skipped rather than throwing. Returns [] when absent.
 */
export function parseOpticalImages(imagingMeta: unknown): OpticalImageMeta[] {
  if (!imagingMeta || typeof imagingMeta !== "object") return [];
  const images = (imagingMeta as Record<string, unknown>).images;
  if (!Array.isArray(images)) return [];

  const out: OpticalImageMeta[] = [];
  for (const raw of images) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const archivePath = typeof o.archive_path === "string" ? o.archive_path : null;
    if (!archivePath) continue;
    const width = Number(o.width);
    const height = Number(o.height);

    let affine: OpticalImageMeta["affine"] = null;
    let registrationQuality: string | undefined;
    const aff = o.affine as Record<string, unknown> | undefined;
    if (aff && Array.isArray(aff.matrix) && aff.matrix.length === 6) {
      const m = aff.matrix.map(Number);
      if (m.every((v) => Number.isFinite(v))) {
        affine = m as [number, number, number, number, number, number];
      }
      if (typeof aff.registration_quality === "string")
        registrationQuality = aff.registration_quality;
    }

    out.push({
      archivePath,
      sourceName: typeof o.source_name === "string" ? o.source_name : archivePath,
      mediaType: typeof o.media_type === "string" ? o.media_type : "image/tiff",
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
      role: typeof o.role === "string" ? o.role : "optical",
      derivedSubtype: typeof o.derived_subtype === "string" ? o.derived_subtype : undefined,
      modality: typeof o.modality === "string" ? o.modality : undefined,
      affine,
      registrationQuality,
      sha256: typeof o.sha256 === "string" ? o.sha256 : undefined,
      sizeBytes: Number.isFinite(Number(o.size_bytes)) ? Number(o.size_bytes) : undefined,
    });
  }
  return out;
}

/**
 * Decode a TIFF blob to RGBA via utif2. Handles the common baseline subtypes
 * (8/16-bit grayscale, 8-bit RGB(A), palette, packbits/LZW) that utif2 supports.
 * Throws on an undecodable blob; callers surface a graceful "unsupported" notice.
 */
export function decodeTiff(bytes: Uint8Array): DecodedOptical {
  if (bytes.byteLength > MAX_OPTICAL_BYTES)
    throw new Error(`TIFF too large: ${bytes.byteLength} bytes (cap ${MAX_OPTICAL_BYTES})`);
  // utif2 wants a standalone ArrayBuffer of exactly the image bytes. Copy into a
  // fresh buffer (not SharedArrayBuffer) so decode/decodeImage share one buffer
  // and the IFD offsets stay consistent.
  const ab = new Uint8Array(bytes).buffer as ArrayBuffer;
  const ifds = UTIF.decode(ab);
  if (!ifds || ifds.length === 0) throw new Error("TIFF: no IFDs");
  const ifd = ifds[0];
  // Pre-decode pixel cap from the raw IFD tags (ImageWidth=256, ImageLength=257),
  // which `decode` populates before the (expensive) `decodeImage` step.
  const tag = (t: unknown): number => (Array.isArray(t) ? Number(t[0]) : Number(t));
  const w0 = tag((ifd as Record<string, unknown>).t256);
  const h0 = tag((ifd as Record<string, unknown>).t257);
  if (Number.isFinite(w0) && Number.isFinite(h0) && w0 * h0 > MAX_OPTICAL_PIXELS)
    throw new Error(`TIFF too large: ${w0}×${h0} px (cap ${MAX_OPTICAL_PIXELS})`);
  UTIF.decodeImage(ab, ifd);
  // Re-validate the decoded dimensions BEFORE materializing RGBA — a malformed
  // TIFF can hide/mutate its size past the pre-decode tag check (Codex r4-#6).
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

/**
 * Invert a 6-param affine [a,b,c,d,e,f] (the 2×2 linear part a,b / d,e with
 * translation c,f). Returns null when the linear part is singular.
 */
export function invertAffine(
  m: [number, number, number, number, number, number],
): { ia: number; ib: number; ic: number; id: number; ie: number; if: number } | null {
  const [a, b, c, d, e, f] = m;
  const det = a * e - b * d;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  // [a b]^-1 = 1/det [ e -b; -d a ]
  const ia = e * inv;
  const ib = -b * inv;
  const id = -d * inv;
  const ie = a * inv;
  // translation: -A^-1 · t
  const ic = -(ia * c + ib * f);
  const iff = -(id * c + ie * f);
  return { ia, ib, ic, id, ie, if: iff };
}

/**
 * Resample a decoded optical image into the MS grid frame using its affine.
 *
 * For each MS grid cell (col0, row0) [0-based array index], the corresponding
 * 1-based MS pixel centre is (col0+1, row0+1). We invert the affine to find the
 * source image pixel and nearest-sample its RGBA. Cells whose source falls
 * outside the optical image are left fully transparent (alpha 0).
 *
 * Returns RGBA of length gridW*gridH*4, or null when the affine is missing or
 * singular (caller then shows the optical image standalone, unregistered).
 */
export function placeOpticalOnGrid(
  decoded: DecodedOptical,
  affine: [number, number, number, number, number, number] | null,
  gridW: number,
  gridH: number,
): Uint8ClampedArray | null {
  if (!affine) return null;
  const inv = invertAffine(affine);
  if (!inv) return null;

  const out = new Uint8ClampedArray(gridW * gridH * 4); // all transparent
  const { width: iw, height: ih, rgba } = decoded;

  for (let row0 = 0; row0 < gridH; row0++) {
    for (let col0 = 0; col0 < gridW; col0++) {
      const xMs = col0 + 1; // 1-based MS pixel coordinate
      const yMs = row0 + 1;
      const col = inv.ia * xMs + inv.ib * yMs + inv.ic;
      const row = inv.id * xMs + inv.ie * yMs + inv.if;
      const sx = Math.round(col);
      const sy = Math.round(row);
      if (sx < 0 || sx >= iw || sy < 0 || sy >= ih) continue;
      const si = (sy * iw + sx) * 4;
      const di = (row0 * gridW + col0) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return out;
}
