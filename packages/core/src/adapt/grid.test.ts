import { describe, it, expect } from "vitest";
import { flattenGrid, rebuildCoordMap, type GridInput } from "./grid";

// A 3×2 grid (width=3, height=2). coordKey = y0*width + x0.
// Filled cells: (x0,y0) = (0,0)->key 0, (2,0)->key 2, (1,1)->key 4.
function makeInput(overrides: Partial<GridInput> = {}): GridInput {
  const presenceMask = new Uint8Array(6); // 3*2
  presenceMask[0] = 1;
  presenceMask[2] = 1;
  presenceMask[4] = 1;
  return {
    width: 3,
    height: 2,
    coordinateBase: 1,
    coordToSpectrumIndex: new Map<number, number>([
      [0, 10],
      [2, 20],
      [4, 30],
    ]),
    presenceMask,
    ...overrides,
  };
}

describe("flattenGrid", () => {
  it("flattens the Map into parallel Int32Arrays and preserves dimensions", () => {
    const wire = flattenGrid(makeInput());
    expect(wire.width).toBe(3);
    expect(wire.height).toBe(2);
    expect(wire.originX).toBe(1);
    expect(wire.originY).toBe(1);
    expect(wire.coordKey).toBeInstanceOf(Int32Array);
    expect(wire.spectrumIndex).toBeInstanceOf(Int32Array);
    expect(wire.coordKey.length).toBe(3);
    expect(wire.spectrumIndex.length).toBe(3);
  });

  it("preserves the presenceMask (same bytes)", () => {
    const input = makeInput();
    const wire = flattenGrid(input);
    expect(wire.presenceMask).toBe(input.presenceMask); // passthrough, not copied
    expect(Array.from(wire.presenceMask)).toEqual([1, 0, 1, 0, 1, 0]);
  });

  it("origin carries coordinateBase (1-based grids: base 1; not silently 0)", () => {
    expect(flattenGrid(makeInput({ coordinateBase: 1 })).originX).toBe(1);
    expect(flattenGrid(makeInput({ coordinateBase: 1 })).originY).toBe(1);
    const base0 = flattenGrid(makeInput({ coordinateBase: 0 }));
    expect(base0.originX).toBe(0);
    expect(base0.originY).toBe(0);
  });

  it("explicit originX/Y override coordinateBase", () => {
    const wire = flattenGrid(makeInput({ coordinateBase: 1, originX: 5, originY: 7 }));
    expect(wire.originX).toBe(5);
    expect(wire.originY).toBe(7);
  });

  it("accepts an array of entries as well as a Map", () => {
    const wire = flattenGrid(
      makeInput({
        coordToSpectrumIndex: [
          [0, 10],
          [2, 20],
          [4, 30],
        ],
      }),
    );
    expect(rebuildCoordMap(wire)).toEqual(
      new Map([
        [0, 10],
        [2, 20],
        [4, 30],
      ]),
    );
  });
});

describe("flatten → rebuild round-trip", () => {
  it("rebuildCoordMap(flattenGrid(input)) equals the original Map", () => {
    const input = makeInput();
    const original = input.coordToSpectrumIndex as Map<number, number>;
    const rebuilt = rebuildCoordMap(flattenGrid(input));
    expect(rebuilt).toEqual(original);
    expect(rebuilt.get(0)).toBe(10);
    expect(rebuilt.get(2)).toBe(20);
    expect(rebuilt.get(4)).toBe(30);
  });

  it("round-trips an empty grid (no filled cells)", () => {
    const wire = flattenGrid(makeInput({ coordToSpectrumIndex: new Map() }));
    expect(wire.coordKey.length).toBe(0);
    expect(rebuildCoordMap(wire).size).toBe(0);
  });
});
