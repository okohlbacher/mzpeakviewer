import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseIsaTab } from "./isa";
import type { StudyProvenance } from "./types";

const fx = (p: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${p}`, import.meta.url)), "utf8");

const prov: StudyProvenance = {
  format: "isa-tab", sourceUri: null, embedScope: "full",
  retrievedAt: null, sha256: null, hashState: "none", member: "sample_metadata/isa/i_Investigation.txt",
};

describe("parseIsaTab — MTBLS5358 (GC-MS metabolomics, label-free)", () => {
  const sm = parseIsaTab(
    {
      investigation: fx("MTBLS5358/i_Investigation.txt"),
      studies: [fx("MTBLS5358/s_MTBLS5358.txt")],
      assays: [fx("MTBLS5358/a_MTBLS5358_GC-MS_positive__metabolite_profiling.txt")],
    },
    "QC-1.raw",
    prov,
  );

  it("reads the investigation (accession, title, description, contacts)", () => {
    expect(sm.format).toBe("isa-tab");
    expect(sm.investigation.accession).toBe("MTBLS5358");
    expect(sm.investigation.title?.toLowerCase()).toContain("system xc");
    expect(sm.investigation.description?.length).toBeGreaterThan(20);
    expect(sm.investigation.contacts.join(" ")).toContain("Wang");
  });

  it("is label-free with no channels", () => {
    expect(sm.labeling.kind).toBe("label-free");
    expect(sm.counts.channels).toBe(0);
  });

  it("binds assay rows to samples and matches this file", () => {
    expect(sm.rows.length).toBeGreaterThan(0);
    const qc1 = sm.rows.find((r) => r.dataFile && /QC-1\.raw/i.test(r.dataFile));
    expect(qc1).toBeTruthy();
    expect(qc1!.matchesThisFile).toBe(true);
    // organism characteristic joined from the study file (case-insensitive key)
    expect(sm.biology.organisms.length).toBeGreaterThan(0);
  });

  it("surfaces the study factor (Treatment)", () => {
    expect(sm.factors.map((f) => f.name)).toContain("Treatment");
  });
});
