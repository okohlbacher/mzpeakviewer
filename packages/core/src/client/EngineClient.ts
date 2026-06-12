// EngineClient — the main-thread protocol client for the @mzpeak/core engine.
//
// PURE plumbing: it owns the postMessage boundary, the WASM-init "ready" race
// buffer, request/response correlation (requestId / selectId), transfer lists,
// cancellation, and the routing of unsolicited / streaming responses to event
// callbacks. It knows NOTHING about mzpeakts, Arrow, parquet, or the DOM beyond
// the Worker/MessagePort shape — so a fake worker drives it in tests.
//
// Correlation model (mirrors mzPeakIV's store.ts):
//   - Request types that carry a `requestId` resolve a Promise when the matching
//     `*Result` response (same requestId) lands, and reject on `{type:"error",
//     requestId}`.
//   - `selectSpectrum` is correlated by `selectId` (monotonic). A `spectrumResult`
//     with an OLDER selectId than the latest in-flight select is DROPPED
//     (MESSAGE_POLICY selectSpectrum.cancellation === "stale-drop").
//   - Streaming / unsolicited responses (progress, renderProgress, ionIndex*,
//     opticalImage*) don't resolve a single request — they fan out to `on(type)`
//     subscribers.

import type {
  WorkerRequest,
  WorkerResponse,
  OpenSource,
  ChromRequest,
  ChannelRequest,
  SpectrumArrays,
  FileStats,
  BrowseIndex,
  ChromatogramSeries,
  ArchiveMemberList,
  ParquetFooter,
  ColumnPage,
  ColumnSample,
  StudyMeta,
  IonImageStats,
  CapabilityModel,
  Manifest,
  FileMeta,
  ImagingGridWire,
  OpticalImageMeta,
  ReaderErrorClass,
  UnsupportedFinding,
} from "@mzpeak/contracts";
import { MESSAGE_POLICY } from "@mzpeak/contracts";

// ---------------------------------------------------------------------------
// Worker-like surface — the minimal shape EngineClient needs. The real Web
// Worker satisfies this; tests pass a hand-driven fake.
// ---------------------------------------------------------------------------

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (ev: { data: WorkerResponse }) => void,
  ): void;
  terminate?(): void;
}

// ---------------------------------------------------------------------------
// Result-shape helpers — the resolved value for each request convenience method.
// These strip the protocol envelope (type/requestId) down to the payload.
// ---------------------------------------------------------------------------

/** Payload of the `opened` response (sans envelope). */
export type OpenedResult = {
  capabilities: CapabilityModel;
  manifest: Manifest;
  fileMeta: FileMeta | null;
  stats: FileStats | null;
  grid: ImagingGridWire | null;
  tic: Float32Array | null;
  opticalImages: OpticalImageMeta[];
  fileSize: number | null;
  mixedRepresentationWarning: string | null;
};

export type ScanBreakdownResult = { stats: FileStats; browse: BrowseIndex };
export type RenderIonImageResult = {
  ionImage: Float32Array | null;
  stats: IonImageStats | null;
};
export type ArchiveMemberBytesResult = {
  archivePath: string;
  bytes: ArrayBuffer;
  truncated: boolean;
};

/** A structured error mirrored from `{type:"error"}`; thrown by rejected promises. */
export class EngineError extends Error {
  readonly class: ReaderErrorClass;
  readonly findings?: UnsupportedFinding[];
  readonly requestId?: number;
  constructor(
    klass: ReaderErrorClass,
    message: string,
    findings?: UnsupportedFinding[],
    requestId?: number,
  ) {
    super(message);
    this.name = "EngineError";
    this.class = klass;
    this.findings = findings;
    this.requestId = requestId;
  }
}

/** Rejection thrown into a pending request's Promise when it is cancelled. */
export class CancelledError extends Error {
  readonly requestId: number;
  constructor(requestId: number) {
    super(`Request ${requestId} cancelled`);
    this.name = "CancelledError";
    this.requestId = requestId;
  }
}

/** A select/open Promise that was superseded by a newer one (latest-wins). */
export class SupersededError extends Error {
  constructor(what: string) {
    super(`${what} superseded by a newer request`);
    this.name = "SupersededError";
  }
}

/** A pending Promise rejected because the session was closed. */
export class EngineClosedError extends Error {
  constructor() {
    super("Engine session closed");
    this.name = "EngineClosedError";
  }
}

// ---------------------------------------------------------------------------
// Event types — the unsolicited / streaming responses a consumer can subscribe
// to. These never resolve a single request, so they're delivered via `on(...)`.
// ---------------------------------------------------------------------------

export type EngineEventMap = {
  progress: Extract<WorkerResponse, { type: "progress" }>;
  renderProgress: Extract<WorkerResponse, { type: "renderProgress" }>;
  ionIndexPreloading: Extract<WorkerResponse, { type: "ionIndexPreloading" }>;
  ionIndexPreloadAborted: Extract<WorkerResponse, { type: "ionIndexPreloadAborted" }>;
  ionIndexReady: Extract<WorkerResponse, { type: "ionIndexReady" }>;
  opticalImageResult: Extract<WorkerResponse, { type: "opticalImageResult" }>;
  opticalImageError: Extract<WorkerResponse, { type: "opticalImageError" }>;
  opticalImageSkipped: Extract<WorkerResponse, { type: "opticalImageSkipped" }>;
  /** A global/unattributed engine error (no requestId/selectId — e.g. WASM init). */
  error: Extract<WorkerResponse, { type: "error" }>;
};

export type EngineEventType = keyof EngineEventMap;
export type EngineEventCallback<T extends EngineEventType> = (
  ev: EngineEventMap[T],
) => void;

// ---------------------------------------------------------------------------
// Internal correlation bookkeeping.
// ---------------------------------------------------------------------------

type PendingResolver = {
  /** Response `type` that resolves this request. */
  resolveType: WorkerResponse["type"];
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

/** Maps each request type to the response type that resolves it. */
const RESOLVE_TYPE: Partial<Record<WorkerRequest["type"], WorkerResponse["type"]>> = {
  open: "opened",
  scanBreakdown: "scanBreakdownResult",
  meanSpectrum: "meanSpectrumResult",
  roiSpectrum: "meanSpectrumResult",
  extractChrom: "chromResult",
  archiveList: "archiveListResult",
  parquetFooter: "parquetFooterResult",
  deepColumn: "deepColumnResult",
  sampleColumn: "sampleColumnResult",
  archiveMemberBytes: "archiveMemberBytesResult",
  studyMeta: "studyMetaResult",
  renderIonImage: "renderResult",
  renderMultiChannel: "multiChannelResult",
};

// ---------------------------------------------------------------------------
// Transfer-list extraction — pull the transferable buffer(s) out of an outbound
// request payload so postMessage moves them zero-copy. Only `open` with a file
// source carries a transferable buffer on the INBOUND side (the request bytes).
// (Outbound result transfers are the worker's concern, not the client's.)
// ---------------------------------------------------------------------------

function transferListFor(req: WorkerRequest): Transferable[] | undefined {
  if (req.type === "open" && req.source.kind === "file") {
    return [req.source.bytes];
  }
  return undefined;
}

export class EngineClient {
  private readonly worker: WorkerLike;

  /** True once the worker has posted {type:"ready"} past its WASM top-level await. */
  private ready = false;
  /** Outbound requests queued before `ready`; flushed in-order on ready. */
  private outbox: { req: WorkerRequest; transfer?: Transferable[] }[] = [];

  /** Monotonic counter for requestId-carrying requests. */
  private nextRequestId = 1;
  /** Monotonic counter for selectSpectrum's selectId. */
  private nextSelectId = 1;
  /** The latest selectId we've sent — older spectrumResults are stale-dropped. */
  private latestSelectId = 0;
  /** requestId of the in-flight `open`, if any (a new open supersedes it). 0 = none. */
  private openRequestId = 0;

  /** requestId → pending resolver (requestId-correlated requests). */
  private readonly pendingByRequestId = new Map<number, PendingResolver>();
  /** selectId → pending resolver (selectSpectrum). */
  private readonly pendingBySelectId = new Map<number, PendingResolver>();

  /** event type → subscriber set. */
  private readonly listeners = new Map<EngineEventType, Set<(ev: unknown) => void>>();

  constructor(worker: WorkerLike) {
    this.worker = worker;
    this.worker.addEventListener("message", (ev) => this.handleMessage(ev.data));
  }

  // -------------------------------------------------------------------------
  // Event subscription for unsolicited / streaming responses.
  // -------------------------------------------------------------------------

  /** Subscribe to a streaming/unsolicited event. Returns an unsubscribe fn. */
  on<T extends EngineEventType>(type: T, cb: EngineEventCallback<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const wrapped = cb as (ev: unknown) => void;
    set.add(wrapped);
    return () => set!.delete(wrapped);
  }

  // -------------------------------------------------------------------------
  // Outbound send + the ready buffer.
  // -------------------------------------------------------------------------

  /** Post (or buffer until ready) a request. Fire-and-forget; no correlation. */
  private send(req: WorkerRequest, transfer?: Transferable[]): void {
    if (!this.ready) {
      this.outbox.push({ req, transfer });
      return;
    }
    this.worker.postMessage(req, transfer);
  }

  /**
   * Post a requestId-correlated request and return a Promise that resolves on the
   * matching `*Result` (same requestId) and rejects on `{type:"error",requestId}`.
   * The caller's `build` callback receives the freshly-assigned requestId and
   * returns the fully-formed request (this keeps each request a clean object
   * literal against the discriminated union, sidestepping `Omit<union>` quirks).
   */
  private request<R>(
    build: (requestId: number) => Extract<WorkerRequest, { requestId: number }>,
  ): Promise<R> {
    const requestId = this.nextRequestId++;
    const req = build(requestId);
    const resolveType = RESOLVE_TYPE[req.type];
    if (!resolveType) {
      return Promise.reject(
        new Error(`EngineClient: request type "${req.type}" is not requestId-correlated`),
      );
    }
    return new Promise<R>((resolve, reject) => {
      this.pendingByRequestId.set(requestId, {
        resolveType,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.send(req, transferListFor(req));
    });
  }

  // -------------------------------------------------------------------------
  // Typed convenience methods.
  // -------------------------------------------------------------------------

  /**
   * Open a file (transfers `bytes`) or URL. Resolves with the opened payload. The
   * engine is single-open: a new open SUPERSEDES any in-flight open (its Promise
   * rejects with SupersededError, and a buffered-but-unsent open is removed from the
   * outbox so two opens can't both run on the worker — review M6).
   */
  open(source: OpenSource): Promise<OpenedResult> {
    if (this.openRequestId !== 0) this.supersedeRequest(this.openRequestId);
    const p = this.request<OpenedResult>((requestId) => {
      this.openRequestId = requestId;
      return { type: "open", requestId, source };
    });
    // Clear the tracked open once it settles (success or failure).
    void p.then(
      () => { this.openRequestId = 0; },
      () => { this.openRequestId = 0; },
    );
    return p;
  }

  /**
   * Close the active reader. Rejects every pending request/select Promise with
   * EngineClosedError — after close the worker drops in-flight work, so awaiting
   * callers must not hang (review C2).
   */
  close(): void {
    this.send({ type: "close" });
    this.rejectAllPending(() => new EngineClosedError());
  }

  /** Push caching policy to the worker. Fire-and-forget. */
  setCacheConfig(preloadEnabled: boolean, cacheLimitBytes: number): void {
    this.send({ type: "setCacheConfig", preloadEnabled, cacheLimitBytes });
  }

  /**
   * Select a spectrum by index. Correlated by a monotonic selectId; latest-wins. A
   * new select SUPERSEDES any pending select (its Promise rejects with
   * SupersededError) so no awaiting caller hangs and no resolver leaks (review C1/C5).
   */
  selectSpectrum(index: number): Promise<SpectrumArrays> {
    // Supersede any pending select(s) — there should be at most one, but clear all.
    for (const [sid, pending] of this.pendingBySelectId) {
      this.pendingBySelectId.delete(sid);
      pending.reject(new SupersededError("selectSpectrum"));
    }
    const selectId = this.nextSelectId++;
    this.latestSelectId = selectId;
    return new Promise<SpectrumArrays>((resolve, reject) => {
      this.pendingBySelectId.set(selectId, {
        resolveType: "spectrumResult",
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.send({ type: "selectSpectrum", index, selectId });
    });
  }

  /** Time-sliced aggregate pass: MS-level counts, mz/rt range, browse index. */
  scanBreakdown(): Promise<ScanBreakdownResult> {
    return this.request<ScanBreakdownResult>((requestId) => ({ type: "scanBreakdown", requestId }));
  }

  /** Mean spectrum across all (or sampled) pixels. */
  meanSpectrum(): Promise<SpectrumArrays> {
    return this.request<SpectrumArrays>((requestId) => ({ type: "meanSpectrum", requestId }));
  }

  /** Mean spectrum across a set of spectrum indices (ROI). */
  roiSpectrum(spectrumIndices: number[]): Promise<SpectrumArrays> {
    return this.request<SpectrumArrays>((requestId) => ({ type: "roiSpectrum", spectrumIndices, requestId }));
  }

  /** Extract a chromatogram (TIC / XIC / XIC-range / stored). */
  extractChrom(chrom: ChromRequest): Promise<ChromatogramSeries> {
    return this.request<ChromatogramSeries>((requestId) => ({ type: "extractChrom", chrom, requestId }));
  }

  /** List archive members (Explorer Structure tab). */
  archiveList(): Promise<ArchiveMemberList> {
    return this.request<ArchiveMemberList>((requestId) => ({ type: "archiveList", requestId }));
  }

  /** Read a parquet member's footer/schema. */
  parquetFooter(archivePath: string): Promise<ParquetFooter> {
    return this.request<ParquetFooter>((requestId) => ({ type: "parquetFooter", archivePath, requestId }));
  }

  /** Paged deep column read. */
  deepColumn(
    archivePath: string,
    column: string,
    offset: number,
    limit: number,
  ): Promise<ColumnPage> {
    return this.request<ColumnPage>((requestId) => ({
      type: "deepColumn",
      archivePath,
      column,
      offset,
      limit,
      requestId,
    }));
  }

  /** Sample `n` values from a column. */
  sampleColumn(archivePath: string, column: string, n: number): Promise<ColumnSample> {
    return this.request<ColumnSample>((requestId) => ({ type: "sampleColumn", archivePath, column, n, requestId }));
  }

  /** Raw member bytes, capped at `maxBytes`; the result buffer is transferred. */
  archiveMemberBytes(
    archivePath: string,
    maxBytes: number,
  ): Promise<ArchiveMemberBytesResult> {
    return this.request<ArchiveMemberBytesResult>((requestId) => ({
      type: "archiveMemberBytes",
      archivePath,
      maxBytes,
      requestId,
    }));
  }

  /** Study metadata (Explorer SDRF/ISA). */
  studyMeta(): Promise<StudyMeta> {
    return this.request<StudyMeta>((requestId) => ({ type: "studyMeta", requestId }));
  }

  /** Render a single-channel ion image for an m/z window. */
  renderIonImage(mz: number, tolDa: number): Promise<RenderIonImageResult> {
    return this.request<RenderIonImageResult>((requestId) => ({ type: "renderIonImage", mz, tolDa, requestId }));
  }

  /** Render an RGB multi-channel overlay (one image per non-null channel). */
  renderMultiChannel(
    channels: (ChannelRequest | null)[],
  ): Promise<(Float32Array | null)[]> {
    return this.request<(Float32Array | null)[]>((requestId) => ({
      type: "renderMultiChannel",
      channels,
      requestId,
    }));
  }

  /**
   * Request decode of an optical-image member. This is NOT requestId-correlated —
   * it echoes a `gen` and its results arrive as opticalImage* EVENTS (subscribe
   * via `on("opticalImageResult", ...)` etc.). Fire-and-forget here.
   */
  getOpticalImage(archivePath: string, gen: number, preloadMaxBytes?: number): void {
    this.send({ type: "getOpticalImage", archivePath, gen, preloadMaxBytes });
  }

  /**
   * Cancel an in-flight request by its requestId. Posts {type:"cancel"}. Per
   * MESSAGE_POLICY this is a hard `abort` for some ops and a `stale-drop` for
   * others — either way the pending Promise is rejected so the caller unblocks.
   */
  cancel(requestId: number): void {
    this.send({ type: "cancel", cancelId: requestId });
    const pending = this.pendingByRequestId.get(requestId);
    if (pending) {
      this.pendingByRequestId.delete(requestId);
      pending.reject(new CancelledError(requestId));
    }
  }

  /** Terminate the underlying worker (if it supports it) and clear all pending. */
  terminate(): void {
    this.worker.terminate?.();
    this.rejectAllPending(() => new Error("EngineClient terminated"));
    this.outbox = [];
  }

  /** Reject + clear every pending request/select Promise, and drop buffered sends. */
  private rejectAllPending(makeErr: () => Error): void {
    for (const p of this.pendingByRequestId.values()) p.reject(makeErr());
    for (const p of this.pendingBySelectId.values()) p.reject(makeErr());
    this.pendingByRequestId.clear();
    this.pendingBySelectId.clear();
    this.openRequestId = 0;
    // Drop buffered-but-unsent requests too (their Promises are now rejected).
    this.outbox = [];
  }

  /** Supersede one in-flight request: reject its Promise + drop it from the outbox. */
  private supersedeRequest(requestId: number): void {
    const pending = this.pendingByRequestId.get(requestId);
    if (pending) {
      this.pendingByRequestId.delete(requestId);
      pending.reject(new SupersededError("open"));
    }
    this.outbox = this.outbox.filter(
      (e) => (e.req as { requestId?: number }).requestId !== requestId,
    );
  }

  /** The requestId that the NEXT requestId-carrying request will use (for tests). */
  peekNextRequestId(): number {
    return this.nextRequestId;
  }

  // -------------------------------------------------------------------------
  // Inbound dispatch.
  // -------------------------------------------------------------------------

  private handleMessage(msg: WorkerResponse): void {
    switch (msg.type) {
      case "ready":
        this.onReady();
        return;

      case "error":
        this.onError(msg);
        return;

      // selectId-correlated -------------------------------------------------
      case "spectrumResult":
        this.onSpectrumResult(msg);
        return;

      // gen-echoed optical events ------------------------------------------
      case "opticalImageResult":
      case "opticalImageError":
      case "opticalImageSkipped":
        this.emit(msg.type, msg);
        return;

      // unsolicited / streaming events -------------------------------------
      case "progress":
      case "renderProgress":
      case "ionIndexPreloading":
      case "ionIndexPreloadAborted":
      case "ionIndexReady":
        this.emit(msg.type, msg);
        return;

      // control -------------------------------------------------------------
      case "cancelled":
        // The promise is already rejected in cancel(); nothing to resolve.
        return;

      // requestId-correlated *Result responses ------------------------------
      default:
        this.onCorrelatedResult(msg);
        return;
    }
  }

  private onReady(): void {
    this.ready = true;
    const queued = this.outbox;
    this.outbox = [];
    for (const { req, transfer } of queued) {
      this.worker.postMessage(req, transfer);
    }
  }

  private onError(msg: Extract<WorkerResponse, { type: "error" }>): void {
    const err = new EngineError(msg.class, msg.message, msg.findings, msg.requestId);
    // requestId-correlated failure.
    if (msg.requestId !== undefined) {
      const pending = this.pendingByRequestId.get(msg.requestId);
      if (pending) {
        this.pendingByRequestId.delete(msg.requestId);
        if (msg.requestId === this.openRequestId) this.openRequestId = 0;
        pending.reject(err);
        return;
      }
    }
    // selectId-correlated failure (selects aren't requestId-keyed — review C1).
    if (msg.selectId !== undefined) {
      const pending = this.pendingBySelectId.get(msg.selectId);
      if (pending) {
        this.pendingBySelectId.delete(msg.selectId);
        pending.reject(err);
        return;
      }
    }
    // Unattributed → a global engine error (e.g. WASM init). Surface it on the
    // `error` event channel rather than silently dropping it (review).
    this.emit("error", msg);
  }

  private onSpectrumResult(
    msg: Extract<WorkerResponse, { type: "spectrumResult" }>,
  ): void {
    const pending = this.pendingBySelectId.get(msg.selectId);
    // Stale-drop: a spectrumResult older than the latest select. Reject (not silently
    // drop) its resolver so the awaiting caller unblocks and nothing leaks (review C1).
    if (MESSAGE_POLICY.selectSpectrum.cancellation === "stale-drop" && msg.selectId < this.latestSelectId) {
      if (pending) {
        this.pendingBySelectId.delete(msg.selectId);
        pending.reject(new SupersededError("selectSpectrum"));
      }
      return;
    }
    if (pending) {
      this.pendingBySelectId.delete(msg.selectId);
      pending.resolve(msg.spectrum);
    }
  }

  private onCorrelatedResult(msg: WorkerResponse): void {
    const requestId = (msg as { requestId?: number }).requestId;
    if (requestId === undefined) return;
    const pending = this.pendingByRequestId.get(requestId);
    if (!pending || pending.resolveType !== msg.type) return;
    this.pendingByRequestId.delete(requestId);
    pending.resolve(this.unwrap(msg));
  }

  /** Strip the protocol envelope down to the convenience-method payload. */
  private unwrap(msg: WorkerResponse): unknown {
    switch (msg.type) {
      case "opened": {
        const { type: _t, requestId: _r, ...rest } = msg;
        return rest;
      }
      case "scanBreakdownResult":
        return { stats: msg.stats, browse: msg.browse };
      case "meanSpectrumResult":
        return msg.spectrum;
      case "chromResult":
        return msg.series;
      case "archiveListResult":
        return msg.members;
      case "parquetFooterResult":
        return msg.footer;
      case "deepColumnResult":
        return msg.page;
      case "sampleColumnResult":
        return msg.sample;
      case "archiveMemberBytesResult":
        return { archivePath: msg.archivePath, bytes: msg.bytes, truncated: msg.truncated };
      case "studyMetaResult":
        return msg.study;
      case "renderResult":
        return { ionImage: msg.ionImage, stats: msg.stats };
      case "multiChannelResult":
        return msg.channels;
      default:
        return msg;
    }
  }

  private emit(type: EngineEventType, ev: WorkerResponse): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const cb of set) cb(ev);
  }
}
