// Prioritized serial read scheduler for the vendored mzPeak reader.
//
// The reader is single-threaded and NOT assumed reentrant, so every signal read
// (spectrum arrays, XIC / TIC extraction) runs strictly one at a time. But reads
// are not equal — a user navigating to a spectrum must not wait behind the
// background preloader's speculative buffering. So reads run on two lanes:
//
//   • priorityRead   — user-triggered, latency-critical (select a spectrum, run
//                      an XIC, build a TIC). Always dequeued ahead of any pending
//                      background read.
//   • backgroundRead — the preloader's speculative buffering. Defers the queue to
//                      user reads, and the preloader itself checks `userIsActive()`
//                      to pause while the user is actively navigating.
//
// A read already IN FLIGHT cannot be preempted: the vendored reader exposes no
// AbortSignal (fetches happen deep inside zip.js `HttpRangeReader`). So a user
// read waits for at most ONE already-running background read to finish — bounded
// by a single row-group fetch. The `userIsActive()` cooldown stops that bound
// from compounding across a navigation burst, which is the dominant cost on
// low-bandwidth links where every speculative fetch steals scarce throughput.

/** A queued read. `run()` settles the caller's promise and never rejects. */
type PendingRead = { run: () => Promise<void> };

const highLane: PendingRead[] = [];
const lowLane: PendingRead[] = [];
let draining = false;

// User reads queued-or-in-flight, plus when the last one settled (on the monotonic
// performance.now() clock — immune to wall-clock jumps). The preloader consults
// both (via `userIsActive`) to stay out of the way during navigation.
let userReadsActive = 0;
let lastUserReadAt = -Infinity;

/** How long after the last user read the preloader stays paused before resuming. */
export const PRELOAD_COOLDOWN_MS = 350;

function enqueue<T>(fn: () => Promise<T>, lane: PendingRead[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // `Promise.resolve().then(fn)` turns a SYNCHRONOUS throw from fn into a
    // rejection (a bare fn().then(…) would let a sync throw escape `run`, wedge
    // the drain loop, and leave this promise unsettled). The trailing
    // .then(resolve, reject) settles the caller in both outcomes, so `run` itself
    // never rejects and the drain loop can await it without a guard.
    lane.push({ run: () => Promise.resolve().then(fn).then(resolve, reject) });
    void drain();
  });
}

async function drain(): Promise<void> {
  if (draining) return; // a single in-flight read at a time (reader not reentrant)
  draining = true;
  try {
    for (;;) {
      // High lane first: a user read enqueued while a background read is in flight
      // is picked next, ahead of any other queued background reads.
      const item = highLane.shift() ?? lowLane.shift();
      if (!item) break;
      await item.run();
    }
  } finally {
    draining = false;
  }
}

/**
 * User-triggered read — runs on the priority lane and marks the user active so
 * the preloader backs off. Use for anything the user is waiting on (spectrum
 * navigation, XIC, Build TIC).
 */
export function priorityRead<T>(fn: () => Promise<T>): Promise<T> {
  userReadsActive++;
  const settle = () => {
    userReadsActive = Math.max(0, userReadsActive - 1);
    lastUserReadAt = performance.now();
  };
  return enqueue(fn, highLane).then(
    (v) => {
      settle();
      return v;
    },
    (e) => {
      settle();
      throw e;
    },
  );
}

/** Background (preloader) read — low lane; yields to any pending user read. */
export function backgroundRead<T>(fn: () => Promise<T>): Promise<T> {
  return enqueue(fn, lowLane);
}

/**
 * True while a user read is pending / in flight, or within the post-read cooldown.
 * The preloader polls this and pauses speculative buffering while it holds, so a
 * burst of user navigation gets the network to itself.
 */
export function userIsActive(): boolean {
  return userReadsActive > 0 || performance.now() - lastUserReadAt < PRELOAD_COOLDOWN_MS;
}

/** @internal Test-only: reset module state between cases. */
export function __resetReadScheduler(): void {
  highLane.length = 0;
  lowLane.length = 0;
  draining = false;
  userReadsActive = 0;
  lastUserReadAt = -Infinity;
}
