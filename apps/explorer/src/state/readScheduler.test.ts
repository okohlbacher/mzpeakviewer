import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRELOAD_COOLDOWN_MS,
  __resetReadScheduler,
  backgroundRead,
  priorityRead,
  userIsActive,
} from "./readScheduler";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush pending microtasks AND a macrotask tick (the scheduler defers fn by a
 *  microtask via `Promise.resolve().then(fn)`, so a bare microtask flush isn't
 *  always enough to observe a read having started). */
const flush = () => new Promise<void>((res) => setTimeout(res, 0));

afterEach(() => {
  __resetReadScheduler();
  vi.restoreAllMocks();
});

describe("read scheduler — serialization", () => {
  it("never runs two reads concurrently (reader is not reentrant)", async () => {
    let active = 0;
    let maxActive = 0;
    const body = () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      await Promise.resolve();
      active--;
    };
    await Promise.all([
      backgroundRead(body()),
      backgroundRead(body()),
      priorityRead(body()),
      backgroundRead(body()),
    ]);
    expect(maxActive).toBe(1);
  });

  it("runs background reads in FIFO order among themselves", async () => {
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => backgroundRead(async () => void order.push(n))));
    expect(order).toEqual([1, 2, 3]);
  });
});

describe("read scheduler — priority", () => {
  it("a user read preempts a queued background read (but not the in-flight one)", async () => {
    const order: string[] = [];
    const gate = deferred<void>();

    // b1 starts and blocks the queue (simulates an in-flight row-group fetch).
    const pB1 = backgroundRead(async () => {
      order.push("b1-start");
      await gate.promise;
      order.push("b1-end");
    });
    // Queue a second background read, then a user read — both wait behind b1.
    const pB2 = backgroundRead(async () => void order.push("b2"));
    const pU1 = priorityRead(async () => void order.push("u1"));

    await flush(); // let b1 reach its await; nothing else may run
    expect(order).toEqual(["b1-start"]);

    gate.resolve(); // b1 finishes → the user read jumps ahead of b2
    await Promise.all([pB1, pB2, pU1]);
    expect(order).toEqual(["b1-start", "b1-end", "u1", "b2"]);
  });

  it("does not wedge the queue when a read rejects", async () => {
    const order: string[] = [];
    const pBad = backgroundRead(async () => {
      order.push("bad");
      throw new Error("boom");
    });
    const pGood = backgroundRead(async () => void order.push("good"));
    await expect(pBad).rejects.toThrow("boom");
    await pGood;
    expect(order).toEqual(["bad", "good"]);
  });
});

describe("read scheduler — userIsActive (preloader backoff signal)", () => {
  it("is true while a user read is pending and through the cooldown, then false", async () => {
    // The scheduler reads the monotonic performance.now() clock, so drive that.
    const clock = vi.spyOn(performance, "now").mockReturnValue(10_000);

    expect(userIsActive()).toBe(false); // no reads yet

    const gate = deferred<void>();
    const p = priorityRead(() => gate.promise);
    expect(userIsActive()).toBe(true); // pending user read

    gate.resolve();
    await p; // settles → lastUserReadAt = now (10_000)
    expect(userIsActive()).toBe(true); // inside cooldown

    clock.mockReturnValue(10_000 + PRELOAD_COOLDOWN_MS - 1);
    expect(userIsActive()).toBe(true); // still inside

    clock.mockReturnValue(10_000 + PRELOAD_COOLDOWN_MS);
    expect(userIsActive()).toBe(false); // cooldown elapsed
  });

  it("background reads alone never mark the user active", async () => {
    await backgroundRead(async () => {});
    expect(userIsActive()).toBe(false); // lastUserReadAt stays -Infinity
  });

  it("settles the caller and stays usable when a read throws synchronously", async () => {
    // A SYNC throw (not a returned rejected promise) must still reject the caller
    // and must not wedge the queue or leak userReadsActive.
    await expect(
      priorityRead(() => {
        throw new Error("sync boom");
      }),
    ).rejects.toThrow("sync boom");
    // Queue still works and the user is no longer counted active (after cooldown).
    const clock = vi.spyOn(performance, "now").mockReturnValue(1e9);
    expect(await backgroundRead(async () => 42)).toBe(42);
    expect(userIsActive()).toBe(false);
    clock.mockRestore();
  });
});
