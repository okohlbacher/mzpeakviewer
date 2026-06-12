import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseSdrf } from "./sdrf";
import type { StudyProvenance } from "./types";

const fx = (p: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${p}`, import.meta.url)), "utf8");

const prov = (uri: string | null): StudyProvenance => ({
  format: "sdrf", sourceUri: uri, embedScope: "applicable_rows",
  retrievedAt: null, sha256: null, hashState: "none", member: "sample_metadata/sdrf.tsv",
});

describe("parseSdrf — PXD011799 (TMT 10-plex)", () => {
  const text = fx("PXD011799.tmt10.sdrf.tsv");
  // The first data file in the trimmed fixture:
  const firstFile = "20170424_Lumos_RSLC3_Maurer_Hartl_UW_MFPL_shotgun_TMT1_global_Fr9.raw";
  const sm = parseSdrf(text, firstFile, prov("https://x/PXD011799.sdrf.tsv"));

  it("classifies as isobaric TMT 10-plex", () => {
    expect(sm.format).toBe("sdrf");
    expect(sm.labeling.kind).toBe("isobaric");
    expect(sm.labeling.reagent).toBe("TMT");
    expect(sm.labeling.plex).toBe(10);
    expect(sm.counts.channels).toBe(10);
  });

  it("resolves the 10 TMT labels with reporter m/z, including reference channels", () => {
    const matched = sm.rows.filter((r) => r.matchesThisFile);
    expect(matched).toHaveLength(10);
    const labels = matched.map((r) => r.label).sort();
    expect(labels).toContain("TMT126");
    expect(labels).toContain("TMT131");
    const c126 = matched.find((r) => r.label === "TMT126")!;
    expect(c126.reporterMz).toBeCloseTo(126.1277, 3);
    expect(c126.role).toBe("experimental");
    // The Pool rows are the reference channels (their source name starts "Pool").
    const pool = matched.filter((r) => /pool/i.test(r.sourceName));
    expect(pool.length).toBeGreaterThan(0);
  });

  it("extracts the TMT6plex tag (Unimod, case-insensitive) and characteristics", () => {
    const r = sm.rows.find((r) => r.matchesThisFile)!;
    expect(r.tag?.id).toBe("UNIMOD:737"); // matches AC=UNIMOD:737
    expect(r.labelKind).toBe("isobaric");
    expect(r.characteristics["organism"]?.value).toBe("Homo sapiens");
    expect(r.characteristics["disease"]?.value?.toLowerCase()).toContain("melanoma");
  });

  it("reads factors and biology", () => {
    expect(sm.factors.map((f) => f.name)).toContain("enrichment process");
    expect(sm.biology.organisms).toContain("Homo sapiens");
    expect(sm.biology.diseases.join(" ").toLowerCase()).toContain("melanoma");
  });

  it("counts samples, channels and files distinctly", () => {
    expect(sm.counts.channels).toBe(10);
    expect(sm.counts.dataFiles).toBeGreaterThanOrEqual(1);
    expect(sm.counts.sourceSamples).toBeLessThan(sm.counts.rows); // samples != rows
  });

  it("handles reserved words without leaking them as values", () => {
    // characteristics[sex] / [age] are 'not available' in this dataset.
    const withReserved = sm.rows.find((r) =>
      Object.values(r.characteristics).some((c) => c.reserved != null),
    );
    expect(withReserved).toBeTruthy();
  });
});

describe("parseSdrf — PXD020187 (label-free)", () => {
  const sm = parseSdrf(fx("PXD020187.labelfree.sdrf.tsv"), null, prov("https://x/PXD020187.sdrf.tsv"));
  it("classifies as label-free with no channels", () => {
    expect(sm.labeling.kind).toBe("label-free");
    expect(sm.counts.channels).toBe(0);
    expect(sm.rows.every((r) => r.labelKind !== "isobaric")).toBe(true);
  });
});

describe("parseSdrf — file matching across extensions", () => {
  const header = "source name\tcharacteristics[organism]\tcomment[label]\tcomment[data file]";
  const text = [header, "s1\tHomo sapiens\tlabel free sample\tRun_42_fr8.raw"].join("\n");
  it("matches a .mzpeak open-file name against the SDRF .raw stem", () => {
    // The open file is the .mzpeak; the SDRF names the .raw — both strip to "run_42_fr8".
    const sm = parseSdrf(text, "Run_42_fr8.mzpeak", prov(null));
    expect(sm.rows[0].matchesThisFile).toBe(true);
  });
  it("does not match a different stem", () => {
    const sm = parseSdrf(text, "Run_99_fr1.mzpeak", prov(null));
    expect(sm.rows[0].matchesThisFile).toBe(false);
  });
});

describe("parseSdrf — adversarial", () => {
  const header =
    "source name\tcharacteristics[organism]\tcomment[label]\tcomment[modification parameters]\tcomment[data file]\tfactor value[treatment]";
  it("matches mixed-case Unimod accession and detects SILAC", () => {
    const text = [
      header,
      "s1\tHomo sapiens\tSILAC light\tNT=Label:13C(6);AC=Unimod:188;MT=fixed\tf.raw\tctrl",
      "s2\tHomo sapiens\tSILAC heavy\tNT=Label:13C(6);AC=Unimod:188;MT=fixed\tf.raw\ttreated",
    ].join("\n");
    const sm = parseSdrf(text, "f.raw", prov(null));
    expect(sm.labeling.kind).toBe("silac");
    expect(sm.counts.channels).toBe(0); // SILAC is not isobaric
    expect(sm.rows[0].characteristics["organism"]?.cv).toBeNull(); // plain value, no AC
  });
  it("does not throw on ragged rows and reserved cells", () => {
    const text = [header, "s1\tnot available\tTMT126\t\tf.raw", "s2"].join("\n");
    const sm = parseSdrf(text, "f.raw", prov(null));
    expect(sm.rows).toHaveLength(2);
    expect(sm.rows[0].characteristics["organism"]?.reserved).toBe("not available");
  });
});
