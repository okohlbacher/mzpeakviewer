import { describe, it, expect } from "vitest";
import {
  parseOpticalImages,
  decodeTiff,
  invertAffine,
  placeOpticalOnGrid,
} from "./optical";
import { encodeRgbTiff } from "../export/tiff";

describe("parseOpticalImages", () => {
  it("returns [] for absent/malformed input", () => {
    expect(parseOpticalImages(undefined)).toEqual([]);
    expect(parseOpticalImages({})).toEqual([]);
    expect(parseOpticalImages({ images: "nope" })).toEqual([]);
  });

  it("parses entries with affine + role defaults", () => {
    const meta = {
      images: [
        {
          archive_path: "images/image_0000.tiff",
          source_name: "slide.tiff",
          media_type: "image/tiff",
          width: 100,
          height: 80,
          sha256: "x",
          size_bytes: 10,
          affine: {
            type: "affine",
            matrix: [2, 0, 1, 0, 2, 1],
            maps: "image_px -> ms_px",
            registration_quality: "assumed_full_extent",
          },
        },
        { archive_path: "images/image_0001.tiff", role: "histology" }, // sparse
        { source_name: "no-path" }, // skipped (no archive_path)
      ],
    };
    const imgs = parseOpticalImages(meta);
    expect(imgs).toHaveLength(2);
    expect(imgs[0].sourceName).toBe("slide.tiff");
    expect(imgs[0].role).toBe("optical"); // default when absent
    expect(imgs[0].affine).toEqual([2, 0, 1, 0, 2, 1]);
    expect(imgs[0].registrationQuality).toBe("assumed_full_extent");
    expect(imgs[1].role).toBe("histology");
    expect(imgs[1].affine).toBeNull();
  });
});

describe("invertAffine", () => {
  it("inverts a scale+translate affine", () => {
    const inv = invertAffine([2, 0, 1, 0, 2, 1])!;
    // forward: x_ms = 2*col + 1 → col = (x_ms - 1)/2
    expect(inv.ia).toBeCloseTo(0.5);
    expect(inv.ic).toBeCloseTo(-0.5);
    expect(inv.ie).toBeCloseTo(0.5);
    expect(inv.if).toBeCloseTo(-0.5);
  });
  it("returns null for a singular linear part", () => {
    expect(invertAffine([0, 0, 1, 0, 0, 1])).toBeNull();
  });
});

describe("decodeTiff", () => {
  it("round-trips an RGB TIFF produced by the encoder", () => {
    const w = 3;
    const h = 2;
    const r = new Float32Array([1, 0, 0, 0, 1, 0]);
    const g = new Float32Array([0, 1, 0, 0, 0, 1]);
    const b = new Float32Array([0, 0, 1, 1, 0, 0]);
    const bytes = encodeRgbTiff(r, g, b, w, h);
    const dec = decodeTiff(bytes);
    expect(dec.width).toBe(w);
    expect(dec.height).toBe(h);
    // pixel 0 was pure red (255,0,0)
    expect(dec.rgba[0]).toBe(255);
    expect(dec.rgba[1]).toBe(0);
    expect(dec.rgba[2]).toBe(0);
    expect(dec.rgba[3]).toBe(255);
  });
});

describe("placeOpticalOnGrid", () => {
  it("returns null without an affine", () => {
    const dec = { width: 2, height: 2, rgba: new Uint8ClampedArray(16) };
    expect(placeOpticalOnGrid(dec, null, 4, 4)).toBeNull();
  });

  it("places an identity-mapped image into the grid frame", () => {
    // 2×2 image, affine maps 0-based image px → 1-based ms px: x_ms = col+1.
    // matrix [1,0,1, 0,1,1] → identity + (1,1) translation.
    const rgba = new Uint8ClampedArray([
      10, 0, 0, 255, 20, 0, 0, 255, // row 0: (0,0)=10 (1,0)=20
      30, 0, 0, 255, 40, 0, 0, 255, // row 1: (0,1)=30 (1,1)=40
    ]);
    const placed = placeOpticalOnGrid({ width: 2, height: 2, rgba }, [1, 0, 1, 0, 1, 1], 2, 2)!;
    // grid cell (0,0) → ms (1,1) → image (0,0) = 10
    expect(placed[0]).toBe(10);
    // grid cell (1,1) → ms (2,2) → image (1,1) = 40
    expect(placed[(1 * 2 + 1) * 4]).toBe(40);
    expect(placed[(1 * 2 + 1) * 4 + 3]).toBe(255);
  });
});
