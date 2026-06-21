// Worker-resident caches for decoded spectrum signal arrays, with ONE memory-sized
// budget shared across the ion-image cache and the spectrum LRU.
//
// Why a shared budget: both caches hold the SAME kind of payload — decoded (m/z,
// intensity) typed arrays keyed by spectrum index — so sizing them independently
// would double-count memory on a large imaging file. A single `CacheBudget` tracks
// total bytes held; each cache accounts its own entries against it.
//
// What is stored: the heavy signal arrays (m/z f64 + intensity f32) plus the
// spectrum's MS level ONLY. The light metadata (id, representation,
// retention time) stays in the in-memory metadata table and is re-read on demand —
// never cached. msLevel is kept so a future MS0/1-only prefetch can build its
// worklist without materializing per-spectrum records.

/** One cached spectrum's signal arrays + MS level (no other metadata). `mobility` is the
 *  compact ion-mobility codec for IMS spectra (absent otherwise). */
export type CachedSpectrum = {
  mz: Float64Array;
  intensity: Float32Array;
  msLevel: number | null;
  mobility?: MobilityCodec;
};

/** Bytes a cached spectrum occupies (f64 m/z + f32 intensity + optional mobility codec). */
export function spectrumBytes(s: CachedSpectrum): number {
  return s.mz.byteLength + s.intensity.byteLength + (s.mobility ? s.mobility.values.byteLength + s.mobility.index.byteLength : 0);
}

/**
 * Memory-derived default cache ceiling:
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
 * Stores m/z + intensity + msLevel only (no id/time/representation).
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

// ── Wavelength (UV/VIS) LRU ───────────────────────────────────────────────────
//
// SEPARATE from the MS SpectrumLruCache: a wavelength spectrum's payload is the full
// wire WavelengthSpectrumArrays (wavelength f32 +
// intensity f32 + resolved unit / λmax / observedRange / time / id / meta), not the
// MS (m/z f64, intensity f32, msLevel) shape. Stored whole so a repeat select is an
// instant hit; the wire copy is made at the transfer boundary (the cached object is
// never transferred). Shares the same `CacheBudget` as the MS caches.

import type { WavelengthSpectrumArrays, MobilityCodec } from "@mzpeak/contracts";

/** Bytes a cached wavelength spectrum occupies (its two f32 axes; scalars negligible). */
export function wavelengthBytes(s: WavelengthSpectrumArrays): number {
  return s.wavelength.byteLength + s.intensity.byteLength;
}

/**
 * Insertion-order LRU of decoded wavelength spectra, keyed by zero-based array position,
 * bounded by the SHARED `CacheBudget`. Same eviction discipline as `SpectrumLruCache`
 * (evict own oldest until the budget fits; keep ≥1). Holds the full wire object.
 */
export class WavelengthLruCache {
  private readonly map = new Map<number, WavelengthSpectrumArrays>();
  private bytes = 0;

  constructor(private readonly budget: CacheBudget) {}

  get size(): number {
    return this.map.size;
  }
  get heldBytes(): number {
    return this.bytes;
  }

  /** Get + mark most-recently-used. Returns undefined on miss. */
  get(index: number): WavelengthSpectrumArrays | undefined {
    const e = this.map.get(index);
    if (e === undefined) return undefined;
    this.map.delete(index);
    this.map.set(index, e);
    return e;
  }

  has(index: number): boolean {
    return this.map.has(index);
  }

  /** Insert (or refresh) a spectrum, evicting own oldest entries to fit the budget. */
  set(index: number, entry: WavelengthSpectrumArrays): void {
    const incoming = wavelengthBytes(entry);
    const prev = this.map.get(index);
    if (prev) {
      this.map.delete(index);
      const prevBytes = wavelengthBytes(prev);
      this.bytes -= prevBytes;
      this.budget.sub(prevBytes);
    }
    this.map.set(index, entry);
    this.bytes += incoming;
    this.budget.add(incoming);
    this.evictToBudget();
  }

  private evictToBudget(): void {
    while (this.budget.used > this.budget.limitBytes && this.map.size > 1) {
      const oldest = this.map.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      const e = this.map.get(oldest)!;
      this.map.delete(oldest);
      const b = wavelengthBytes(e);
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

// ── Ion cache: the COMPACT decoded grid-cell spectra ──────────────────────────
//
// The single shared store every imaging operation reads/writes — the single-channel ion
// image, the RGB multi-channel overlay, the mean/ROI traces, and the background prefetch —
// owned centrally by `IonCacheStore` so any view or image type goes through ONE API instead
// of threading a cache object around. Factored out of imaging.ts so the compaction + budget +
// commit bookkeeping lives in one place.

/**
 * COMPACT per-spectrum arrays held ONLY to recompute ion images (MSI). m/z is f32: f32
 * precision is ~1.2e-4 Da at m/z 1000 — far finer than any practical window tolerance — so it
 * never changes which points fall in an ion-image window, while halving the m/z footprint.
 * Intensity is already f32. NOT a spectrum-display structure: id / representation / RT and full
 * f64 m/z are re-read on demand (cheap).
 */
export type CompactSpectrum = { mz: Float32Array; intensity: Float32Array };

/** The whole-grid compact spectra cache + the flags consumers need to read it correctly. */
export type SpectraArrayCache = {
  /** spectrumIndex → compact point arrays, for every filled grid cell with data. */
  byIndex: Map<number, CompactSpectrum>;
  /** True once a full pass populated every available filled-cell spectrum. */
  complete: boolean;
  /** Approximate bytes held (mz f32 + intensity f32), for the budget check. */
  bytes: number;
  /** True when every cached spectrum's m/z is ascending (the sortingRank-0 axis) — lets a
   *  consumer binary-search the window instead of scanning all points; false → full scan. */
  sorted: boolean;
};

/**
 * Accumulates compact grid-cell spectra during a build, bounded by a live byte budget. Shared
 * by the single-channel render, the RGB multi-channel render, and the background prefetch so
 * the f32 compaction + budget + sortedness bookkeeping lives in ONE place. m/z is stored as
 * f32: an already-f32 input array is kept as-is (no copy — the common case once the ion stream
 * is f32); an f64 input is downcast.
 */
export class IonCacheBuilder {
  private readonly building = new Map<number, CompactSpectrum>();
  private heldBytes = 0;
  private ok = true;
  private sortedAll = true;

  /** @param remaining live byte budget available to the cache (consulted before each add). */
  constructor(private readonly remaining: () => number) {}

  /** Cache one spectrum (m/z coerced to f32). No-op once over budget (the caller keeps
   *  rendering uncached; check {@link overBudget} to stop early, e.g. the prefetch). */
  add(index: number, mz: ArrayLike<number>, intensity: Float32Array): void {
    if (!this.ok) return;
    const mz32 = mz instanceof Float32Array ? mz : Float32Array.from(mz);
    const sz = mz32.byteLength + intensity.byteLength;
    if (this.heldBytes + sz > this.remaining()) {
      this.ok = false; // too big for this session → render uncached from here on
      this.building.clear();
      return;
    }
    let sorted = true;
    for (let i = 1; i < mz32.length; i++) if (mz32[i]! < mz32[i - 1]!) { sorted = false; break; }
    if (!sorted) this.sortedAll = false;
    this.heldBytes += sz;
    this.building.set(index, { mz: mz32, intensity });
  }

  get overBudget(): boolean {
    return !this.ok;
  }

  /** The committable cache, or null if it didn't fit the budget. */
  finish(): SpectraArrayCache | null {
    return this.ok
      ? { byIndex: this.building, complete: true, bytes: this.heldBytes, sorted: this.sortedAll }
      : null;
  }
}

/**
 * Central owner of the ONE ion cache. Every imaging op reads `current` / `lookup` and commits
 * a freshly-built cache via `commit` (which keeps the shared byte budget in sync). Dropped on
 * file open/close. This is the single shared resource every tab / image type uses.
 */
export class IonCacheStore {
  private cache: SpectraArrayCache | null = null;
  constructor(private readonly budget: CacheBudget) {}

  get current(): SpectraArrayCache | null {
    return this.cache;
  }
  /** True once the cache holds the whole grid (so renders take the instant cache-hit path). */
  get isWarm(): boolean {
    return this.cache?.complete ?? false;
  }
  /** A cached pixel's compact arrays, or undefined — the lookup any consumer (ion/multi/mean/
   *  ROI, or a future tab) uses to read a spectrum from the warm cache. */
  lookup(index: number): CompactSpectrum | undefined {
    return this.cache?.byIndex.get(index);
  }
  /** Commit a freshly-built cache (no-op if the same ref); updates the shared budget. Returns
   *  whether the cache reference changed (so the caller can emit the warm signal once). */
  commit(built: SpectraArrayCache | null): boolean {
    if (built === this.cache) return false;
    if (this.cache) this.budget.sub(this.cache.bytes);
    if (built) this.budget.add(built.bytes);
    this.cache = built;
    return true;
  }
  /** Drop the cache (file open/close), releasing its budget. */
  clear(): void {
    if (this.cache) this.budget.sub(this.cache.bytes);
    this.cache = null;
  }
  /** Total decoded points held (for the `ionIndexReady` signal). */
  pointCount(): number {
    let n = 0;
    if (this.cache) for (const a of this.cache.byIndex.values()) n += a.mz.length;
    return n;
  }
}
