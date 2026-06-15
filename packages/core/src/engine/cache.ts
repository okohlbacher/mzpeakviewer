// Worker-resident caches for decoded spectrum signal arrays, with ONE memory-sized
// budget shared across the ion-image cache and the spectrum LRU.
//
// Why a shared budget: both caches hold the SAME kind of payload — decoded (m/z,
// intensity) typed arrays keyed by spectrum index — so sizing them independently
// would double-count memory on a large imaging file. A single `CacheBudget` tracks
// total bytes held; each cache accounts its own entries against it.
//
// What is stored (design requirement): the heavy signal arrays (m/z f64 + intensity
// f32) plus the spectrum's MS level ONLY. The light metadata (id, representation,
// retention time) stays in the in-memory metadata table and is re-read on demand —
// never cached. msLevel is kept so a future MS0/1-only prefetch can build its
// worklist without materializing per-spectrum records.

/** One cached spectrum's signal arrays + MS level (no other metadata). */
export type CachedSpectrum = {
  mz: Float64Array;
  intensity: Float32Array;
  msLevel: number | null;
};

/** Bytes a cached spectrum occupies (f64 m/z + f32 intensity; msLevel is negligible). */
export function spectrumBytes(s: CachedSpectrum): number {
  return s.mz.byteLength + s.intensity.byteLength;
}

/**
 * Memory-derived default cache ceiling. Mirrors mzPeakExplorer's `defaultCacheMB`:
 * `clamp(round(deviceMemory_GB * 96), 192, 768)` MB. `navigator.deviceMemory` is
 * exposed in DedicatedWorkerGlobalScope; absent (node tests / older engines) → 4 GB.
 */
export function defaultCacheBytes(): number {
  const dm =
    typeof navigator !== "undefined"
      ? (navigator as unknown as { deviceMemory?: number }).deviceMemory
      : undefined;
  const gb = typeof dm === "number" && Number.isFinite(dm) && dm > 0 ? dm : 4;
  const mb = Math.min(Math.max(Math.round(gb * 96), 192), 768);
  return mb * 1024 * 1024;
}

/**
 * Shared byte budget across all spectra caches. `used` is the running total of bytes
 * held by every registered cache; `limitBytes` is the memory-derived (or shell-set)
 * ceiling. Caches consult `remaining()` before growing and report add/sub as their
 * own contents change.
 */
export class CacheBudget {
  limitBytes: number;
  used = 0;
  constructor(limitBytes: number = defaultCacheBytes()) {
    this.limitBytes = limitBytes;
  }
  remaining(): number {
    return Math.max(0, this.limitBytes - this.used);
  }
  add(bytes: number): void {
    this.used += bytes;
  }
  sub(bytes: number): void {
    this.used = Math.max(0, this.used - bytes);
  }
  /** Reset the running total to zero (on file open/close — every cache is cleared). */
  resetUsage(): void {
    this.used = 0;
  }
}

/**
 * Insertion-order LRU cache of decoded spectra, keyed by spectrum index, bounded by a
 * SHARED `CacheBudget`. A cache hit refreshes recency (re-insert). On insert, the
 * cache evicts ITS OWN oldest entries until the shared budget fits (it never evicts
 * another cache's entries), always keeping at least the just-inserted spectrum.
 *
 * Port of mzPeakExplorer's `specCache` (store.ts), adapted to the worker + the shared
 * budget. Stores m/z + intensity + msLevel only (no id/time/representation).
 */
export class SpectrumLruCache {
  private readonly map = new Map<number, CachedSpectrum>();
  /** Bytes held by THIS cache (subset of budget.used). */
  private bytes = 0;

  constructor(private readonly budget: CacheBudget) {}

  get size(): number {
    return this.map.size;
  }
  get heldBytes(): number {
    return this.bytes;
  }

  /** Get + mark most-recently-used. Returns undefined on miss. */
  get(index: number): CachedSpectrum | undefined {
    const e = this.map.get(index);
    if (e === undefined) return undefined;
    // LRU touch: re-insert to move to the newest position.
    this.map.delete(index);
    this.map.set(index, e);
    return e;
  }

  has(index: number): boolean {
    return this.map.has(index);
  }

  /** Insert (or refresh) a spectrum, evicting own oldest entries to fit the budget. */
  set(index: number, entry: CachedSpectrum): void {
    const incoming = spectrumBytes(entry);
    const prev = this.map.get(index);
    if (prev) {
      // Replace: account the delta.
      this.map.delete(index);
      const prevBytes = spectrumBytes(prev);
      this.bytes -= prevBytes;
      this.budget.sub(prevBytes);
    }
    this.map.set(index, entry);
    this.bytes += incoming;
    this.budget.add(incoming);
    this.evictToBudget();
  }

  /** Evict this cache's oldest entries until the SHARED budget fits (keep ≥1). */
  private evictToBudget(): void {
    while (this.budget.used > this.budget.limitBytes && this.map.size > 1) {
      const oldest = this.map.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      const e = this.map.get(oldest)!;
      this.map.delete(oldest);
      const b = spectrumBytes(e);
      this.bytes -= b;
      this.budget.sub(b);
    }
  }

  /** Drop everything (on file open/close). Caller resets the shared budget usage. */
  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }
}
