// Legacy `/IV/` → unified `/view/` deep-link translation.
// Pure functions; the redirect shim (committed index.html for GitHub
// Pages, server redirect for mzpeak.org) calls translateLegacyIvSearch and then
// location.replace()s to the unified path.
//
// The two REAL translations (everything else passes through unchanged):
//   1. Legacy `scan=N` is a 1-BASED DISPLAYED INDEX, not a native scan number → it
//      becomes `spectrum=N-1` (the unified `scan` param keeps its native-number
//      meaning).
//   2. Legacy `ion=mz` + separate `&tol=Da` folds into `ion=mz,Da`.
//
// Pass-through (names preserved): file/url, optical, preload, cache/cacheMB, mz.
// Dropped: nothing silently — anything unrecognized is carried verbatim so a
// future param is never lost by the shim.

/** Per-param record of what the shim did, for query-preservation tests. */
export type LegacyTranslation = {
  /** The rewritten unified query string (without leading '?'). */
  search: string;
  /** Human-auditable log of each transformation applied. */
  changes: string[];
};

/**
 * Translate a legacy IV query string to the unified grammar.
 *
 * Legacy selection precedence was scan > ion > optical; we preserve all params and
 * let the unified resolver apply precedence, except the two value rewrites above.
 */
export function translateLegacyIvSearch(search: string): LegacyTranslation {
  const inP = new URLSearchParams(search);
  const out = new URLSearchParams();
  const changes: string[] = [];

  // 1. scan=N (1-based index) → spectrum=N-1
  const scan = inP.get("scan");
  if (scan != null) {
    const n = Number(scan);
    if (Number.isInteger(n)) {
      const idx = Math.max(0, n - 1);
      out.set("spectrum", String(idx));
      changes.push(`scan=${scan} → spectrum=${idx} (IV scan was a 1-based index)`);
    } else {
      // Non-integer: carry verbatim rather than corrupt it.
      out.set("scan", scan);
      changes.push(`scan=${scan} carried verbatim (not an integer)`);
    }
  }

  // 2. ion=mz (+ &tol=Da) → ion=mz,Da
  const ion = inP.get("ion");
  const tol = inP.get("tol");
  if (ion != null) {
    if (tol != null && !ion.includes(",")) {
      out.set("ion", `${ion},${tol}`);
      changes.push(`ion=${ion} & tol=${tol} → ion=${ion},${tol}`);
    } else {
      out.set("ion", ion);
      if (tol != null) changes.push(`tol=${tol} dropped (ion already carried a tolerance)`);
    }
  }

  // Pass-through params (names preserved).
  for (const [k, val] of inP.entries()) {
    if (k === "scan" || k === "ion" || k === "tol") continue; // handled above
    out.append(k, val);
  }

  return { search: out.toString(), changes };
}

/**
 * Map a legacy IV path to its unified counterpart. Two deploy targets differ:
 *   - mzpeak.org:    `/IV/`  → `/view/`
 *   - GitHub Pages:  `/mzPeakIV/` (project-page root) → the unified project page
 *     (`/mzpeakviewer/`). A `/IV/` segment under Pages does not exist, so the
 *     shim must live at the project-page root the old links actually used.
 * The shim is published per-target with the right `basePath`; this helper records
 * the mapping the redirect tests assert against.
 */
export const LEGACY_PATH_MAP: { from: string; to: string; target: "mzpeak.org" | "github-pages" }[] = [
  { from: "/IV/", to: "/view/", target: "mzpeak.org" },
  { from: "/mzPeakIV/", to: "/mzpeakviewer/", target: "github-pages" },
];

/** Build the unified redirect URL for a legacy IV location. */
export function legacyIvRedirect(fromPath: string, search: string): { path: string; search: string } | null {
  const entry = LEGACY_PATH_MAP.find((m) => fromPath.startsWith(m.from));
  if (!entry) return null;
  const { search: translated } = translateLegacyIvSearch(search);
  return { path: entry.to, search: translated };
}
