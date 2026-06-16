import { describe, it, expect } from "vitest";
import { MESSAGE_POLICY, MAX_MEMBER_BYTES, type RequestType } from "./protocol";

// These messages are the inbound request `type`s. Keep in sync with WorkerRequest.
const REQUEST_TYPES: RequestType[] = [
  "open",
  "close",
  "setCacheConfig",
  "cancel",
  "selectSpectrum",
  "scanBreakdown",
  "meanSpectrum",
  "roiSpectrum",
  "extractChrom",
  "chromatogramList",
  "archiveList",
  "parquetFooter",
  "deepColumn",
  "sampleColumn",
  "archiveMemberBytes",
  "studyMeta",
  "renderIonImage",
  "renderMultiChannel",
  "getOpticalImage",
];

describe("MESSAGE_POLICY — every request type has a coherent policy", () => {
  it("declares a policy for each request type and nothing extra", () => {
    expect(Object.keys(MESSAGE_POLICY).sort()).toEqual([...REQUEST_TYPES].sort());
  });

  it("paged reads also transfer their result (no large structured clones)", () => {
    for (const t of REQUEST_TYPES) {
      const p = MESSAGE_POLICY[t];
      if (p.paged) expect(p.transfersResult).toBe(true);
    }
  });

  it("the raw member read is capped and abortable", () => {
    const p = MESSAGE_POLICY.archiveMemberBytes;
    expect(p.sizeCapBytes).toBe(MAX_MEMBER_BYTES);
    expect(p.transfersResult).toBe(true);
    expect(p.cancellation).toBe("abort");
  });

  it("lifecycle/control messages are not cancellable", () => {
    for (const t of ["close", "setCacheConfig", "cancel"] as RequestType[]) {
      expect(MESSAGE_POLICY[t].cancellation).toBe("none");
    }
  });

  it("rapid-click reads are stale-drop, network reads are hard-abort (codex #2)", () => {
    expect(MESSAGE_POLICY.selectSpectrum.cancellation).toBe("stale-drop");
    expect(MESSAGE_POLICY.open.cancellation).toBe("abort");
    expect(MESSAGE_POLICY.renderIonImage.cancellation).toBe("abort");
  });
});
