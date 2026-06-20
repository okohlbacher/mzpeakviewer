/**
 * Parse an optional retention-time min/max pair (seconds) entered in a form.
 *
 * Three outcomes, so the caller can tell "no window" apart from "bad input":
 *   - both blank        → { valid: true }            (run over the full retention range)
 *   - both finite, lo<hi → { valid: true, range }     (run over [lo, hi])
 *   - anything else      → { valid: false }           (partial entry or lo>=hi)
 *
 * Callers gate their submit on `valid` so a partial/invalid window blocks rather
 * than silently falling back to a full-range run.
 */
export function parseRtRange(minS: string, maxS: string): { valid: boolean; range?: [number, number] } {
  const blank = minS.trim() === "" && maxS.trim() === "";
  if (blank) return { valid: true };
  const lo = Number(minS);
  const hi = Number(maxS);
  if (minS.trim() !== "" && maxS.trim() !== "" && Number.isFinite(lo) && Number.isFinite(hi) && lo < hi) {
    return { valid: true, range: [lo, hi] };
  }
  return { valid: false };
}
