// Golden test for the worker dispatcher against the real imaging fixture — drives the
// full worker-side path (open → opened, selectSpectrum → spectrumResult, scanBreakdown,
// close, error) in node with a fake `respond` that captures the posted responses.
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { WorkerRequest, WorkerResponse } from "@mzpeak/contracts";
import { dispatch, createContext, type EngineContext } from "./dispatch";

const FIXTURE = fileURLToPath(new URL("../../test/fixtures/imaging.mzpeak", import.meta.url));

/** Run one request through dispatch and return the single response it posts. */
async function run(ctx: EngineContext, req: WorkerRequest): Promise<WorkerResponse> {
  let out: WorkerResponse | null = null;
  await dispatch(req, ctx, (res) => { out = res; });
  if (!out) throw new Error(`dispatch posted no response for ${req.type}`);
  return out;
}

describe("worker dispatch — real imaging fixture", () => {
  let bytes: ArrayBuffer;
  let ctx: EngineContext;

  beforeAll(async () => {
    const buf = await readFile(FIXTURE);
    bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    ctx = createContext();
  });

  it("open → opened with imaging capabilities + a grid + a TIC", async () => {
    const res = await run(ctx, { type: "open", requestId: 1, source: { kind: "file", bytes, name: "imaging.mzpeak" } });
    expect(res.type).toBe("opened");
    if (res.type !== "opened") return;
    expect(res.capabilities.imaging.isImaging).toBe(true);
    expect(res.stats?.numSpectra).toBeGreaterThan(0);
    expect(res.grid).not.toBeNull();
    expect(res.tic).not.toBeNull();
    expect(res.fileSize).toBe(bytes.byteLength);
  });

  it("selectSpectrum → spectrumResult with mz/intensity + representation, echoing selectId", async () => {
    const res = await run(ctx, { type: "selectSpectrum", index: 0, selectId: 7 });
    expect(res.type).toBe("spectrumResult");
    if (res.type !== "spectrumResult") return;
    expect(res.selectId).toBe(7);
    expect(res.spectrum.mz.length).toBeGreaterThan(0);
    expect(res.spectrum.mz.length).toBe(res.spectrum.intensity.length);
    expect(["profile", "centroid", null]).toContain(res.spectrum.representation);
  });

  it("scanBreakdown → stats + a BrowseIndex of length numSpectra + a resolved ticColumn", async () => {
    const res = await run(ctx, { type: "scanBreakdown", requestId: 2 });
    expect(res.type).toBe("scanBreakdownResult");
    if (res.type !== "scanBreakdownResult") return;
    expect(res.browse.id.length).toBe(res.stats.numSpectra);
    expect(res.browse.msLevel.length).toBe(res.stats.numSpectra);
    expect(["present", "absent"]).toContain(res.ticColumn); // no longer "unknown"
  });

  it("cancel is acknowledged (cancelled), never an unsupported error", async () => {
    const res = await run(ctx, { type: "cancel", cancelId: 5 });
    expect(res.type).toBe("cancelled");
    if (res.type !== "cancelled") return;
    expect(res.cancelId).toBe(5);
  });

  it("a request before open errors loudly (not a hang)", async () => {
    const fresh = createContext();
    const res = await run(fresh, { type: "selectSpectrum", index: 0, selectId: 1 });
    expect(res.type).toBe("error");
    if (res.type !== "error") return;
    expect(res.selectId).toBe(1);
  });

  it("an unimplemented message errors with class 'unsupported'", async () => {
    // studyMeta/deepColumn aren't wired yet → fail loud, not silent.
    const res = await run(ctx, { type: "studyMeta", requestId: 9 });
    expect(res.type).toBe("error");
    if (res.type !== "error") return;
    expect(res.class).toBe("unsupported");
    expect(res.requestId).toBe(9);
  });

  it("archiveMemberBytes returns the raw bytes of mzpeak_index.json", async () => {
    const res = await run(ctx, {
      type: "archiveMemberBytes",
      archivePath: "mzpeak_index.json",
      maxBytes: 256 * 1024 * 1024,
      requestId: 12,
    });
    expect(res.type).toBe("archiveMemberBytesResult");
    if (res.type !== "archiveMemberBytesResult") return;
    expect(res.archivePath).toBe("mzpeak_index.json");
    expect(res.truncated).toBe(false);
    expect(res.bytes.byteLength).toBeGreaterThan(0);
    // It must be valid JSON (the manifest).
    const text = new TextDecoder().decode(res.bytes);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("archiveList + parquetFooter are wired: footer for a real parquet member", async () => {
    const list = await run(ctx, { type: "archiveList", requestId: 10 });
    expect(list.type).toBe("archiveListResult");
    if (list.type !== "archiveListResult") return;
    const parquet = list.members.members.find((m) => m.isParquet);
    expect(parquet).toBeDefined();
    const res = await run(ctx, { type: "parquetFooter", archivePath: parquet!.path, requestId: 11 });
    // Dispatch-level: prove the handler is wired + returns the right shape (footer
    // depth/value parity is pinned in structure.golden.test against the LC fixture).
    expect(res.type).toBe("parquetFooterResult");
    if (res.type !== "parquetFooterResult") return;
    expect(res.footer.archivePath).toBe(parquet!.path);
    expect(Array.isArray(res.footer.columns)).toBe(true);
  });
});
