import { describe, it, expect } from "vitest";

import { classifyOpticalBand } from "./opticalBand";

describe("classifyOpticalBand", () => {
  it("classifies UV ranges", () => {
    expect(classifyOpticalBand(200, 400)).toBe("UV");
    expect(classifyOpticalBand(209.95, 399.95)).toBe("UV");
  });

  it("classifies VIS ranges", () => {
    expect(classifyOpticalBand(400, 700)).toBe("VIS");
    expect(classifyOpticalBand(450, 650)).toBe("VIS");
  });

  it("classifies ranges that cross the UV/VIS divide", () => {
    expect(classifyOpticalBand(250, 600)).toBe("UV/VIS");
    expect(classifyOpticalBand(399, 401)).toBe("UV/VIS");
  });

  it("returns null for invalid ranges", () => {
    expect(classifyOpticalBand(Number.NaN, 400)).toBeNull();
    expect(classifyOpticalBand(500, 400)).toBeNull();
    expect(classifyOpticalBand(-10, 0)).toBeNull();
  });
});
