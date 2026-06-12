import { describe, it, expect } from "vitest";
import { parsePair, serializeViewParams, parseViewParams, type ViewState } from "./shareView";

const base: ViewState = {
  sourceUrl: "https://host/x.mzpeak",
  tab: "summary",
  selectedIndex: null,
  selectedId: null,
  msLevelFilter: null,
  chromMode: "tic",
  xic: null,
  chromStoredId: null,
  chromTimeRange: null,
  spectrumZoom: null,
};
const qs = (s: ViewState) => serializeViewParams(s).toString();

describe("serializeViewParams", () => {
  it("emits a bare file link for the default view", () => {
    expect(qs(base)).toBe("file=https%3A%2F%2Fhost%2Fx.mzpeak");
  });

  it("prefers native scan number over index when the id carries one", () => {
    const p = parseViewParams(
      "?" + qs({ ...base, tab: "spectra", selectedIndex: 2, selectedId: "controllerType=0 scan=229" }),
    );
    expect(p.tab).toBe("spectra");
    expect(p.scan).toBe("229");
    expect(p.spectrum).toBeUndefined();
  });

  it("falls back to index when the id has no scan number (imaging)", () => {
    const p = parseViewParams("?" + qs({ ...base, tab: "spectra", selectedIndex: 7, selectedId: "x y 1 1" }));
    expect(p.spectrum).toBe("7");
    expect(p.scan).toBeUndefined();
  });

  it("encodes the MS-level filter", () => {
    expect(parseViewParams("?" + qs({ ...base, msLevelFilter: 2 })).ms).toBe("2");
  });

  it("encodes an XIC and a stored chromatogram", () => {
    const xic = parseViewParams("?" + qs({ ...base, tab: "chromatograms", chromMode: "xic", xic: { mz: 445.12, tolDa: 0.01 } }));
    expect(xic.xic).toBe("445.12,0.01");
    const stored = parseViewParams("?" + qs({ ...base, tab: "chromatograms", chromMode: "stored", chromStoredId: "BasePeak_0" }));
    expect(stored.chrom).toBe("BasePeak_0");
    const tic = parseViewParams("?" + qs({ ...base, tab: "chromatograms", chromMode: "tic" }));
    expect(tic.chrom).toBe("tic");
  });

  it("round-trips a full spectra view", () => {
    const s: ViewState = { ...base, tab: "spectra", selectedIndex: 5, selectedId: "scan=1024", msLevelFilter: 2 };
    const p = parseViewParams("?" + qs(s));
    expect(p).toEqual({ file: "https://host/x.mzpeak", tab: "spectra", scan: "1024", ms: "2" });
  });

  it("emits an RT window only alongside a computed TIC/XIC", () => {
    // XIC + rt
    const xic = parseViewParams("?" + qs({ ...base, tab: "chromatograms", chromMode: "xic", xic: { mz: 445.12, tolDa: 0.01 }, chromTimeRange: [120, 600] }));
    expect(xic.xic).toBe("445.12,0.01");
    expect(xic.rt).toBe("120,600");
    // TIC + rt
    const tic = parseViewParams("?" + qs({ ...base, tab: "chromatograms", chromMode: "tic", chromTimeRange: [12.5, 60] }));
    expect(tic.chrom).toBe("tic");
    expect(tic.rt).toBe("12.5,60");
    // A stored chromatogram never carries rt.
    const stored = parseViewParams("?" + qs({ ...base, tab: "chromatograms", chromMode: "stored", chromStoredId: "BasePeak_0", chromTimeRange: [1, 2] }));
    expect(stored.rt).toBeUndefined();
    // rt without an emitted chromatogram (e.g. summary tab TIC) is not emitted.
    expect(parseViewParams("?" + qs({ ...base, chromMode: "tic", chromTimeRange: [1, 2] })).rt).toBeUndefined();
  });

  it("parses the hand-authored xicmz range and rt params", () => {
    const p = parseViewParams("?file=https://h/x.mzpeak&xicmz=445.0,445.3&rt=120,600");
    expect(p.xicmz).toBe("445.0,445.3");
    expect(p.rt).toBe("120,600");
  });

  it("encodes the spectrum m/z zoom (only with a selected spectrum)", () => {
    const withSel = parseViewParams(
      "?" + qs({ ...base, tab: "spectra", selectedIndex: 5, selectedId: "scan=1024", spectrumZoom: [126.0, 131.2] }),
    );
    expect(withSel.scan).toBe("1024");
    expect(withSel.mz).toBe("126,131.2");
    // No selected spectrum → no zoom emitted.
    expect(parseViewParams("?" + qs({ ...base, spectrumZoom: [126, 131] })).mz).toBeUndefined();
  });
});

describe("parsePair (rt / xicmz)", () => {
  it("accepts exactly two ascending numbers", () => {
    expect(parsePair("445.0,445.3")).toEqual([445.0, 445.3]);
    expect(parsePair("120,600")).toEqual([120, 600]);
    expect(parsePair("-5,5")).toEqual([-5, 5]);
  });
  it("rejects malformed, equal, inverted, or wrong-arity input", () => {
    for (const bad of [undefined, null, "", "445", ",600", "600,", "5,5", "5,4", "1,2,3", "a,2", "2,b", " , "]) {
      expect(parsePair(bad as string | undefined)).toBeNull();
    }
  });
});

describe("parseViewParams", () => {
  it("accepts ?url= as a file alias and ignores unknown keys", () => {
    const p = parseViewParams("?url=https://h/y.mzpeak&foo=bar&tab=metadata");
    expect(p.file).toBe("https://h/y.mzpeak");
    expect(p.tab).toBe("metadata");
  });
});
