// Native-scan-number ↔ absolute-index resolution.
//
// The "native scan number" is the value a mass-spectrometrist reads off a
// spectrum id (e.g. "scan=1800") — typically 1-based and NOT equal to the
// 0-based absolute index the engine uses internally (commonly scan = index + 1
// for Bruker/Thermo). The spectrum picker (views/Spectra.tsx) navigates by this
// number; the ?scan= deep link needs the same resolution. This module is the
// single source of truth for both so they can never drift apart.

/** The browse index shape this module needs: native ids, one per spectrum. */
type BrowseLike = { id: string[] } | null | undefined;

/**
 * Parse the native scan number out of a spectrum id. Prefers an explicit
 * `scan=<n>` token (the mzML/PSI convention); falls back to a trailing integer
 * (e.g. bare "1800"). Returns null when neither is present.
 *
 * NOTE: kept VERBATIM from the original local copy in views/Spectra.tsx so the
 * picker's behaviour is byte-for-byte identical after the DRY move.
 */
export function scanNumberOf(id: string | undefined | null): number | null {
  if (!id) return null;
  const m = /(?:^|\s)scan=(\d+)/i.exec(id) ?? /(\d+)\s*$/.exec(id);
  return m ? Number(m[1]) : null;
}

/**
 * Guard: do these ids genuinely CARRY scan numbers, or would scanNumberOf only
 * succeed via the trailing-integer fallback on ids that aren't scan-bearing?
 *
 * The trailing-integer fallback in scanNumberOf is greedy — it would happily
 * pull "1" out of an imaging id like "spectrum=1", making a ?scan= link resolve
 * to a coordinate it has nothing to do with. So before we trust scan→index
 * resolution we require, over a small sample of the first non-empty ids, EITHER:
 *   - every sampled id literally contains "scan=" (the explicit, unambiguous
 *     convention), OR
 *   - every sampled id is a uniformly bare integer ("1800", "1801", …) — the
 *     only trailing-integer case where treating it as a scan is safe.
 * Mixed / "spectrum=N" / "index=N" ids fail the guard and the caller falls back
 * to index semantics rather than mis-navigating.
 */
export function idsCarryScans(ids: string[] | null | undefined): boolean {
  if (!ids || ids.length === 0) return false;
  // Sample the first few non-empty ids (cheap; ids are homogeneous in practice).
  const sample: string[] = [];
  for (const id of ids) {
    if (id && id.trim()) sample.push(id.trim());
    if (sample.length >= 5) break;
  }
  if (sample.length === 0) return false;

  const allHaveScanToken = sample.every((id) => /(?:^|\s)scan=\d+/i.test(id));
  const allBareIntegers = sample.every((id) => /^\d+$/.test(id));
  // Require scanNumberOf to actually resolve too (defends against odd inputs).
  const allResolve = sample.every((id) => scanNumberOf(id) != null);

  return allResolve && (allHaveScanToken || allBareIntegers);
}

/**
 * Resolve a native scan number to the absolute spectrum index whose id parses to
 * that scan, or null if no id matches. Linear scan over browse.id — called only
 * on deep-link load (rarely), so O(n) is fine and avoids building an index map.
 *
 * Accepts either the store's `browse` object or a raw `id: string[]` so callers
 * can pass whichever they have.
 */
export function resolveScanToIndex(
  browse: BrowseLike | string[],
  scan: number,
): number | null {
  const ids = Array.isArray(browse) ? browse : browse?.id;
  if (!ids || !Number.isFinite(scan)) return null;
  for (let i = 0; i < ids.length; i++) {
    if (scanNumberOf(ids[i]) === scan) return i;
  }
  return null;
}
