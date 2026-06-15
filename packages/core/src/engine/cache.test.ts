import { describe, it, expect } from "vitest";
import { CacheBudget, SpectrumLruCache, spectrumBytes, defaultCacheBytes, type CachedSpectrum } from "./cache";

function spec(points: number, msLevel: number | null = 1): CachedSpectrum {
  return { mz: new Float64Array(points), intensity: new Float32Array(points), msLevel };
}
// One point = 8 (f64 mz) + 4 (f32 int) = 12 bytes.
const PT = 12;

describe("defaultCacheBytes", () => {
  it("clamps to [192, 768] MB (no navigator → 4 GB → 384 MB)", () => {
    const b = defaultCacheBytes();
    expect(b).toBeGreaterThanOrEqual(192 * 1024 * 1024);
    expect(b).toBeLessThanOrEqual(768 * 1024 * 1024);
  });
});

describe("CacheBudget", () => {
  it("tracks used / remaining and resets", () => {
    const bud = new CacheBudget(1000);
    expect(bud.remaining()).toBe(1000);
    bud.add(600);
    expect(bud.used).toBe(600);
    expect(bud.remaining()).toBe(400);
    bud.sub(200);
    expect(bud.used).toBe(400);
    bud.sub(99999); // clamps at 0
    expect(bud.used).toBe(0);
    bud.add(500);
    bud.resetUsage();
    expect(bud.used).toBe(0);
    expect(bud.remaining()).toBe(1000);
  });
});

describe("SpectrumLruCache", () => {
  it("stores, hits, and computes bytes from m/z+intensity only", () => {
    const bud = new CacheBudget(10_000);
    const c = new SpectrumLruCache(bud);
    c.set(5, spec(10));
    expect(c.has(5)).toBe(true);
    expect(c.size).toBe(1);
    expect(c.heldBytes).toBe(10 * PT);
    expect(bud.used).toBe(10 * PT);
    const hit = c.get(5);
    expect(hit?.msLevel).toBe(1);
    expect(hit?.mz.length).toBe(10);
    expect(c.get(999)).toBeUndefined();
  });

  it("evicts the LEAST-recently-used entry when the shared budget overflows", () => {
    const bud = new CacheBudget(25 * PT); // room for ~2 spectra of 10 points
    const c = new SpectrumLruCache(bud);
    c.set(1, spec(10)); // 120 B
    c.set(2, spec(10)); // 240 B
    c.get(1); // touch 1 → 2 is now the oldest
    c.set(3, spec(10)); // 360 B > 300 B budget → evict oldest (2)
    expect(c.has(1)).toBe(true); // recently used, kept
    expect(c.has(2)).toBe(false); // evicted
    expect(c.has(3)).toBe(true);
    expect(bud.used).toBe(c.heldBytes);
    expect(bud.used).toBeLessThanOrEqual(bud.limitBytes);
  });

  it("always keeps at least one entry even if it exceeds budget", () => {
    const bud = new CacheBudget(1); // absurdly small
    const c = new SpectrumLruCache(bud);
    c.set(7, spec(100));
    expect(c.size).toBe(1);
    expect(c.has(7)).toBe(true);
  });

  it("replacing a key accounts only the delta", () => {
    const bud = new CacheBudget(10_000);
    const c = new SpectrumLruCache(bud);
    c.set(1, spec(10)); // 120
    c.set(1, spec(30)); // replace → 360
    expect(c.size).toBe(1);
    expect(bud.used).toBe(30 * PT);
    expect(c.heldBytes).toBe(30 * PT);
  });

  it("shares the budget so a co-tenant's usage shrinks this cache's room", () => {
    const bud = new CacheBudget(30 * PT);
    const c = new SpectrumLruCache(bud);
    bud.add(20 * PT); // simulate the ion cache holding 20 points' worth
    c.set(1, spec(10)); // total 30*PT — fits exactly
    c.set(2, spec(10)); // total would be 40*PT > 30*PT → evict own oldest (1)
    expect(c.has(1)).toBe(false);
    expect(c.has(2)).toBe(true);
    expect(bud.used).toBeLessThanOrEqual(bud.limitBytes);
  });

  it("clear() empties the map and its own bytes (caller resets shared usage)", () => {
    const bud = new CacheBudget(10_000);
    const c = new SpectrumLruCache(bud);
    c.set(1, spec(10));
    c.clear();
    expect(c.size).toBe(0);
    expect(c.heldBytes).toBe(0);
  });
});

describe("spectrumBytes", () => {
  it("counts f64 m/z + f32 intensity", () => {
    expect(spectrumBytes(spec(100))).toBe(100 * 12);
  });
});
