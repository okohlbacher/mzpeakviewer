import { describe, it, expect } from "vitest";
import {
  parseSearch,
  resolve,
  serialize,
  inferView,
  buildShareUrl,
  DEFAULT_TOL_DA,
  type RawParams,
} from "./grammar";
import { DEFAULT_VIEW_STATE, type ViewState } from "../store";

const vs = (over: Partial<ViewState>): ViewState => ({ ...DEFAULT_VIEW_STATE, ...over });

describe("parseSearch — alias folding", () => {
  it("folds url→file and tab→view", () => {
    const r = parseSearch("?url=http://x/a.mzpeak&tab=spectra");
    expect(r.file).toBe("http://x/a.mzpeak");
    expect(r.view).toBe("spectra");
  });
  it("prefers file over url and view over tab when both present", () => {
    const r = parseSearch("?file=A&url=B&view=ion&tab=summary");
    expect(r.file).toBe("A");
    expect(r.view).toBe("ion");
  });
  it("folds cacheMB→cache and collects repeatable ch", () => {
    const r = parseSearch("?cacheMB=64&ch=100,0.1,red&ch=200,0.1,green");
    expect(r.cache).toBe("64");
    expect(r.ch).toEqual(["100,0.1,red", "200,0.1,green"]);
  });
});

describe("resolve — selection precedence scan > px > spectrum (§3.2)", () => {
  it("scan wins over px and spectrum, losers noticed", () => {
    const { view, notices } = resolve({ scan: "1500", px: "3,4", spectrum: "9" }, "imaging");
    expect(view.selector).toEqual({ by: "scan", scan: 1500, index: -1, id: null });
    expect(notices.map((n) => n.code)).toContain("drop-px");
    expect(notices.map((n) => n.code)).toContain("drop-spectrum");
  });
  it("px wins over spectrum in imaging mode", () => {
    const { view } = resolve({ px: "3,4", spectrum: "9" }, "imaging");
    expect(view.selector).toEqual({ by: "pixel", x: 3, y: 4, index: -1, id: null });
  });
  it("px is ignored on an LC file (cross-mode), spectrum then used", () => {
    const { view, notices } = resolve({ px: "3,4", spectrum: "9" }, "lc");
    expect(view.selector).toEqual({ by: "spectrum", index: 9, id: null });
    expect(notices.map((n) => n.code)).toContain("px-cross-mode");
  });
});

describe("resolve — cross-mode params are ignored with a notice, never an error", () => {
  it("ion on an LC file is dropped + info notice", () => {
    const { view, notices } = resolve({ ion: "445.1,0.1" }, "lc");
    expect(view.ion).toBeNull();
    expect(notices.find((n) => n.code === "imaging-cross-mode")?.severity).toBe("info");
  });
  it("xic on an imaging file is dropped + info notice", () => {
    const { view, notices } = resolve({ xic: "445,0.1" }, "imaging");
    expect(view.xic).toBeNull();
    expect(notices.find((n) => n.code === "lc-cross-mode")).toBeTruthy();
  });
  it("a cross-mode explicit view falls back to inference + notice", () => {
    const { view, notices } = resolve({ view: "ion" }, "lc");
    expect(view.view).toBe("summary");
    expect(notices.map((n) => n.code)).toContain("view-cross-mode");
  });
});

describe("resolve — mixed spectrum + data params are BOTH applied", () => {
  it("scan + xic on an LC file: chromatograms view, spectrum stays selected", () => {
    const { view } = resolve({ scan: "1200", xic: "445,0.1", view: "chromatograms" }, "lc");
    expect(view.view).toBe("chromatograms");
    expect(view.selector).toEqual({ by: "scan", scan: 1200, index: -1, id: null });
    expect(view.xic).toEqual({ mz: 445, tolDa: 0.1 });
  });
});

describe("inferView (§3.3)", () => {
  it("imaging: ch > ion > roi > overlay > optical", () => {
    expect(inferView({ ch: ["1,0.1"], ion: "2" }, "imaging")).toBe("ion");
    expect(inferView({ ion: "2" }, "imaging")).toBe("ion");
    expect(inferView({ roi: "0,0,1,1" }, "imaging")).toBe("spectra");
    expect(inferView({ overlay: "1" }, "imaging")).toBe("overlay");
    expect(inferView({ optical: "0" }, "imaging")).toBe("optical");
  });
  it("lc: xic/xicmz/chrom → chromatograms", () => {
    expect(inferView({ xicmz: "100,200" }, "lc")).toBe("chromatograms");
    expect(inferView({ chrom: "tic" }, "lc")).toBe("chromatograms");
  });
  it("selection → spectra; otherwise summary", () => {
    expect(inferView({ scan: "5" }, "unknown")).toBe("spectra");
    expect(inferView({}, "unknown")).toBe("summary");
  });
});

describe("serialize — shortest canonical + provenance (codex #8)", () => {
  it("omits view when inference already yields it", () => {
    const p = serialize(vs({ view: "spectra", selector: { by: "spectrum", index: 4, id: null } }), "lc");
    expect(p.get("view")).toBeNull();
    expect(p.get("spectrum")).toBe("4");
  });
  it("emits view when it differs from inference", () => {
    const p = serialize(vs({ view: "metadata" }), "unknown");
    expect(p.get("view")).toBe("metadata");
  });
  it("a pixel selection serializes as px, NOT as a scan link", () => {
    // codex #8: imaging selections must never leak out as native-scan links.
    const p = serialize(vs({ view: "spectra", selector: { by: "pixel", x: 10, y: 20, index: 7, id: "scan=8" } }), "imaging");
    expect(p.get("px")).toBe("10,20");
    expect(p.get("scan")).toBeNull();
    expect(p.get("spectrum")).toBeNull();
  });
  it("a scan selection serializes from provenance, not the id string", () => {
    const p = serialize(vs({ view: "spectra", selector: { by: "scan", scan: 4321, index: 7, id: "controllerType=0 scan=4321" } }), "lc");
    expect(p.get("scan")).toBe("4321");
  });
  it("ion omits the tol when it is the default", () => {
    expect(serialize(vs({ view: "ion", ion: { mz: 445.1, tolDa: DEFAULT_TOL_DA } }), "imaging").get("ion")).toBe("445.1");
    expect(serialize(vs({ view: "ion", ion: { mz: 445.1, tolDa: 0.2 } }), "imaging").get("ion")).toBe("445.1,0.2");
  });
});

describe("round-trip: serialize → parse → resolve is stable", () => {
  const cases: { mode: "imaging" | "lc"; v: ViewState }[] = [
    { mode: "lc", v: vs({ sourceUrl: "http://x/a.mzpeak", view: "spectra", selector: { by: "scan", scan: 1500, index: -1, id: null } }) },
    { mode: "lc", v: vs({ view: "chromatograms", chromMode: "xic", xic: { mz: 445, tolDa: 0.1 }, chromTimeRange: [10, 20] }) },
    { mode: "lc", v: vs({ view: "chromatograms", chromMode: "xic", xic: { mz: 558.3, tolDa: 0.05, msLevel: 2 } }) }, // MS-level-limited XIC round-trips its level
    { mode: "imaging", v: vs({ view: "ion", ion: { mz: 200.05, tolDa: 0.1 } }) },
    { mode: "imaging", v: vs({ view: "overlay", opticalRef: "0" }) },
    { mode: "lc", v: vs({ view: "spectra", selector: { by: "spectrum", index: 12, id: null }, spectrumZoom: [100, 500], msLevelFilter: 2 }) },
    // Study-design tab: ?view=study must survive resolve (it is in VALID_VIEWS — the
    // separate hardcoded allowlist an adversarial review caught the plan omitting).
    { mode: "lc", v: vs({ view: "study" }) },
    // Signal-source toggle (dual-stored spectra): ?sig= round-trips; auto stays absent.
    { mode: "lc", v: vs({ view: "spectra", signalSource: "centroid", selector: { by: "spectrum", index: 3, id: null } }) },
    // DIA fragment-XIC card: ?dia=prec,frag,tol round-trips (it used to serialize as a
    // silent wrong-data `chrom=tic` — adversarial review 2026-08-26, P0 item 10).
    { mode: "lc", v: vs({ view: "chromatograms", diaXic: [{ precursorMz: 622.3, mz: 302.15, tolDa: 0.02 }], chromTimeRange: [100, 200] }) },
  ];
  for (const [i, c] of cases.entries()) {
    it(`case ${i} round-trips`, () => {
      const q = serialize(c.v, c.mode).toString();
      const reparsed = resolve(parseSearch(`?${q}`), c.mode);
      // re-serialize the resolved view; the query must be identical (canonical fixpoint)
      expect(serialize(reparsed.view, c.mode).toString()).toBe(q);
      expect(reparsed.view.view).toBe(c.v.view);
    });
  }
});

describe("dia= grammar (DIA fragment XICs)", () => {
  it("parses repeatable dia= and infers the chromatograms view", () => {
    const raw = parseSearch("?dia=622.3,302.15,0.02&dia=750.4,401.2,0.05");
    expect(raw.dia).toEqual(["622.3,302.15,0.02", "750.4,401.2,0.05"]);
    const { view } = resolve(raw, "lc");
    expect(view.view).toBe("chromatograms");
    expect(view.diaXic).toEqual([
      { precursorMz: 622.3, mz: 302.15, tolDa: 0.02 },
      { precursorMz: 750.4, mz: 401.2, tolDa: 0.05 },
    ]);
  });
  it("rejects malformed entries (arity/garbage/non-positive) and never emits chrom=tic alongside dia", () => {
    expect(resolve({ dia: ["622.3,302.15"] }, "lc").view.diaXic).toEqual([]);
    expect(resolve({ dia: ["622.3,abc,0.02"] }, "lc").view.diaXic).toEqual([]);
    expect(resolve({ dia: ["622.3,302.15,0"] }, "lc").view.diaXic).toEqual([]);
    const p = serialize(vs({ view: "chromatograms", diaXic: [{ precursorMz: 1, mz: 2, tolDa: 0.1 }] }), "lc");
    expect(p.get("chrom")).toBeNull(); // an active DIA card must not claim a TIC
  });
  it("is dropped with a notice on an imaging file", () => {
    const { view, notices } = resolve({ dia: ["622.3,302.15,0.02"] }, "imaging");
    expect(view.diaXic).toEqual([]);
    expect(notices.map((n) => n.code)).toContain("lc-cross-mode");
  });
});

describe("num() precision — tight tolerances/zooms survive the URL (P0 item 13)", () => {
  it("a sub-0.1-mDa XIC tolerance round-trips instead of collapsing to 0", () => {
    const q = serialize(vs({ view: "chromatograms", chromMode: "xic", xic: { mz: 445.12007, tolDa: 0.00002 } }), "lc").toString();
    const back = resolve(parseSearch(`?${q}`), "lc").view;
    expect(back.xic).toEqual({ mz: 445.12007, tolDa: 0.00002 });
  });
  it("a tight m/z zoom keeps distinct endpoints (4-decimal cut made them equal → dropped)", () => {
    const q = serialize(vs({ view: "spectra", spectrumZoom: [500.12341, 500.12349] }), "lc").toString();
    const back = resolve(parseSearch(`?${q}`), "lc").view;
    expect(back.spectrumZoom).toEqual([500.12341, 500.12349]);
  });
});

describe("imaging files with stored chromatograms (P0 item 13 / K M-h)", () => {
  it("?view=chromatograms + chrom=id: survives on an imaging file (tab exists in-app)", () => {
    const { view, notices } = resolve({ view: "chromatograms", chrom: "id:TIC" }, "imaging");
    expect(view.view).toBe("chromatograms");
    expect(view.chromMode).toBe("stored");
    expect(view.chromStoredId).toBe("TIC");
    expect(notices.map((n) => n.code)).not.toContain("view-cross-mode");
  });
  it("extracted forms (xic) are still dropped on imaging", () => {
    const { view, notices } = resolve({ xic: "445,0.1" }, "imaging");
    expect(view.xic).toBeNull();
    expect(notices.map((n) => n.code)).toContain("lc-cross-mode");
  });
});

describe("buildShareUrl", () => {
  it("produces origin+path+query, dropping the ? when empty", () => {
    expect(buildShareUrl(vs({}), "lc", "https://mzpeak.org", "/view/")).toBe("https://mzpeak.org/view/");
    const url = buildShareUrl(vs({ sourceUrl: "http://x/a", view: "spectra", selector: { by: "scan", scan: 9, index: -1, id: null } }), "lc", "https://mzpeak.org", "/view/");
    expect(url.startsWith("https://mzpeak.org/view/?")).toBe(true);
    expect(url).toContain("scan=9");
  });
});

describe("strict value parsing", () => {
  it("rejects malformed mz / rt windows (non-ascending, wrong arity)", () => {
    expect(resolve({ mz: "500,100" } as RawParams, "lc").view.spectrumZoom).toBeNull();
    expect(resolve({ mz: "1,2,3" } as RawParams, "lc").view.spectrumZoom).toBeNull();
    expect(resolve({ mz: "100,500" } as RawParams, "lc").view.spectrumZoom).toEqual([100, 500]);
  });
});

describe("Wave-1 fixes: imaging views + empty-tol/color parsing", () => {
  it("overview and multi imaging views deep-link and round-trip", () => {
    expect(resolve({ view: "overview" }, "imaging").view.view).toBe("overview");
    expect(resolve({ view: "multi" }, "imaging").view.view).toBe("multi");
    // serialize(view=multi) → resolve must read it back (was broken: not in VALID_VIEWS).
    const p = serialize(vs({ view: "multi", channels: [{ mz: 100, tolDa: 0.1, color: "red" }] }), "imaging");
    expect(resolve(parseSearch(`?${p.toString()}`), "imaging").view.view).toBe("multi");
    const o = serialize(vs({ view: "overview" }), "imaging");
    expect(resolve(parseSearch(`?${o.toString()}`), "imaging").view.view).toBe("overview");
  });

  it("ion= with an empty tol defaults to DEFAULT_TOL_DA (not a zero-width window)", () => {
    expect(resolve({ ion: "445.1," }, "imaging").view.ion).toEqual({ mz: 445.1, tolDa: DEFAULT_TOL_DA });
    expect(resolve({ ion: "445.1" }, "imaging").view.ion).toEqual({ mz: 445.1, tolDa: DEFAULT_TOL_DA });
    expect(resolve({ ion: "445.1,0.2" }, "imaging").view.ion).toEqual({ mz: 445.1, tolDa: 0.2 });
    expect(resolve({ ion: "445.1,abc" }, "imaging").view.ion).toBeNull(); // garbage tol rejected
  });

  it("channel color preserves commas (functional CSS colors)", () => {
    const ch = resolve({ ch: ["100,0.1,rgb(1,2,3)"] }, "imaging").view.channels[0];
    expect(ch).toEqual({ mz: 100, tolDa: 0.1, color: "rgb(1,2,3)" });
    // empty channel tol also defaults
    const ch2 = resolve({ ch: ["200,,#abcdef"] }, "imaging").view.channels[0];
    expect(ch2).toEqual({ mz: 200, tolDa: DEFAULT_TOL_DA, color: "#abcdef" });
  });

  it("xic= with an empty delta is rejected (delta is required)", () => {
    expect(resolve({ xic: "445.1," }, "lc").view.xic).toBeNull();
    expect(resolve({ xic: "445.1,0.5" }, "lc").view.xic).toEqual({ mz: 445.1, tolDa: 0.5 });
  });

  it("xic= optional 3rd field is the MS level; non-integer/<1 is dropped", () => {
    expect(resolve({ xic: "445.1,0.5,2" }, "lc").view.xic).toEqual({ mz: 445.1, tolDa: 0.5, msLevel: 2 });
    expect(resolve({ xic: "445.1,0.5,0" }, "lc").view.xic).toEqual({ mz: 445.1, tolDa: 0.5 });
    expect(resolve({ xic: "445.1,0.5,x" }, "lc").view.xic).toEqual({ mz: 445.1, tolDa: 0.5 });
  });
});
