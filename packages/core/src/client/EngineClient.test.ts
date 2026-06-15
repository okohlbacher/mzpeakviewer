// EngineClient unit tests — driven by a hand-rolled FAKE worker so the full
// correlation / ready-buffer / transfer / cancel / stale-drop logic is exercised
// without a real Web Worker, mzpeakts, or the DOM.

import { describe, it, expect, vi } from "vitest";
import type {
  WorkerResponse,
  SpectrumArrays,
  FileStats,
  IonImageStats,
  CapabilityModel,
} from "@mzpeak/contracts";
import { EngineClient, EngineError, SupersededError, EngineClosedError, type WorkerLike } from "./EngineClient";

// ---------------------------------------------------------------------------
// Fake worker — records every postMessage (payload + transfer list) and lets the
// test push responses back through the registered message listener by hand.
// ---------------------------------------------------------------------------

class FakeWorker implements WorkerLike {
  readonly sent: { msg: unknown; transfer?: Transferable[] }[] = [];
  private listener: ((ev: { data: WorkerResponse }) => void) | null = null;
  terminated = false;

  postMessage(msg: unknown, transfer?: Transferable[]): void {
    this.sent.push({ msg, transfer });
  }

  addEventListener(_type: "message", cb: (ev: { data: WorkerResponse }) => void): void {
    this.listener = cb;
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Drive an inbound response as if the worker posted it. */
  push(data: WorkerResponse): void {
    if (!this.listener) throw new Error("FakeWorker: no listener registered");
    this.listener({ data });
  }

  /** The last message sent (by type narrowing convenience). */
  last(): { msg: any; transfer?: Transferable[] } {
    return this.sent[this.sent.length - 1] as any;
  }
}

// --- minimal valid payload builders ---------------------------------------

function spectrum(index: number): SpectrumArrays {
  return {
    index,
    id: `scan=${index}`,
    mz: new Float64Array([100, 200]),
    intensity: new Float32Array([1, 2]),
    representation: "profile",
  };
}

const STATS: FileStats = {
  numSpectra: 1,
  numEntities: 1,
  mzRange: [100, 200],
  rtRange: null,
  msLevels: [1],
  representationCounts: { profile: 1, centroid: 0 },
};

const CAPS = {} as CapabilityModel;

const ION_STATS: IonImageStats = { nonzeroCount: 1, min: 0, max: 1 };

describe("EngineClient", () => {
  it("(a) buffers requests until ready, then flushes in order", async () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);

    // Two requests posted before ready — nothing should reach the worker yet.
    const p1 = client.scanBreakdown();
    const p2 = client.archiveList();
    expect(fw.sent).toHaveLength(0);

    // Worker becomes ready → buffered requests flush in submission order.
    fw.push({ type: "ready" });
    expect(fw.sent).toHaveLength(2);
    expect((fw.sent[0].msg as any).type).toBe("scanBreakdown");
    expect((fw.sent[1].msg as any).type).toBe("archiveList");

    // And they still resolve normally once their results arrive.
    const sbId = (fw.sent[0].msg as any).requestId;
    const alId = (fw.sent[1].msg as any).requestId;
    fw.push({ type: "scanBreakdownResult", requestId: sbId, stats: STATS, browse: { id: [], msLevel: new Int16Array(), rt: new Float32Array(), tic: new Float32Array() } });
    fw.push({ type: "archiveListResult", requestId: alId, members: { members: [] } as any });
    await expect(p1).resolves.toMatchObject({ stats: STATS });
    await expect(p2).resolves.toBeDefined();
  });

  it("(b) a request resolves with its correlated response", async () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const p = client.renderIonImage(150, 0.5);
    const { msg } = fw.last();
    expect(msg.type).toBe("renderIonImage");
    expect(msg.mz).toBe(150);
    expect(msg.tolDa).toBe(0.5);

    const img = new Float32Array([0, 1, 2]);
    fw.push({ type: "renderResult", requestId: msg.requestId, ionImage: img, stats: ION_STATS });
    await expect(p).resolves.toEqual({ ionImage: img, stats: ION_STATS });
  });

  it("(b2) renderIonImage forwards renderPreview partials to onPreview for THIS request only", async () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const onPreview = vi.fn();
    const p = client.renderIonImage(150, 0.5, undefined, onPreview);
    const { msg } = fw.last();

    const partial = new Float32Array([5, 6]);
    fw.push({ type: "renderPreview", requestId: msg.requestId, ionImage: partial, stats: ION_STATS });
    fw.push({ type: "renderPreview", requestId: msg.requestId + 999, ionImage: new Float32Array([0]), stats: ION_STATS });
    expect(onPreview).toHaveBeenCalledTimes(1); // the other request's preview is ignored
    expect(onPreview).toHaveBeenCalledWith(partial, ION_STATS);

    // Settling the render detaches the preview subscription.
    const final = new Float32Array([7, 8]);
    fw.push({ type: "renderResult", requestId: msg.requestId, ionImage: final, stats: ION_STATS });
    await expect(p).resolves.toEqual({ ionImage: final, stats: ION_STATS });
    fw.push({ type: "renderPreview", requestId: msg.requestId, ionImage: new Float32Array([9]), stats: ION_STATS });
    expect(onPreview).toHaveBeenCalledTimes(1); // no delivery after settle
  });

  it("(c) an {type:error, requestId} rejects the right promise", async () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const pErr = client.parquetFooter("spectra_data.parquet");
    const pOk = client.archiveList();
    const errId = (fw.sent[0].msg as any).requestId;
    const okId = (fw.sent[1].msg as any).requestId;

    // Error targets ONLY the first request.
    fw.push({ type: "error", requestId: errId, class: "parse", message: "bad footer" });
    await expect(pErr).rejects.toBeInstanceOf(EngineError);
    await expect(pErr).rejects.toMatchObject({ class: "parse", message: "bad footer" });

    // The unrelated request is untouched and still resolves.
    fw.push({ type: "archiveListResult", requestId: okId, members: { members: [] } as any });
    await expect(pOk).resolves.toBeDefined();
  });

  it("(d) cancel posts the cancel message and rejects the pending promise", async () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const p = client.renderIonImage(150, 0.5);
    const rid = (fw.last().msg as any).requestId;
    // Swallow the rejection so it doesn't surface as unhandled.
    p.catch(() => {});

    client.cancel(rid);
    const cancelMsg = fw.last().msg as any;
    expect(cancelMsg.type).toBe("cancel");
    expect(cancelMsg.cancelId).toBe(rid);

    await expect(p).rejects.toMatchObject({ requestId: rid });
  });

  it("(e) a stale selectSpectrum response (older selectId) is dropped", async () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const pOld = client.selectSpectrum(10);
    const oldSelectId = (fw.sent[0].msg as any).selectId;
    const pNew = client.selectSpectrum(11);
    const newSelectId = (fw.sent[1].msg as any).selectId;
    expect(newSelectId).toBeGreaterThan(oldSelectId);

    const oldResolved = vi.fn();
    pOld.then(oldResolved, () => {});

    // Stale (older) response arrives first — must be dropped, never resolving pOld.
    fw.push({ type: "spectrumResult", selectId: oldSelectId, spectrum: spectrum(10) });
    // Newest response resolves its promise.
    fw.push({ type: "spectrumResult", selectId: newSelectId, spectrum: spectrum(11) });

    await expect(pNew).resolves.toMatchObject({ index: 11 });
    // Give microtasks a tick; the stale promise must still be unresolved.
    await Promise.resolve();
    expect(oldResolved).not.toHaveBeenCalled();
  });

  it("(f) a file open transfers the bytes buffer in the transfer list", () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const bytes = new ArrayBuffer(8);
    void client.open({ kind: "file", bytes, name: "sample.mzpeak" });

    const { msg, transfer } = fw.last();
    expect((msg as any).type).toBe("open");
    expect(transfer).toBeDefined();
    expect(transfer).toContain(bytes);
    expect(transfer).toHaveLength(1);
  });

  it("(f.2) a url open carries NO transfer list", () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    void client.open({ kind: "url", url: "https://example.org/x.mzpeak" });
    const { transfer } = fw.last();
    expect(transfer).toBeUndefined();
  });

  it("routes unsolicited events to on() subscribers", () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const onProgress = vi.fn();
    const onIndexReady = vi.fn();
    const unsub = client.on("renderProgress", onProgress);
    client.on("ionIndexReady", onIndexReady);

    fw.push({ type: "renderProgress", requestId: 1, done: 3, total: 10 });
    fw.push({ type: "ionIndexReady", points: 42 });
    expect(onProgress).toHaveBeenCalledWith({ type: "renderProgress", requestId: 1, done: 3, total: 10 });
    expect(onIndexReady).toHaveBeenCalledWith({ type: "ionIndexReady", points: 42 });

    // Unsubscribe stops delivery.
    unsub();
    fw.push({ type: "renderProgress", requestId: 1, done: 6, total: 10 });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it("open resolves with the unwrapped opened payload", async () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const p = client.open({ kind: "url", url: "https://x/y.mzpeak" });
    const rid = (fw.last().msg as any).requestId;
    const tic = new Float32Array([1, 2, 3]);
    fw.push({
      type: "opened",
      requestId: rid,
      capabilities: CAPS,
      manifest: [],
      fileMeta: null,
      stats: STATS,
      grid: null,
      tic,
      opticalImages: [],
      fileSize: 1234,
      mixedRepresentationWarning: null,
    });
    const result = await p;
    expect(result.stats).toBe(STATS);
    expect(result.tic).toBe(tic);
    expect(result.fileSize).toBe(1234);
    // The envelope (type/requestId) is stripped.
    expect("type" in result).toBe(false);
    expect("requestId" in result).toBe(false);
  });

  it("(g) a superseded selectSpectrum REJECTS (no pending-forever leak)", async () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const pOld = client.selectSpectrum(10);
    const pNew = client.selectSpectrum(11); // supersedes pOld immediately
    await expect(pOld).rejects.toBeInstanceOf(SupersededError);

    const newSelectId = (fw.sent[1].msg as any).selectId;
    fw.push({ type: "spectrumResult", selectId: newSelectId, spectrum: spectrum(11) });
    await expect(pNew).resolves.toMatchObject({ index: 11 });
  });

  it("(h) close() rejects every pending Promise with EngineClosedError", async () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const pReq = client.scanBreakdown();
    const pSel = client.selectSpectrum(3);
    client.close();
    await expect(pReq).rejects.toBeInstanceOf(EngineClosedError);
    await expect(pSel).rejects.toBeInstanceOf(EngineClosedError);
    expect((fw.last().msg as any).type).toBe("close");
  });

  it("(i) a selectId-correlated error rejects the right select", async () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const p = client.selectSpectrum(7);
    const selectId = (fw.last().msg as any).selectId;
    fw.push({ type: "error", selectId, class: "parse", message: "bad spectrum" });
    await expect(p).rejects.toMatchObject({ class: "parse", message: "bad spectrum" });
  });

  it("(j) a new open supersedes a pending open", async () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const p1 = client.open({ kind: "url", url: "a.mzpeak" });
    const p2 = client.open({ kind: "url", url: "b.mzpeak" });
    await expect(p1).rejects.toBeInstanceOf(SupersededError);

    const openId = (fw.last().msg as any).requestId;
    fw.push({
      type: "opened",
      requestId: openId,
      capabilities: CAPS,
      manifest: [],
      fileMeta: null,
      stats: null,
      grid: null,
      tic: null,
      opticalImages: [],
      fileSize: null,
      mixedRepresentationWarning: null,
    });
    await expect(p2).resolves.toBeDefined();
  });

  it("(k) an unattributed error surfaces on the 'error' event channel", () => {
    const fw = new FakeWorker();
    const client = new EngineClient(fw);
    fw.push({ type: "ready" });

    const seen = vi.fn();
    client.on("error", seen);
    fw.push({ type: "error", class: "internal", message: "wasm init failed" });
    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0]![0]).toMatchObject({ class: "internal", message: "wasm init failed" });
  });
});
