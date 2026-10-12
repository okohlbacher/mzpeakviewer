// GOLDEN NODE TEST — the optical-image decode path. Gates engine/optical.ts.
//
// FIXTURE REALITY: the bundled imaging.mzpeak has NO embedded optical images
// (mzpeak_index.json → metadata.imaging has no `images[]` block; openEngineFile
// returns opticalImages.length === 0). So there is NO real optical member to decode
// against. This test therefore:
//   1. ASSERTS the fixture has no optical images (documents the skip reason) and
//      it.skip's the real-member decode with a clear console note.
//   2. UNIT-tests `decodeTiff` on a TINY SYNTHETIC TIFF (encoded via utif2's own
//      `encodeImage`, then round-tripped through `decodeTiff`) — a true decode of
//      real TIFF bytes, just not from the fixture.
//   3. ASSERTS `engineGetOpticalImage` THROWS CLEANLY on a missing archive path
//      (the "member not found" path) so the error contract is pinned.
//
// If a future imaging fixture DOES carry optical images, test (1) flips from skip to a
// real decode (width>0, height>0, rgba.length === width*height*4) automatically.

import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as UTIF from "utif2";

import { openEngineFile, type EngineFile } from "./open";
import { decodeTiff, engineGetOpticalImage } from "./optical";

const FIXTURE = fileURLToPath(
  new URL("../../test/fixtures/imaging.mzpeak", import.meta.url),
);

/** Encode a tiny w×h solid-color RGBA image to TIFF bytes via utif2 (real bytes). */
function syntheticTiff(w: number, h: number, rgba: [number, number, number, number]): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = rgba[0];
    px[i * 4 + 1] = rgba[1];
    px[i * 4 + 2] = rgba[2];
    px[i * 4 + 3] = rgba[3];
  }
  const ab = UTIF.encodeImage(px, w, h);
  return new Uint8Array(ab);
}

describe("engine optical-image decode", () => {
  let opened: EngineFile;

  beforeAll(async () => {
    const bytes = await readFile(FIXTURE);
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    opened = await openEngineFile(ab, "imaging.mzpeak");
  }, 120_000);

  // (1) Real-member decode — present only if the fixture carries optical images.
  it("decodes the first embedded optical image when the fixture has one", async () => {
    const optical = opened.opticalImages;
    if (optical.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[optical.golden] imaging.mzpeak has NO embedded optical images — " +
          "real-member decode skipped; synthetic-TIFF + missing-path tests cover the decoder.",
      );
      // mark as skipped without failing the suite (Vitest has no runtime it.skip()
      // mid-test; assert the documented condition and return)
      expect(optical.length).toBe(0);
      return;
    }
    const first = optical[0]!;
    const decoded = await engineGetOpticalImage(opened.reader, first.archivePath);
    expect(decoded.width).toBeGreaterThan(0);
    expect(decoded.height).toBeGreaterThan(0);
    expect(decoded.rgba.length).toBe(decoded.width * decoded.height * 4);
  }, 120_000);

  // (2) Synthetic-TIFF decode — real TIFF bytes, exercises decodeTiff end-to-end.
  it("decodes a tiny synthetic TIFF to RGBA of the right shape", async () => {
    const W = 4;
    const H = 3;
    const tiff = syntheticTiff(W, H, [200, 100, 50, 255]);
    const decoded = await decodeTiff(tiff);
    expect(decoded.width).toBe(W);
    expect(decoded.height).toBe(H);
    expect(decoded.rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(decoded.rgba.length).toBe(W * H * 4);
    // alpha channel of a solid opaque image is 255 everywhere
    for (let i = 3; i < decoded.rgba.length; i += 4) {
      expect(decoded.rgba[i]).toBe(255);
    }
  });

  it("throws a clear error on undecodable (non-TIFF) bytes", async () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    await expect(decodeTiff(garbage)).rejects.toThrow();
  });

  // (3) Missing-path contract — engineGetOpticalImage throws cleanly.
  it("throws 'ZIP member not found' for a missing archive path", async () => {
    await expect(
      engineGetOpticalImage(opened.reader, "images/does_not_exist.tiff"),
    ).rejects.toThrow(/not found|no archive open/);
  }, 120_000);
});

// A whole-slide image (an Aperio .svs: 34,199×22,614 px JPEG 2000 base level, 172 MB, in the
// GBM imaging run Test_P15_r2) has smaller pyramid levels. The fixture models it: level 0 is
// 8300×8300 (over the 64 MP cap, deflate), level 1 128×128 (same aspect), then a 64×32 "label".
describe("optical: a pyramidal TIFF shows its largest displayable level, read by range", () => {
  it("decodes level 1 (largest within the cap, same aspect), not level 0 or the label", async () => {
    const { decodeTiffRange } = await import("./optical");
    const bytes = new Uint8Array(await readFile(fileURLToPath(new URL("../../test/fixtures/optical-pyramid.tif", import.meta.url))));
    let read = 0;
    const blob = { size: bytes.length, slice: (a: number, b: number) => ({ arrayBuffer: async () => { read += b - a; return bytes.slice(a, b).buffer; } }) };
    const d = await decodeTiffRange(blob);
    expect([d.width, d.height]).toEqual([128, 128]);
    // the gradient: R = 2·x, G = 2·y, B = 77
    const at = (x: number, y: number) => Array.from(d.rgba.slice((y * 128 + x) * 4, (y * 128 + x) * 4 + 4));
    expect(at(10, 20)).toEqual([20, 40, 77, 255]);
    expect(read).toBeGreaterThan(0); // (on the real 172 MB .svs: 1.6 MiB read, 7 range reads)
  });
});

describe("optical: PNG/JPEG pixel size is read from the header, before any decode", () => {
  it("PNG IHDR and JPEG SOF0 (after an APP0 segment)", async () => {
    const { headerSize } = await import("./optical");
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 40000);
    new DataView(png.buffer).setUint32(20, 30000);
    expect(headerSize(png, "image/png")).toEqual({ width: 40000, height: 30000 });
    // SOI, APP0 (length 16), SOF0: length 17, precision 8, height 300, width 400
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x01, 0x2c, 0x01, 0x90, 3, 0, 0]);
    expect(headerSize(jpg, "image/jpeg")).toEqual({ width: 400, height: 300 });
  });
});
