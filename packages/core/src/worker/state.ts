// Worker-side module-global engine state. ONE open file per session (the contract):
// `open` resets everything and bumps the load generation, so in-flight work from a
// previous file is dropped by generation check. The Reader / ZipStorage / Arrow
// handles live HERE and never cross the boundary.

import type { CapabilityModel } from "@mzpeak/contracts";

/**
 * The live reader handle. Typed loosely on purpose — the concrete `mzpeakts`
 * Reader type is only referenced inside handlers (which import mzpeakts); state.ts
 * stays import-light so the pure layer doesn't transitively pull the reader.
 */
export type ReaderHandle = {
  /** mzpeakts MzPeakReader instance (opaque here). */
  reader: unknown;
  /** zip.js storage backing the archive (opaque here). */
  zip: unknown;
  /** Resolved capabilities for this file (set during `open`). */
  capabilities: CapabilityModel;
  /** Source url/name for diagnostics. */
  source: string;
};

export type EngineState = {
  /** The single open file, or null before any `open` / after `close`. */
  active: ReaderHandle | null;
  /**
   * Monotonic load generation. Bumped on every `open`. Long-running work captures
   * the gen at start and checks it before posting — results from a superseded file
   * are dropped (the stale-drop cancellation model; see MESSAGE_POLICY).
   */
  gen: number;
  /** In-flight request ids that have been cancelled (checked cooperatively). */
  cancelled: Set<number>;
};

const state: EngineState = { active: null, gen: 0, cancelled: new Set() };

export function getState(): EngineState {
  return state;
}

/** Begin a new file: drop the old reader, bump the generation, clear cancellations. */
export function beginOpen(): number {
  state.active = null;
  state.cancelled.clear();
  return ++state.gen;
}

export function setActive(handle: ReaderHandle): void {
  state.active = handle;
}

/** Close the file. Bumps the generation so any in-flight work that captured the old
 *  gen is dropped by `isStale()` and can't post into the closed session (review C2). */
export function closeActive(): void {
  state.active = null;
  state.cancelled.clear();
  state.gen++;
}

/** True if `gen` is no longer the current generation (work should be abandoned). */
export function isStale(gen: number): boolean {
  return gen !== state.gen;
}

export function markCancelled(requestId: number): void {
  state.cancelled.add(requestId);
}

export function isCancelled(requestId: number): boolean {
  return state.cancelled.has(requestId);
}
