// Unified URL / deep-link grammar — a PURE parse/serialize/resolve module
// (MERGE-ROADMAP §3). No store, no DOM, no reader. This is the Phase-1 keystone
// the resolver (Phase 5) wires into the shell.
//
// Responsibilities:
//   1. parse a query string into raw params (alias folding: url→file, tab→view).
//   2. resolve raw params against the file's MODE (imaging / lc / unknown) into a
//      canonical ViewState + a list of notices for cross-mode / dropped params
//      (the §3.5 non-blocking info banner). The full conflict matrix is here.
//   3. serialize a ViewState back to the SHORTEST canonical query, driving the
//      "Share view" link. Selection is serialized from its PROVENANCE
//      (selector.by), never by parsing a possibly-synthesized `scan=N` id
//      (codex review #8).
//
// Legacy `/IV/` translation lives in ./legacy.

import {
  type View,
  type ViewState,
  type SpectrumSelector,
  type ChromMode,
  DEFAULT_VIEW_STATE,
  IMAGING_VIEWS,
  LC_VIEWS,
} from "../store";

/** File mode the params are resolved against. */
export type FileMode = "imaging" | "lc" | "unknown";

/** Raw, untyped params straight off the query string (all optional strings). */
export type RawParams = {
  file?: string;
  view?: string;
  scan?: string;
  spectrum?: string;
  px?: string;
  ms?: string;
  mz?: string;
  preload?: string;
  cache?: string;
  // LC
  chrom?: string;
  xic?: string;
  xicmz?: string;
  rt?: string;
  // imaging
  ion?: string;
  ch?: string[]; // repeatable
  roi?: string;
  optical?: string;
  overlay?: string;
};

/** A non-blocking notice produced during resolution (drives the §3.5 banner). */
export type ResolutionNotice = {
  code: string;
  severity: "info" | "warning";
  message: string;
};

export type Resolution = { view: ViewState; notices: ResolutionNotice[] };

const VALID_VIEWS = new Set<View>([
  "summary",
  "spectra",
  "chromatograms",
  "wavelength", // UV/VIS (PDA) — its own sidebar view; ?view=wavelength deep-links
  "metadata",
  "structure",
  "overview", // imaging TIC overview — was missing, so ?view=overview didn't deep-link
  "ion",
  "multi", // RGB multi-channel — was missing, so serialize(view=multi) didn't round-trip
  "optical",
  "overlay",
  "grid",
]);

const IMAGING_VIEW_SET = new Set<View>(IMAGING_VIEWS);
const LC_VIEW_SET = new Set<View>(LC_VIEWS);

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/** Parse a `location.search` string into {@link RawParams} (alias-folded). */
export function parseSearch(search: string): RawParams {
  const p = new URLSearchParams(search);
  const out: RawParams = {};
  const file = p.get("file") ?? p.get("url");
  if (file) out.file = file;
  const view = p.get("view") ?? p.get("tab");
  if (view) out.view = view;
  for (const k of ["scan", "spectrum", "px", "ms", "mz", "chrom", "xic", "xicmz", "rt", "ion", "roi", "optical", "overlay"] as const) {
    const v = p.get(k);
    if (v != null) out[k] = v;
  }
  const preload = p.get("preload");
  if (preload != null) out.preload = preload;
  const cache = p.get("cache") ?? p.get("cacheMB");
  if (cache != null) out.cache = cache;
  const ch = p.getAll("ch");
  if (ch.length) out.ch = ch;
  return out;
}

// ---------------------------------------------------------------------------
// Small value parsers (strict — reject rather than silently coerce)
// ---------------------------------------------------------------------------

function intOf(s: string | undefined): number | null {
  if (s == null || s.trim() === "") return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
}

function pairOf(s: string | undefined): [number, number] | null {
  if (s == null) return null;
  const parts = s.split(",");
  if (parts.length !== 2 || parts[0]!.trim() === "" || parts[1]!.trim() === "") return null;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return [a, b];
}

/** Ascending pair (for mz / rt windows): rejects equal or descending. */
function ascPairOf(s: string | undefined): [number, number] | null {
  const p = pairOf(s);
  if (!p || p[1] <= p[0]) return null;
  return p;
}

function intPairOf(s: string | undefined): [number, number] | null {
  const p = pairOf(s);
  if (!p || !Number.isInteger(p[0]) || !Number.isInteger(p[1])) return null;
  return p;
}

function quadOf(s: string | undefined): [number, number, number, number] | null {
  if (s == null) return null;
  const parts = s.split(",").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts as [number, number, number, number];
}

/** Parse a number, treating an absent/empty/whitespace field as "absent" (null) rather than
 *  letting `Number("")===0` slip through as a real 0. */
function optTol(part: string | undefined, fallback: number): number | null {
  if (part == null || part.trim() === "") return fallback;
  const n = Number(part);
  return Number.isFinite(n) ? n : null; // garbage (e.g. "abc") → reject
}

/** `ion=mz[,tol]` → {mz,tolDa}. An empty/absent tol → DEFAULT_TOL_DA (not 0). */
function ionOf(s: string | undefined): { mz: number; tolDa: number } | null {
  if (s == null) return null;
  const parts = s.split(",");
  const mz = Number(parts[0]);
  if (!Number.isFinite(mz)) return null;
  const tol = optTol(parts[1], DEFAULT_TOL_DA);
  if (tol == null) return null;
  return { mz, tolDa: tol };
}

/** `ch=mz,tol[,color]` → one channel. Empty tol → DEFAULT_TOL_DA; the color may itself contain
 *  commas (e.g. `rgb(1,2,3)`), so everything after the 2nd field is the color. */
function channelOf(s: string): { mz: number; tolDa: number; color: string } | null {
  const parts = s.split(",");
  if (parts.length < 2) return null;
  const mz = Number(parts[0]);
  if (!Number.isFinite(mz)) return null;
  const tol = optTol(parts[1], DEFAULT_TOL_DA);
  if (tol == null) return null;
  return { mz, tolDa: tol, color: parts.slice(2).join(",") };
}

/** `xic=mz,delta[,msLevel]` → {mz,tolDa,msLevel?}. delta is required (no default);
 *  empty/garbage → reject. The optional 3rd field limits the XIC to one MS level. */
function xicOf(s: string | undefined): { mz: number; tolDa: number; msLevel?: number } | null {
  if (s == null) return null;
  const parts = s.split(",");
  if ((parts.length !== 2 && parts.length !== 3) || !parts[1]?.trim()) return null;
  const mz = Number(parts[0]);
  const d = Number(parts[1]);
  if (!Number.isFinite(mz) || !Number.isFinite(d)) return null;
  const lvl = parts.length === 3 && parts[2]?.trim() ? Number(parts[2]) : NaN;
  return { mz, tolDa: d, ...(Number.isInteger(lvl) && lvl >= 1 ? { msLevel: lvl } : {}) };
}

/** `chrom=tic | id:<id> | ix:<n> | <id>` → mode + id. */
function chromOf(s: string | undefined): { mode: ChromMode; id: string | null } | null {
  if (s == null) return null;
  if (s === "tic") return { mode: "tic", id: null };
  if (s.startsWith("id:")) return { mode: "stored", id: s.slice(3) };
  if (s.startsWith("ix:")) return { mode: "stored", id: s }; // index form kept verbatim
  return { mode: "stored", id: s }; // bare id (Explorer legacy)
}

export const DEFAULT_TOL_DA = 0.05;

// ---------------------------------------------------------------------------
// View inference (§3.3) — used by both resolve() and serialize()
// ---------------------------------------------------------------------------

/** Infer the active view from data params when `view` is absent/invalid (§3.3). */
export function inferView(raw: RawParams, mode: FileMode): View {
  if (mode === "imaging") {
    if (raw.ch && raw.ch.length) return "ion";
    if (raw.ion != null) return "ion";
    if (raw.roi != null) return "spectra"; // ROI derives a mean spectrum
    if (raw.overlay != null) return "overlay";
    if (raw.optical != null) return "optical";
  }
  if (mode === "lc") {
    if (raw.xicmz != null || raw.xic != null) return "chromatograms";
    if (raw.chrom != null) return "chromatograms";
  }
  if (raw.scan != null || raw.px != null || raw.spectrum != null) return "spectra";
  return "summary";
}

/** Is `view` meaningful for this file mode? (cross-mode views are ignored). */
function viewAllowedInMode(view: View, mode: FileMode): boolean {
  if (mode === "unknown") return true;
  if (IMAGING_VIEW_SET.has(view)) return mode === "imaging";
  if (LC_VIEW_SET.has(view)) return mode === "lc";
  return true; // summary/spectra/metadata/structure always allowed
}

// ---------------------------------------------------------------------------
// Resolve (raw params + file mode → canonical ViewState + notices)
// ---------------------------------------------------------------------------

/**
 * Resolve raw params against the file mode. Implements the §3.2 conflict matrix:
 *  - cross-mode params (imaging params on an LC file, and vice-versa) are dropped
 *    with an info notice — never an error/blank (§3.5).
 *  - selection precedence is `scan` > `px` > `spectrum`; the losers are dropped
 *    with a logged notice. `px` is imaging-only.
 *  - `ion` (imaging) and `xic` (LC) are each valid only in their mode.
 *  - mixed spectrum + chromatogram/imaging params are BOTH applied — the data
 *    view is active, the spectrum stays selected (matches Explorer today).
 */
export function resolve(raw: RawParams, mode: FileMode): Resolution {
  const notices: ResolutionNotice[] = [];
  const v: ViewState = { ...DEFAULT_VIEW_STATE };
  if (raw.file) v.sourceUrl = raw.file;

  const ignore = (code: string, message: string) =>
    notices.push({ code, severity: "info", message });

  // --- selection: scan > px > spectrum (exactly one wins) ------------------
  const scan = intOf(raw.scan);
  const px = intPairOf(raw.px);
  const spectrum = intOf(raw.spectrum);
  if (px && mode === "lc") {
    ignore("px-cross-mode", "Pixel coordinate ignored: this file is not imaging.");
  }
  const pxUsable = px && mode !== "lc";
  let selector: SpectrumSelector = null;
  if (scan != null) {
    selector = { by: "scan", scan, index: -1, id: null };
    if (pxUsable) ignore("drop-px", "Both scan and pixel were given; using scan.");
    if (spectrum != null) ignore("drop-spectrum", "Both scan and spectrum were given; using scan.");
  } else if (pxUsable) {
    selector = { by: "pixel", x: px![0], y: px![1], index: -1, id: null };
    if (spectrum != null) ignore("drop-spectrum", "Both pixel and spectrum were given; using pixel.");
  } else if (spectrum != null) {
    selector = { by: "spectrum", index: spectrum, id: null };
  }
  v.selector = selector;

  v.msLevelFilter = intOf(raw.ms);
  v.spectrumZoom = ascPairOf(raw.mz);

  // --- LC params -----------------------------------------------------------
  const xic = xicOf(raw.xic);
  const xicmz = ascPairOf(raw.xicmz);
  const chrom = chromOf(raw.chrom);
  const rt = ascPairOf(raw.rt);
  if (mode === "imaging" && (xic || xicmz || chrom)) {
    ignore("lc-cross-mode", "This link asked for a chromatogram, but this file is imaging — ignoring it.");
  } else {
    if (xicmz) {
      v.chromMode = "xic";
      v.xic = { mz: (xicmz[0] + xicmz[1]) / 2, tolDa: (xicmz[1] - xicmz[0]) / 2 };
    } else if (xic) {
      v.chromMode = "xic";
      v.xic = xic;
    } else if (chrom) {
      v.chromMode = chrom.mode;
      v.chromStoredId = chrom.id;
    }
    if (rt && (v.chromMode === "xic" || (v.chromMode === "tic" && raw.chrom === "tic"))) {
      v.chromTimeRange = rt;
    }
  }

  // --- imaging params ------------------------------------------------------
  const ion = ionOf(raw.ion);
  const channels = (raw.ch ?? []).map(channelOf).filter((c): c is NonNullable<typeof c> => c != null);
  const roi = quadOf(raw.roi);
  if (mode === "lc" && (ion || channels.length || roi || raw.optical != null || raw.overlay != null)) {
    ignore("imaging-cross-mode", "This link asked for an ion image, but this file isn't imaging — ignoring it.");
  } else {
    if (channels.length) v.channels = channels;
    if (ion) v.ion = ion;
    if (roi) v.roi = roi;
    if (raw.optical != null) v.opticalRef = raw.optical;
  }

  // --- view: explicit (if allowed) else inferred ---------------------------
  const explicit = raw.view as View | undefined;
  if (explicit && VALID_VIEWS.has(explicit)) {
    if (viewAllowedInMode(explicit, mode)) {
      v.view = explicit;
    } else {
      ignore("view-cross-mode", `The "${explicit}" view doesn't apply to this file — showing ${inferView(raw, mode)} instead.`);
      v.view = inferView(raw, mode);
    }
  } else {
    if (explicit) ignore("view-unknown", `Unknown view "${explicit}" — inferring from the link.`);
    v.view = inferView(raw, mode);
  }

  return { view: v, notices };
}

// ---------------------------------------------------------------------------
// Serialize (ViewState → shortest canonical query)
// ---------------------------------------------------------------------------

/** Trim a number to ≤4 decimals without trailing zeros. */
function num(v: number): string {
  return Number(v.toFixed(4)).toString();
}

/**
 * Serialize a ViewState to the shortest canonical query string. `view` is emitted
 * only when it differs from what inference would yield from the data params, so a
 * link is never longer than it needs to be and always round-trips through
 * resolve(). Selection is emitted from `selector.by` (provenance), never by
 * re-parsing an id (codex #8): a synthesized imaging `scan=N` id can NOT leak out
 * as a native-scan link.
 */
export function serialize(v: ViewState, mode: FileMode): URLSearchParams {
  const p = new URLSearchParams();
  if (v.sourceUrl) p.set("file", v.sourceUrl);

  // selection (provenance-driven; exactly one form)
  if (v.selector) {
    switch (v.selector.by) {
      case "scan":
        p.set("scan", String(v.selector.scan));
        break;
      case "pixel":
        p.set("px", `${v.selector.x},${v.selector.y}`);
        break;
      case "spectrum":
        p.set("spectrum", String(v.selector.index));
        break;
    }
  }
  if (v.msLevelFilter != null) p.set("ms", String(v.msLevelFilter));
  if (v.spectrumZoom) p.set("mz", `${num(v.spectrumZoom[0])},${num(v.spectrumZoom[1])}`);

  // LC
  if (v.chromMode === "xic" && v.xic) p.set("xic", `${num(v.xic.mz)},${num(v.xic.tolDa)}${v.xic.msLevel != null ? `,${v.xic.msLevel}` : ""}`);
  else if (v.chromMode === "stored" && v.chromStoredId) p.set("chrom", canonicalChrom(v.chromStoredId));
  else if (v.chromMode === "tic" && v.view === "chromatograms") p.set("chrom", "tic");
  if (v.chromTimeRange && (p.has("xic") || p.get("chrom") === "tic")) {
    p.set("rt", `${num(v.chromTimeRange[0])},${num(v.chromTimeRange[1])}`);
  }

  // imaging
  for (const c of v.channels) p.append("ch", `${num(c.mz)},${num(c.tolDa)}${c.color ? `,${c.color}` : ""}`);
  if (v.ion) p.set("ion", v.ion.tolDa === DEFAULT_TOL_DA ? num(v.ion.mz) : `${num(v.ion.mz)},${num(v.ion.tolDa)}`);
  if (v.roi) p.set("roi", v.roi.map(num).join(","));
  if (v.opticalRef != null) p.set("optical", v.opticalRef);

  // view — only if not what inference would derive
  const rawFromParams = parseSearch(`?${p.toString()}`);
  if (inferView(rawFromParams, mode) !== v.view) p.set("view", v.view);

  return p;
}

/** Canonicalize a stored-chromatogram id to the `id:`/`ix:` form. */
function canonicalChrom(id: string): string {
  if (id.startsWith("id:") || id.startsWith("ix:")) return id;
  return `id:${id}`;
}

/** Build the full shareable URL for a view. */
export function buildShareUrl(v: ViewState, mode: FileMode, origin: string, pathname: string): string {
  const q = serialize(v, mode).toString();
  return q ? `${origin}${pathname}?${q}` : `${origin}${pathname}`;
}
