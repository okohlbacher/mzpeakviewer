import { describe, it, expect } from "vitest";
import { parseRtRange } from "./rtRange";

describe("parseRtRange", () => {
  it("both blank → valid, no range (full run)", () => {
    expect(parseRtRange("", "")).toEqual({ valid: true });
    expect(parseRtRange("  ", " ")).toEqual({ valid: true });
  });
  it("both finite with lo<hi → valid range", () => {
    expect(parseRtRange("60", "180")).toEqual({ valid: true, range: [60, 180] });
  });
  it("partial or lo>=hi or garbage → invalid", () => {
    expect(parseRtRange("60", "")).toEqual({ valid: false });
    expect(parseRtRange("", "180")).toEqual({ valid: false });
    expect(parseRtRange("180", "60")).toEqual({ valid: false });
    expect(parseRtRange("60", "60")).toEqual({ valid: false });
    expect(parseRtRange("abc", "180")).toEqual({ valid: false });
  });
});
