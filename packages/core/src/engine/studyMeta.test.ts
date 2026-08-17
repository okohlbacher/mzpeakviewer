// Canonical guard for the SDRF/TMT channel pipeline: engineStudyMeta must project
// sample_list entries carrying an MS:1002602 sample-label parameter into ChannelAssignments
// (reporter m/z from the shipped reagent table when the file doesn't declare one), honouring
// run_sample_binding. This is the ONLY source of the Spectra view's reporter-channel pills —
// if extraction regresses (or a converter ships an empty sample_list, as the 2026-08 corpus
// reconversion did), MS2 spectra of TMT runs silently show no channels. Pure logic over a
// faked reader index; no WASM/fixture needed.
import { describe, it, expect } from "vitest";
import { engineStudyMeta } from "./studyMeta";
import type { Reader } from "../reader/openUrl";

function fakeReader(metadata: unknown): Reader {
  return { store: { fileIndex: { metadata } } } as unknown as Reader;
}

const LABELED_SAMPLES = [
  {
    id: "s1",
    name: "control replicate 1",
    parameters: [{ accession: "MS:1002602", name: "sample label", value: "TMT126" }],
  },
  {
    id: "s2",
    name: "treated replicate 1",
    parameters: [{ accession: "MS:1002602", name: "sample label", value: "TMT127N" }],
  },
  // Label-free entry — must NOT become a channel.
  { id: "s3", name: "qc pool", parameters: [] },
];

describe("engineStudyMeta — SDRF/TMT channel projection", () => {
  it("projects MS:1002602-labeled samples to channels with reagent-table reporter m/z", async () => {
    const s = await engineStudyMeta(fakeReader({ sample_list: LABELED_SAMPLES }));
    expect(s.present).toBe(true);
    expect(s.channels).toHaveLength(2);
    expect(s.channels.map((c) => c.channelLabel)).toEqual(["TMT126", "TMT127N"]);
    // Reporter m/z resolved from the shipped reagent table (file declares none).
    expect(s.channels[0]!.reporterMz).toBeCloseTo(126.127726, 5);
    expect(s.channels[1]!.reporterMz).toBeCloseTo(127.124761, 5);
    expect(s.channels.map((c) => c.sampleName)).toEqual([
      "control replicate 1",
      "treated replicate 1",
    ]);
    // No run_sample_binding → all channels bound to this run (study-wide).
    expect(s.channels.every((c) => c.boundToThisRun)).toBe(true);
  });

  it("honours run_sample_binding: only listed sample_ids are bound to this run", async () => {
    const s = await engineStudyMeta(
      fakeReader({
        sample_list: LABELED_SAMPLES,
        run_sample_binding: { sample_ids: ["s2"] },
      }),
    );
    expect(s.channels.map((c) => [c.channelLabel, c.boundToThisRun])).toEqual([
      ["TMT126", false],
      ["TMT127N", true],
    ]);
  });

  it("returns no channels for an EMPTY sample_list (the 2026-08 corpus state)", async () => {
    const s = await engineStudyMeta(fakeReader({ sample_list: [] }));
    expect(s.present).toBe(false);
    expect(s.channels).toHaveLength(0);
  });
});
