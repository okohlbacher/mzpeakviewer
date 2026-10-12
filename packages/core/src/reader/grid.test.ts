// The imaging grid is the OCCUPIED part of the declared extent. The GBM run Test_P15_r2 declares
// 735×259 pixels but acquired only x 675–735, y 177–259; drawn on the declared canvas the tissue
// was a small patch in a corner of a black image. The canvas (what optical registrations refer
// to) and the crop offset travel with the grid.
import { describe, it, expect } from "vitest";
import { buildImagingGrid } from "./grid";
import { flattenGrid } from "../adapt/grid";

const origin = (g: NonNullable<ReturnType<typeof buildImagingGrid>>) => {
  const w = flattenGrid(g);
  return [w.originX, w.originY];
};

const geo = (x: number, y: number) =>
  ({ pixelCount: { x, y }, pixelSizeUm: null, coordinateBase: 1, geometrySource: "discovery-block" }) as const;

describe("buildImagingGrid crops to the occupied pixels", () => {
  it("declared extent: grid = bounding box, origin = its first pixel, canvas kept", () => {
    const coords = [{ x: 675, y: 177 }, { x: 677, y: 177 }, { x: 676, y: 178 }, { x: 900, y: 10 }];
    const g = buildImagingGrid(coords, [10, 11, 12, 13], geo(735, 259), "promoted-columns")!;
    expect([g.width, g.height]).toEqual([3, 2]);
    expect(origin(g)).toEqual([675, 177]);
    expect(g.canvas).toEqual({ width: 735, height: 259, offsetX: 674, offsetY: 176 });
    expect([...g.coordToSpectrumIndex]).toEqual([[0, 10], [2, 11], [4, 12]]); // local keys y*3+x
    expect(Array.from(g.presenceMask)).toEqual([1, 0, 1, 0, 1, 0]);
    expect(g.diagnostics.oobCount).toBe(1); // (900, 10) is outside the declared 735×259
  });

  it("no declared extent: the min side is cropped too", () => {
    const g = buildImagingGrid([{ x: 5, y: 7 }, { x: 6, y: 7 }], [0, 1], null, "promoted-columns")!;
    expect([g.width, g.height, ...origin(g)]).toEqual([2, 1, 5, 7]);
    expect(g.canvas).toEqual({ width: 6, height: 7, offsetX: 4, offsetY: 6 });
  });
});
