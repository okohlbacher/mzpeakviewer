import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { readStudyMetadata } from "./sampleMeta";
import type { Reader } from "./open";

const fxBytes = (p: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./__fixtures__/${p}`, import.meta.url))));

/** Minimal fake Reader: an in-memory ZIP with an index metadata map. */
function fakeReader(opts: {
  metadata: Record<string, unknown>;
  members: Record<string, Uint8Array>;
}): Reader {
  const files = Object.keys(opts.members).map((name) => ({ name }));
  return {
    store: {
      fileIndex: { metadata: opts.metadata, files },
      open: async (name: string) => {
        const bytes = opts.members[name];
        if (!bytes) return undefined;
        return { size: bytes.byteLength, bytes: async () => bytes };
      },
    },
  } as unknown as Reader;
}

describe("readStudyMetadata — presence gate (UAT: no info present)", () => {
  it("returns null when the archive carries no study metadata", async () => {
    const r = fakeReader({ metadata: {}, members: { "spectra_data.parquet": new Uint8Array() } });
    expect(await readStudyMetadata(r, "x.mzpeak")).toBeNull();
  });
  it("returns null for an imaging-only metadata block", async () => {
    const r = fakeReader({ metadata: { imaging: { is_imaging: true } }, members: {} });
    expect(await readStudyMetadata(r, "x.mzpeak")).toBeNull();
  });
});

describe("readStudyMetadata — SDRF blob end-to-end", () => {
  const bytes = fxBytes("PXD011799.tmt10.sdrf.tsv");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const member = "sample_metadata/sdrf.tsv";
  const firstFile = "20170424_Lumos_RSLC3_Maurer_Hartl_UW_MFPL_shotgun_TMT1_global_Fr9.raw";

  it("reads, hash-verifies, and parses the embedded SDRF", async () => {
    const r = fakeReader({
      metadata: {
        study: { accession: "PXD011799", title: "B-cell melanoma TMT" },
        sample_metadata: { format: "sdrf", member, sha256: sha, source_uri: "https://x/PXD011799.sdrf.tsv", embed_scope: "applicable_rows" },
      },
      members: { [member]: bytes },
    });
    const sm = await readStudyMetadata(r, firstFile);
    expect(sm).not.toBeNull();
    expect(sm!.format).toBe("sdrf");
    expect(sm!.labeling.kind).toBe("isobaric");
    expect(sm!.counts.channels).toBe(10);
    expect(sm!.provenance.hashState).toBe("verified");
    expect(sm!.investigation.accession).toBe("PXD011799");
    expect(sm!.rows.filter((x) => x.matchesThisFile)).toHaveLength(10);
  });

  it("flags a sha256 mismatch instead of trusting it", async () => {
    const r = fakeReader({
      metadata: { sample_metadata: { format: "sdrf", member, sha256: "deadbeef" } },
      members: { [member]: bytes },
    });
    const sm = await readStudyMetadata(r, firstFile);
    expect(sm!.provenance.hashState).toBe("mismatch");
  });

  it("honors the v0.8 archive_name field + dataset_accession", async () => {
    const r = fakeReader({
      metadata: {
        // v0.8 contract: archive_name in sample_metadata, no metadata.study.accession.
        sample_metadata: { format: "sdrf", archive_name: member, dataset_accession: "PXD011799" },
      },
      members: { [member]: bytes },
    });
    const sm = await readStudyMetadata(r, firstFile);
    expect(sm!.counts.channels).toBe(10);
    expect(sm!.investigation.accession).toBe("PXD011799");
    expect(sm!.diagnostics.some((d) => /dataset_accession/.test(d))).toBe(true);
  });

  it("locates the blob by name scan when no member field is given", async () => {
    const r = fakeReader({
      metadata: { sample_metadata: { format: "sdrf" } },
      members: { [member]: bytes },
    });
    const sm = await readStudyMetadata(r, firstFile);
    expect(sm!.counts.channels).toBe(10);
    expect(sm!.diagnostics.some((d) => /name scan/i.test(d))).toBe(true);
  });
});

describe("readStudyMetadata — projection-first (encoded sample_list ⋈ run_sample_binding)", () => {
  const ch = (id: string, name: string, label: string, mz: number, role: string) => ({
    id, name,
    parameters: [
      { accession: "MS:1002602", name: "sample label", value: label },
      { accession: "mzml2mzpeak:reporter-ion-mz", name: "reporter ion m/z", value: String(mz) },
      { accession: "mzml2mzpeak:channel-role", name: "channel role", value: role },
      { accession: "UNIMOD:737", name: "tag modification", value: "TMT6plex" },
    ],
  });
  const sampleList = [
    ch("sample-1", "P1", "TMT126", 126.127726, "sample"),
    ch("sample-2", "P2", "TMT127N", 127.124761, "sample"),
    ch("sample-3", "Pool", "TMT131", 131.13818, "reference"),
    ch("sample-9", "Other", "TMT128N", 128.128116, "sample"), // not bound to this run
  ];

  it("builds run-scoped channels from the projection (no blob parse)", async () => {
    const r = fakeReader({
      metadata: {
        study: { accession: "PXD011799", title: "X", run_sample_binding: { run_id: "fr8", sample_ids: ["sample-1", "sample-2", "sample-3"] } },
        sample_list: sampleList,
      },
      members: {},
    });
    const sm = await readStudyMetadata(r, "fr8.mzpeak");
    expect(sm!.source).toBe("projection");
    expect(sm!.runId).toBe("fr8");
    expect(sm!.labeling.reagent).toBe("TMT");
    const bound = sm!.channels.filter((c) => c.boundToThisRun);
    expect(bound).toHaveLength(3);
    expect(sm!.counts.channels).toBe(3);
    expect(sm!.counts.sourceSamples).toBe(4); // study-wide includes the unbound entry
    expect(sm!.rows).toHaveLength(0); // blob never parsed
    const c0 = bound.find((c) => c.channelLabel === "TMT126")!;
    expect(c0.reporterMz).toBeCloseTo(126.1277, 3);
    expect(c0.tag?.id).toBe("UNIMOD:737");
    expect(c0.sampleName).toBe("P1");
    expect(bound.find((c) => c.channelLabel === "TMT131")!.role).toBe("reference");
  });

  it("falls back to study-wide channels when run_sample_binding is absent", async () => {
    const r = fakeReader({ metadata: { study: { accession: "X" }, sample_list: sampleList }, members: {} });
    const sm = await readStudyMetadata(r, "fr8.mzpeak");
    expect(sm!.source).toBe("projection");
    expect(sm!.channels.filter((c) => c.boundToThisRun)).toHaveLength(4);
    expect(sm!.diagnostics.some((d) => /run_sample_binding/.test(d))).toBe(true);
  });
});
