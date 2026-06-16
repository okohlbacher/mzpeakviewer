import { describe, it, expect } from "vitest";
import { parseUsi, buildUsi, USI_LOCAL_COLLECTION } from "./usi";

describe("USI parse/build", () => {
  it("round-trips a scan USI", () => {
    const s = "mzspec:PXD011799:20170131_Lumos_fr8:scan:10000";
    const u = parseUsi(s);
    expect(u).toEqual({ collection: "PXD011799", msRun: "20170131_Lumos_fr8", flag: "scan", value: "10000", interpretation: null });
    expect(buildUsi(u!)).toBe(s);
  });

  it("parses index and nativeId flags", () => {
    expect(parseUsi("mzspec:USI000000:run1:index:42")?.flag).toBe("index");
    const nid = parseUsi("mzspec:USI000000:run1:nativeId:controllerType=0 controllerNumber=1 scan=5");
    expect(nid?.flag).toBe("nativeId");
    expect(nid?.value).toBe("controllerType=0 controllerNumber=1 scan=5");
  });

  it("preserves a trailing interpretation (colon-joined)", () => {
    const u = parseUsi("mzspec:PXD000001:run:scan:5:PEPTIDE/2");
    expect(u?.interpretation).toBe("PEPTIDE/2");
    expect(buildUsi(u!)).toBe("mzspec:PXD000001:run:scan:5:PEPTIDE/2");
  });

  it("builds a valid USI for local/unsubmitted data via the placeholder collection", () => {
    expect(buildUsi({ collection: USI_LOCAL_COLLECTION, msRun: "myfile", flag: "scan", value: "7" }))
      .toBe("mzspec:USI000000:myfile:scan:7");
  });

  it("rejects malformed inputs", () => {
    expect(parseUsi("")).toBeNull();
    expect(parseUsi("PXD000001:run:scan:5")).toBeNull(); // no mzspec:
    expect(parseUsi("mzspec:PXD000001:run:scan")).toBeNull(); // no value
    expect(parseUsi("mzspec:PXD000001:run:bogus:5")).toBeNull(); // bad flag
    expect(parseUsi("mzspec:PXD000001:run:scan:")).toBeNull(); // empty value
  });
});
