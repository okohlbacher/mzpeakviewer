import { describe, it, expect } from "vitest";
import { Mutex } from "./mutex";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("Mutex", () => {
  it("serializes overlapping critical sections (no interleave)", async () => {
    const m = new Mutex();
    const log: string[] = [];
    const job = (name: string) =>
      m.runExclusive(async () => {
        log.push(`${name}:start`);
        await tick();
        await tick();
        log.push(`${name}:end`);
      });
    await Promise.all([job("A"), job("B"), job("C")]);
    // Each job's start/end must be adjacent — never A:start, B:start, ...
    expect(log).toEqual(["A:start", "A:end", "B:start", "B:end", "C:start", "C:end"]);
  });

  it("preserves FIFO order of waiters", async () => {
    const m = new Mutex();
    const order: number[] = [];
    const ps = [1, 2, 3, 4].map((n) => m.runExclusive(async () => { order.push(n); await tick(); }));
    await Promise.all(ps);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("releases the lock even when the thunk throws", async () => {
    const m = new Mutex();
    await expect(m.runExclusive(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(m.isLocked).toBe(false);
    // The lock is reusable afterward.
    const v = await m.runExclusive(async () => 42);
    expect(v).toBe(42);
    expect(m.isLocked).toBe(false);
  });

  it("returns the thunk's value", async () => {
    const m = new Mutex();
    expect(await m.runExclusive(() => "sync")).toBe("sync");
    expect(await m.runExclusive(async () => "async")).toBe("async");
  });
});
