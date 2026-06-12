// Global Worker polyfill for Vitest Node environment.
// Runs before any module imports via vitest.config.ts setupFiles.
// The store instantiates `new Worker(...)` at module scope;
// this class prevents "Worker is not defined" in test runs.
class WorkerPolyfill {
  onmessage: ((e: MessageEvent) => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postMessage(_data: unknown, _transfer?: unknown): void {}
  terminate(): void {}
}

// Only install if not already present (e.g. happy-dom provides one).
if (typeof globalThis.Worker === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as unknown as Record<string, unknown>).Worker = WorkerPolyfill;
}
