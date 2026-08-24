// Dispatch-level guard for the Signal toggle: selectSpectrum's optional `source` must
// reach the engine (a review found the golden alone couldn't prove dispatch forwards it),
// the response must carry sourceUsed/altAvailable, and a forced read must NOT poison the
// auto cache (a later auto select returns the declared facet again).
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { WorkerRequest, WorkerResponse } from "@mzpeak/contracts";
import { dispatch, createContext, type EngineContext } from "./dispatch";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/dual.mzpeak", import.meta.url));

async function run(ctx: EngineContext, req: WorkerRequest): Promise<WorkerResponse> {
  let out: WorkerResponse | null = null;
  await dispatch(req, ctx, (res) => { out = res; });
  if (!out) throw new Error(`dispatch posted no response for ${req.type}`);
  return out;
}

describe("worker dispatch — dual fixture Signal source", () => {
  let ctx: EngineContext;

  beforeAll(async () => {
    const buf = await readFile(FIXTURE);
    const blob = new Blob([buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)]);
    ctx = createContext();
    const res = await run(ctx, { type: "open", requestId: 1, source: { kind: "file", blob, name: "dual.mzpeak" } });
    expect(res.type).toBe("opened");
  }, 60000);

  it("auto select: declared-profile spectrum 0 → profile facet + altAvailable", async () => {
    const res = await run(ctx, { type: "selectSpectrum", index: 0, selectId: 1 });
    expect(res.type).toBe("spectrumResult");
    if (res.type !== "spectrumResult") return;
    expect(res.spectrum.sourceUsed).toBe("profile");
    expect(res.spectrum.altAvailable).toBe(true);
    expect(res.spectrum.mz.length).toBe(40);
  });

  it("forced select: source=centroid reaches the engine and returns the peaks facet", async () => {
    const res = await run(ctx, { type: "selectSpectrum", index: 0, selectId: 2, source: "centroid" });
    expect(res.type).toBe("spectrumResult");
    if (res.type !== "spectrumResult") return;
    expect(res.spectrum.sourceUsed).toBe("centroid");
    expect(res.spectrum.representation).toBe("profile"); // declared value preserved
    expect(res.spectrum.mz.length).toBe(5);
  });

  it("no cache poisoning: a subsequent AUTO select returns the declared facet again", async () => {
    const res = await run(ctx, { type: "selectSpectrum", index: 0, selectId: 3 });
    expect(res.type).toBe("spectrumResult");
    if (res.type !== "spectrumResult") return;
    expect(res.spectrum.sourceUsed).toBe("profile");
    expect(res.spectrum.mz.length).toBe(40);
  });

  it("forced select matching the cached facet is served without re-read (sourceUsed intact)", async () => {
    const res = await run(ctx, { type: "selectSpectrum", index: 0, selectId: 4, source: "profile" });
    expect(res.type).toBe("spectrumResult");
    if (res.type !== "spectrumResult") return;
    expect(res.spectrum.sourceUsed).toBe("profile");
    expect(res.spectrum.mz.length).toBe(40);
  });
});
