import { describe, it, expect } from "vitest";
import { translateLegacyIvSearch, legacyIvRedirect, LEGACY_PATH_MAP } from "./legacy";
import { parseSearch, resolve } from "./grammar";

describe("translateLegacyIvSearch — the two real translations", () => {
  it("scan=N (1-based index) → spectrum=N-1", () => {
    const { search, changes } = translateLegacyIvSearch("?scan=2");
    expect(new URLSearchParams(search).get("spectrum")).toBe("1");
    expect(new URLSearchParams(search).get("scan")).toBeNull();
    expect(changes.join()).toMatch(/scan=2 → spectrum=1/);
  });
  it("scan=1 → spectrum=0 (no negative index)", () => {
    expect(new URLSearchParams(translateLegacyIvSearch("?scan=1").search).get("spectrum")).toBe("0");
  });
  it("folds ion=mz + tol=Da → ion=mz,Da", () => {
    const { search } = translateLegacyIvSearch("?ion=445.1&tol=0.1");
    expect(new URLSearchParams(search).get("ion")).toBe("445.1,0.1");
    expect(new URLSearchParams(search).get("tol")).toBeNull();
  });
  it("does not double-fold when ion already carries a tolerance", () => {
    const { search } = translateLegacyIvSearch("?ion=445.1,0.2&tol=0.1");
    expect(new URLSearchParams(search).get("ion")).toBe("445.1,0.2");
  });
});

describe("translateLegacyIvSearch — pass-through preserves everything else", () => {
  it("carries file/optical/preload/cache verbatim", () => {
    const { search } = translateLegacyIvSearch("?file=http://x/a.mzpeak&optical=0&preload=1&cache=64");
    const p = new URLSearchParams(search);
    expect(p.get("file")).toBe("http://x/a.mzpeak");
    expect(p.get("optical")).toBe("0");
    expect(p.get("preload")).toBe("1");
    expect(p.get("cache")).toBe("64");
  });
  it("carries an unrecognized future param rather than dropping it", () => {
    expect(new URLSearchParams(translateLegacyIvSearch("?somethingNew=1").search).get("somethingNew")).toBe("1");
  });
});

describe("old-link regression corpus → resolves to the right view", () => {
  it("/IV/?ion=445.1&tol=0.1&scan=2 → ion image at 445.1,0.1, spectrum 1 selected", () => {
    const { search } = translateLegacyIvSearch("?ion=445.1&tol=0.1&scan=2");
    const { view } = resolve(parseSearch(`?${search}`), "imaging");
    expect(view.ion).toEqual({ mz: 445.1, tolDa: 0.1 });
    expect(view.selector).toEqual({ by: "spectrum", index: 1, id: null });
    expect(view.view).toBe("ion");
  });
  it("/IV/?optical=0 → optical view (inferred)", () => {
    const { search } = translateLegacyIvSearch("?optical=0");
    const { view } = resolve(parseSearch(`?${search}`), "imaging");
    expect(view.opticalRef).toBe("0");
    expect(view.view).toBe("optical");
  });
});

describe("legacyIvRedirect — per-target path mapping (codex #9)", () => {
  it("maps mzpeak.org /IV/ → /view/ carrying the translated query", () => {
    const r = legacyIvRedirect("/IV/", "?ion=100&tol=0.1&scan=3");
    expect(r?.path).toBe("/view/");
    const p = new URLSearchParams(r!.search);
    expect(p.get("ion")).toBe("100,0.1");
    expect(p.get("spectrum")).toBe("2");
  });
  it("maps the GitHub Pages /mzPeakIV/ project root → /mzpeakviewer/", () => {
    const r = legacyIvRedirect("/mzPeakIV/", "?scan=1");
    expect(r?.path).toBe("/mzpeakviewer/");
    expect(new URLSearchParams(r!.search).get("spectrum")).toBe("0");
  });
  it("returns null for a path that isn't a legacy IV root", () => {
    expect(legacyIvRedirect("/view/", "?x=1")).toBeNull();
  });
  it("covers both deploy targets", () => {
    expect(LEGACY_PATH_MAP.map((m) => m.target).sort()).toEqual(["github-pages", "mzpeak.org"]);
  });
});
