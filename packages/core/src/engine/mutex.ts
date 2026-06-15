// A minimal FIFO async mutex. The mzpeakts/parquet-wasm reader is single-threaded and
// NOT reentrant, so every reader access — whether a dispatched user request or the
// background prefetch loop — must be serialized through ONE lock. `runExclusive`
// acquires, runs the thunk, and always releases (even on throw), so a user read waits
// for at most the ONE in-flight prefetch chunk to finish (the bounded soft-preempt the
// design calls for; the vendored reader exposes no AbortSignal for a hard interrupt).

export class Mutex {
  private locked = false;
  private readonly waiters: Array<() => void> = [];

  /** Run `fn` with exclusive access; resolves/rejects with `fn`'s result. */
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** True while a holder owns the lock (for diagnostics/tests). */
  get isLocked(): boolean {
    return this.locked;
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the lock directly to the next waiter (stays locked — FIFO, no barging).
      next();
    } else {
      this.locked = false;
    }
  }
}
