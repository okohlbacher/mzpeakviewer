import { describe, it, expect } from "vitest";
import { niceTicks, fmtTick } from "./axisTicks";

describe("fmtTick", () => {
  it("small non-integers: 2 decimals by default, 3 when requested (per-axis precision)", () => {
    expect(fmtTick(2.5)).toBe("2.50"); // WavelengthHeatmap default
    expect(fmtTick(2.5, 3)).toBe("2.500"); // mobility (1/K0) axis
    expect(fmtTick(1.234, 3)).toBe("1.234");
  });
  it("integers, large numbers, and extreme magnitudes", () => {
    expect(fmtTick(5)).toBe("5");
    expect(fmtTick(1234.5)).toBe("1,235"); // ≥1000 → rounded + grouped
    expect(fmtTick(0.0001)).toBe("1.0e-4"); // < 1e-3 → exponential
    expect(fmtTick(NaN)).toBe("");
  });
});

describe("niceTicks", () => {
  it("spans [lo,hi] with round steps", () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(5, 5, 5)).toEqual([5]); // degenerate range
  });
});
