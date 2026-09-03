// Canonical guard for the .dta export: header math (MH+ from selected-ion m/z + charge),
// the z-default-1 and no-precursor conventions, precursor extraction from the real
// metadata-tree shapes (selected ion preferred, isolation-window fallback), and the
// number formatting the format's space-separated parsers expect.
import { describe, it, expect } from "vitest";
import { buildDta, precursorFromMeta, dtaFilename } from "./dta";

describe("buildDta", () => {
  const mz = Float64Array.from([100.5, 250.123456, 450]);
  const inten = Float32Array.from([10, 1234.5678, 3]);

  it("MS2 with charge 2: MH+ = mz*2 − 1 proton", () => {
    const text = buildDta(mz, inten, { mz: 500.75, charge: 2 });
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe(`${(500.75 * 2 - 1.00727646688).toFixed(6).replace(/0+$/, "")} 2`);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("100.5 10");
    expect(lines[2]).toBe("250.123456 1234.5677"); // f32 storage rounds the intensity
    expect(lines[3]).toBe("450 3");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("unknown charge defaults to 1 (MH+ === precursor m/z)", () => {
    const lines = buildDta(mz, inten, { mz: 452.5, charge: null }).split("\n");
    expect(lines[0]).toBe("452.5 1");
  });

  it("no precursor (MS1) writes the conventional 0 1 header", () => {
    expect(buildDta(mz, inten, null).split("\n")[0]).toBe("0 1");
  });

  it("refuses an empty spectrum", () => {
    expect(() => buildDta(new Float64Array(0), new Float32Array(0), null)).toThrow(/no data points/);
  });
});

describe("precursorFromMeta — real metadata-tree shapes", () => {
  it("prefers the selected ion (mz + chargeState), as mzpeakts materializes it", () => {
    const meta = {
      selectedIons: [{ mz: 620.831, chargeState: 2, intensity: 1e5 }],
      precursors: [{ isolationWindow: { target: 620.5, lowerOffset: 8.5, upperOffset: 8.5 } }],
    };
    expect(precursorFromMeta(meta)).toEqual({ mz: 620.831, charge: 2 });
  });

  it("falls back to the isolation-window target with unknown charge (DIA)", () => {
    const meta = { precursors: [{ isolationWindow: { target: 452.5, lowerOffset: 8.5, upperOffset: 8.5 } }] };
    expect(precursorFromMeta(meta)).toEqual({ mz: 452.5, charge: null });
  });

  it("flat/snake spellings and bigint charge are handled", () => {
    expect(precursorFromMeta({ selected_ions: [{ mz: 500.1, charge_state: 3n }] })).toEqual({ mz: 500.1, charge: 3 });
    expect(precursorFromMeta({ precursors: [{ isolation_window: { target: 400 } }] })).toEqual({ mz: 400, charge: null });
  });

  it("charge 0 / missing mz / empty trees resolve honestly", () => {
    expect(precursorFromMeta({ selectedIons: [{ mz: 500.1, chargeState: 0 }] })).toEqual({ mz: 500.1, charge: null });
    expect(precursorFromMeta({ selectedIons: [{}] })).toBeNull();
    expect(precursorFromMeta({})).toBeNull();
    expect(precursorFromMeta(null)).toBeNull();
  });
});

describe("dtaFilename", () => {
  it("stems the .mzpeak name and embeds index + facet", () => {
    expect(dtaFilename("HEK_PosOAD1.native.mzpeak", 17, "centroid")).toBe("HEK_PosOAD1.native.spec17.centroid.dta");
    expect(dtaFilename(null, 3, null)).toBe("spectrum.spec3.dta");
  });
});
