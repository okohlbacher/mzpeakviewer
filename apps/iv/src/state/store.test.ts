/**
 * Unit tests for the Phase 5 Worker-dispatcher store.
 *
 * After Plan 05-03, store.ts is a thin dispatcher:
 *  - Actions post WorkerRequest messages (no inline I/O).
 *  - The onmessage handler routes WorkerResponse messages into store state.
 *
 * These tests exercise:
 *  1. openUrl / openFile: reset state to 'zip-index' + postMessage.
 *  2. onmessage routing: each WorkerResponse type drives the correct state update.
 *  3. renderIonImage: input validation, requestId generation, isRendering flag.
 *  4. Stale renderResult discard (Pattern 5 / T-05-05).
 *  5. isRendering cleared in both renderResult AND error cases (Pitfall 7 / T-05-06).
 *
 * We drive the onmessage handler by calling useStore.getState() internals and
 * simulating what the Worker would post back. The Worker itself is mocked so
 * no actual Worker thread is created.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() is transformed to run before static imports, so store.ts sees
// the mock Worker when it evaluates `new Worker(...)` at module scope.
// Arrow functions cannot be constructors, so use a regular named function.
// When a constructor returns an object, JS uses that object as the instance.
const { mockPostMessage, mockWorker } = vi.hoisted(() => {
  const mockPostMessage = vi.fn();
  const mockWorker = {
    postMessage: mockPostMessage,
    onmessage: null as ((e: MessageEvent) => void) | null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Worker = function MockWorker() {
    return mockWorker;
  };
  return { mockPostMessage, mockWorker };
});

import { useStore } from "./store";

// Helper: simulate a WorkerResponse arriving on the main thread.
// We grab the onmessage handler that store.ts attached to the mock worker
// and call it with the given data payload.
function simulateWorkerMessage(data: unknown): void {
  const handler = mockWorker.onmessage;
  if (!handler) throw new Error("worker.onmessage not set — did store.ts attach it?");
  handler(new MessageEvent("message", { data }));
}

// The real Worker posts {type:"ready"} once its onmessage handler is registered;
// the store buffers loads until then (worker-init race fix). The mock Worker
// never sends it, so fire it once up front — otherwise openUrl/openFile would
// buffer their postMessage indefinitely and the dispatch assertions would fail.
beforeEach(() => {
  simulateWorkerMessage({ type: "ready" });
});

describe("store.openUrl", () => {
  beforeEach(() => {
    mockPostMessage.mockClear();
    useStore.setState({
      fileMeta: null,
      manifest: [],
      stats: null,
      capabilities: null,
      grid: null,
      tic: null,
      mixedRepresentationWarning: null,
      stage: "idle",
      error: null,
      selectedIndex: null,
      selectedSpectrum: null,
      mzWindow: null,
      ionImage: null,
      ionImageStats: null,
      colormap: "viridis",
      scale: "linear",
      percentile: 0.99,
      isRendering: false,
    });
  });

  it("resets state to zip-index and posts loadUrl message", () => {
    useStore.getState().openUrl("http://example.com/demo.mzpeak");

    const state = useStore.getState();
    expect(state.stage).toBe("zip-index");
    expect(state.error).toBeNull();

    expect(mockPostMessage).toHaveBeenCalledOnce();
    const [msg] = mockPostMessage.mock.calls[0];
    expect(msg.type).toBe("loadUrl");
    expect(msg.url).toBe("http://example.com/demo.mzpeak");
  });

  it("clears prior state on new openUrl call", () => {
    // Pre-load some state.
    useStore.setState({
      stage: "ready",
      error: { class: "corrupt", message: "old error" },
      manifest: [{ name: "x", entityType: "spectrum", dataKind: "data arrays" }],
    });

    useStore.getState().openUrl("http://example.com/new.mzpeak");

    const state = useStore.getState();
    expect(state.stage).toBe("zip-index");
    expect(state.error).toBeNull();
    expect(state.manifest).toEqual([]);
  });
});

describe("store.openFile", () => {
  beforeEach(() => {
    mockPostMessage.mockClear();
    useStore.setState({ stage: "idle", error: null });
  });

  it("resets state to zip-index and posts loadFile message with transferred buffer", async () => {
    const file = new File(["fake bytes"], "demo.mzpeak", { type: "application/octet-stream" });
    await useStore.getState().openFile(file);

    const state = useStore.getState();
    expect(state.stage).toBe("zip-index");

    expect(mockPostMessage).toHaveBeenCalledOnce();
    const [msg, transferList] = mockPostMessage.mock.calls[0];
    expect(msg.type).toBe("loadFile");
    expect(msg.name).toBe("demo.mzpeak");
    expect(msg.bytes).toBeInstanceOf(ArrayBuffer);
    // Transfer list must contain the buffer (Pattern 4 / Pitfall 3).
    expect(transferList).toContain(msg.bytes);
  });
});

describe("store onmessage handler — WorkerResponse routing", () => {
  beforeEach(() => {
    useStore.setState({
      stage: "idle",
      error: null,
      isRendering: false,
      manifest: [],
      fileMeta: null,
      stats: null,
      capabilities: null,
      grid: null,
      tic: null,
      mixedRepresentationWarning: null,
      selectedIndex: null,
      selectedSpectrum: null,
    });
  });

  it("progress message updates stage", () => {
    simulateWorkerMessage({ type: "progress", stage: "metadata" });
    expect(useStore.getState().stage).toBe("metadata");
  });

  it("loadResult message sets stage:ready and all result fields", () => {
    const manifest = [{ name: "x", entityType: "spectrum", dataKind: "data arrays" }];
    const fileMeta = {
      fileDescription: {},
      instrumentConfigurations: [],
      software: [],
      run: null,
      samples: [],
    };
    const stats = {
      numSpectra: 5,
      numEntities: 1,
      mzRange: null,
      msLevels: [1],
      representationCounts: { profile: 5, centroid: 0 },
    };
    const capabilities = {
      layout: "point" as const,
      encodings: ["MS:1000514"],
      isImaging: true,
      unsupported: [],
    };

    simulateWorkerMessage({
      type: "loadResult",
      result: {
        manifest,
        fileMeta,
        stats,
        capabilities,
        grid: null,
        tic: null,
        mixedRepresentationWarning: null,
      },
    });

    const state = useStore.getState();
    expect(state.stage).toBe("ready");
    expect(state.error).toBeNull();
    expect(state.manifest).toEqual(manifest);
    expect(state.stats?.numSpectra).toBe(5);
    expect(state.capabilities?.isImaging).toBe(true);
    expect(state.selectedIndex).toBeNull();
  });

  it("noImaging message sets stage:no-imaging and clears grid/tic", () => {
    simulateWorkerMessage({
      type: "noImaging",
      result: {
        manifest: [{ name: "x", entityType: "spectrum", dataKind: "data arrays" }],
        fileMeta: { fileDescription: {}, instrumentConfigurations: [], software: [], run: null, samples: [] },
        stats: { numSpectra: 2, numEntities: 1, mzRange: null, msLevels: [1], representationCounts: { profile: 2, centroid: 0 } },
        capabilities: { layout: "point" as const, encodings: [], isImaging: false, unsupported: [] },
      },
    });

    const state = useStore.getState();
    expect(state.stage).toBe("no-imaging");
    expect(state.grid).toBeNull();
    expect(state.tic).toBeNull();
    expect(state.error).toBeNull();
  });

  it("spectrumResult message updates selectedIndex and selectedSpectrum", () => {
    const spectrum = {
      index: 3,
      id: "spectrum-3",
      mz: Float64Array.from([100, 200, 300]),
      intensity: Float32Array.from([10, 20, 30]),
    };

    // Drive a real selection so the result carries the live selectId; the worker
    // echoes it and the store only applies a matching (non-stale) response.
    mockPostMessage.mockClear();
    useStore.getState().selectSpectrum(3);
    const req = mockPostMessage.mock.calls
      .map((c) => c[0])
      .find((m) => m?.type === "selectSpectrum");
    simulateWorkerMessage({ type: "spectrumResult", spectrum, selectId: req.selectId });

    const state = useStore.getState();
    expect(state.selectedIndex).toBe(3);
    expect(state.selectedSpectrum).toBe(spectrum);
  });

  it("spectrumResult with a stale selectId is discarded", () => {
    const spectrum = {
      index: 9,
      id: "spectrum-9",
      mz: Float64Array.from([1, 2]),
      intensity: Float32Array.from([3, 4]),
    };
    useStore.getState().selectSpectrum(9); // bumps the live selectId
    simulateWorkerMessage({ type: "spectrumResult", spectrum, selectId: -1 });
    // Stale id (-1) → ignored; selectedSpectrum stays null from the reset.
    expect(useStore.getState().selectedSpectrum).toBeNull();
  });

  it("error message sets stage:error and clears isRendering (Pitfall 7 / T-05-06)", () => {
    useStore.setState({ isRendering: true });

    simulateWorkerMessage({
      type: "error",
      class: "corrupt",
      message: "file parse failed",
    });

    const state = useStore.getState();
    expect(state.stage).toBe("error");
    expect(state.error?.class).toBe("corrupt");
    expect(state.error?.message).toBe("file parse failed");
    // CRITICAL: isRendering must be cleared on error.
    expect(state.isRendering).toBe(false);
  });

  it("error message with findings passes findings to state", () => {
    const findings = [{ code: "MS:1001483", label: "Numpress linear prediction" }];
    simulateWorkerMessage({
      type: "error",
      class: "unsupported-encoding",
      message: "unsupported encoding",
      findings,
    });

    const state = useStore.getState();
    expect(state.error?.class).toBe("unsupported-encoding");
    expect(state.error?.findings).toEqual(findings);
  });
});

describe("store.renderIonImage — dispatch and requestId", () => {
  beforeEach(() => {
    mockPostMessage.mockClear();
    // Set up a state where renderIonImage is valid (needs grid + stats).
    useStore.setState({
      isRendering: false,
      mzWindow: null,
      ionImage: null,
      ionImageStats: null,
      grid: {
        width: 2,
        height: 1,
        coordinateBase: 1,
        pixelSizeUm: null,
        coordToSpectrumIndex: new Map([[0, 0], [1, 1]]),
        presenceMask: Uint8Array.from([1, 1]),
        filledCount: 2,
        totalCells: 2,
        coordSourceStrategy: "promoted-columns",
        diagnostics: {
          spectrumCount: 2,
          uniqueCoordCount: 2,
          duplicateCount: 0,
          missingCount: 0,
          extentSource: "max-coord",
          geometrySource: "derived",
          discoveryDisagreement: null,
          oobCount: 0,
        },
      },
      stats: {
        numSpectra: 2,
        numEntities: 1,
        mzRange: null,
        msLevels: [1],
        representationCounts: { profile: 2, centroid: 0 },
      },
    });
  });

  it("posts renderIonImage message and sets isRendering:true", () => {
    useStore.getState().renderIonImage(500, 0.5);

    const state = useStore.getState();
    expect(state.isRendering).toBe(true);
    // mzWindow is not set optimistically — only applied when ionImage is confirmed non-null
    expect(state.mzWindow).toBeNull();

    expect(mockPostMessage).toHaveBeenCalledOnce();
    const [msg] = mockPostMessage.mock.calls[0];
    expect(msg.type).toBe("renderIonImage");
    expect(msg.mz).toBe(500);
    expect(msg.tolDa).toBe(0.5);
    expect(typeof msg.requestId).toBe("number");
  });

  it("rejects invalid mz values (V5 validation guard / ASVS L1)", () => {
    useStore.getState().renderIonImage(0, 0.5);  // mz must be > 0
    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(useStore.getState().isRendering).toBe(false);

    useStore.getState().renderIonImage(NaN, 0.5);
    expect(mockPostMessage).not.toHaveBeenCalled();

    useStore.getState().renderIonImage(0.3, 0.5);  // mz - tolDa < 0 is non-physical
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it("dispatches renderIonImage even when grid is null (lazy init — Worker handles it)", () => {
    // After the lazy-load refactor, renderIonImage posts to the Worker regardless of
    // grid/stats state. The Worker calls initReaderAndGrid() on the first call.
    useStore.setState({ grid: null });
    useStore.getState().renderIonImage(500, 0.5);
    expect(mockPostMessage).toHaveBeenCalledOnce();
    const msg = mockPostMessage.mock.calls[0][0];
    expect(msg.type).toBe("renderIonImage");
    expect(msg.mz).toBe(500);
  });
});

describe("store — stale renderResult discard (Pattern 5 / T-05-05)", () => {
  beforeEach(() => {
    mockPostMessage.mockClear();
    useStore.setState({
      isRendering: false,
      ionImage: null,
      ionImageStats: null,
      grid: {
        width: 2,
        height: 1,
        coordinateBase: 1,
        pixelSizeUm: null,
        coordToSpectrumIndex: new Map([[0, 0], [1, 1]]),
        presenceMask: Uint8Array.from([1, 1]),
        filledCount: 2,
        totalCells: 2,
        coordSourceStrategy: "promoted-columns",
        diagnostics: {
          spectrumCount: 2,
          uniqueCoordCount: 2,
          duplicateCount: 0,
          missingCount: 0,
          extentSource: "max-coord",
          geometrySource: "derived",
          discoveryDisagreement: null,
          oobCount: 0,
        },
      },
      stats: {
        numSpectra: 2,
        numEntities: 1,
        mzRange: null,
        msLevels: [1],
        representationCounts: { profile: 2, centroid: 0 },
      },
    });
  });

  it("applies renderResult when requestId matches current", () => {
    useStore.getState().renderIonImage(500, 0.5);
    const [msg] = mockPostMessage.mock.calls[0];
    const rid = msg.requestId;

    const ionImage = Float32Array.from([0.1, 0.9]);
    simulateWorkerMessage({
      type: "renderResult",
      ionImage,
      stats: { nonzeroCount: 2, min: 0.1, max: 0.9 },
      requestId: rid,
    });

    const state = useStore.getState();
    expect(state.isRendering).toBe(false);
    expect(state.ionImage).toBe(ionImage);
    expect(state.ionImageStats?.max).toBe(0.9);
  });

  it("discards stale renderResult when requestId does not match", () => {
    useStore.getState().renderIonImage(500, 0.5);
    const [firstMsg] = mockPostMessage.mock.calls[0];
    const firstRid = firstMsg.requestId;

    // Send a second request (increments currentRequestId).
    mockPostMessage.mockClear();
    useStore.getState().renderIonImage(600, 0.5);

    // Simulate the old (stale) response arriving.
    simulateWorkerMessage({
      type: "renderResult",
      ionImage: Float32Array.from([0.5]),
      stats: { nonzeroCount: 1, min: 0.5, max: 0.5 },
      requestId: firstRid, // stale ID
    });

    // State should NOT be updated — ionImage stays null (from beforeEach).
    const state = useStore.getState();
    expect(state.ionImage).toBeNull();
    // isRendering stays true because the stale response was discarded.
    expect(state.isRendering).toBe(true);
  });

  it("clears isRendering when fresh renderResult arrives", () => {
    useStore.getState().renderIonImage(500, 0.5);
    const [msg] = mockPostMessage.mock.calls[0];
    const rid = msg.requestId;

    simulateWorkerMessage({
      type: "renderResult",
      ionImage: null,
      stats: null,
      requestId: rid,
    });

    expect(useStore.getState().isRendering).toBe(false);
  });
});
