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
  it("decodes a tiny synthetic TIFF to RGBA of the right shape", () => {
    const W = 4;
    const H = 3;
    const tiff = syntheticTiff(W, H, [200, 100, 50, 255]);
    const decoded = decodeTiff(tiff);
    expect(decoded.width).toBe(W);
    expect(decoded.height).toBe(H);
    expect(decoded.rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(decoded.rgba.length).toBe(W * H * 4);
    // alpha channel of a solid opaque image is 255 everywhere
    for (let i = 3; i < decoded.rgba.length; i += 4) {
      expect(decoded.rgba[i]).toBe(255);
    }
  });

  it("throws a clear error on undecodable (non-TIFF) bytes", () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(() => decodeTiff(garbage)).toThrow();
  });

  // (3) Missing-path contract — engineGetOpticalImage throws cleanly.
  it("throws 'ZIP member not found' for a missing archive path", async () => {
    await expect(
      engineGetOpticalImage(opened.reader, "images/does_not_exist.tiff"),
    ).rejects.toThrow(/not found|no archive open/);
  }, 120_000);
});
