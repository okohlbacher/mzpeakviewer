// Spectrum RECORDS for the Spectra navigator: one record per stored representation.
//
// A dual-stored file keeps every spectrum twice — profile in spectra_data and centroid in
// spectra_peaks — so it has 2×N records, and the user browses all of them (or filters to
// one representation, exactly like the MS-level filter). Which representations each
// spectrum has comes from BrowseIndex.facets, computed at open from the metadata counts;
// no spectrum read is involved, so the navigator is deterministic from the first render.
//
// A record is encoded as one integer: key = index·2 + bit (bit 0 = profile, 1 = centroid).
// Keys therefore sort by spectrum index with profile before centroid, so the generic
// ascending-array helpers (rankOf / absoluteOf from ./levelIndex) apply unchanged.
// Files without stored info (facets absent or 0) get exactly one record per spectrum —
// today's one-per-spectrum navigation, bit-for-bit.
import { STORED_CENTROID, STORED_PROFILE, type BrowseIndex, type FileStats } from "@mzpeak/contracts";

export type Representation = "profile" | "centroid";
/** The representation filter; "all" shows every stored record. */
export type RepFilter = "all" | Representation;

export const recordKey = (index: number, rep: Representation): number => index * 2 + (rep === "centroid" ? 1 : 0);
export const recordSpectrum = (key: number): number => Math.floor(key / 2);
export const recordRep = (key: number): Representation => (key % 2 === 1 ? "centroid" : "profile");

export type RecordIndex = {
  /** Every record key, ascending (spectrum order, profile before centroid). */
  all: number[];
  /** MS level → that level's record keys, ascending. */
  byLevel: Map<number, number[]>;
  /** The file stores BOTH representations (dual or mixed) → the filter is meaningful. */
  hasBoth: boolean;
  /** At least one spectrum is stored in both facets. */
  hasDual: boolean;
};

/** One O(n) pass, memoized on `browse` by the caller. */
export function buildRecordIndex(browse: BrowseIndex | null | undefined): RecordIndex {
  const all: number[] = [];
  const byLevel = new Map<number, number[]>();
  let anyProfile = false, anyCentroid = false, hasDual = false;
  if (!browse) return { all, byLevel, hasBoth: false, hasDual: false };
  const n = browse.msLevel.length;
  const push = (lvl: number, key: number) => {
    all.push(key);
    const arr = byLevel.get(lvl);
    if (arr) arr.push(key);
    else byLevel.set(lvl, [key]);
  };
  for (let i = 0; i < n; i++) {
    const s = browse.facets?.[i] ?? 0;
    const lvl = browse.msLevel[i]!;
    if (s & STORED_PROFILE) anyProfile = true;
    if (s & STORED_CENTROID) anyCentroid = true;
    if (s === (STORED_PROFILE | STORED_CENTROID)) {
      hasDual = true;
      push(lvl, i * 2); // profile first…
      push(lvl, i * 2 + 1); // …then centroid of the same spectrum
    } else {
      push(lvl, s === STORED_CENTROID ? i * 2 + 1 : i * 2);
    }
  }
  return { all, byLevel, hasBoth: anyProfile && anyCentroid, hasDual };
}

/**
 * Active record keys for an MS-level filter × representation filter. The representation
 * filter keeps records whose representation is actually STORED; it is ignored for files
 * that don't store both (there is nothing to filter, and a stale `sig=` deep link must
 * never empty the navigator).
 */
export function activeRecords(
  ri: RecordIndex,
  browse: BrowseIndex | null | undefined,
  level: number | null,
  rep: RepFilter,
): number[] {
  const base = level == null ? ri.all : (ri.byLevel.get(level) ?? []);
  if (rep === "all" || !ri.hasBoth) return base;
  const want = rep === "profile" ? STORED_PROFILE : STORED_CENTROID;
  const bit = rep === "profile" ? 0 : 1;
  return base.filter((k) => k % 2 === bit && ((browse?.facets?.[Math.floor(k / 2)] ?? 0) & want) !== 0);
}

/**
 * The record key the CURRENT selection corresponds to. Priority: the representation the
 * selection explicitly asked for → what the displayed spectrum truthfully came from →
 * the spectrum's only stored representation → profile.
 */
export function currentRecordKey(
  browse: BrowseIndex | null | undefined,
  index: number,
  requested: Representation | undefined,
  displayed: { index: number; sourceUsed?: Representation } | null,
): number {
  const s = browse?.facets?.[index] ?? 0;
  const rep: Representation =
    requested ??
    (displayed && displayed.index === index && displayed.sourceUsed ? displayed.sourceUsed : undefined) ??
    (s === STORED_CENTROID ? "centroid" : "profile");
  return recordKey(index, rep);
}

/** Whether the record's spectrum is dual-stored (its representation must be read explicitly). */
export function isDualRecord(browse: BrowseIndex | null | undefined, key: number): boolean {
  return (browse?.facets?.[Math.floor(key / 2)] ?? 0) === (STORED_PROFILE | STORED_CENTROID);
}

/** Spectrum counts as the UI presents them — ONE source for the Summary, the sidebar and
 *  the navigator. `records` counts every stored (spectrum, representation) pair, so a
 *  dual-stored file of N spectra reports 2N; `scans` stays the metadata row count. */
export function spectrumCounts(stats: FileStats): {
  records: number;
  scans: number;
  hasBoth: boolean;
  profile: number | null;
  centroid: number | null;
  both: number;
} {
  const sr = stats.storedRepresentation;
  return {
    records: sr?.records ?? stats.numSpectra,
    scans: stats.numSpectra,
    hasBoth: !!sr && sr.profile > 0 && sr.centroid > 0,
    profile: sr?.profile ?? null,
    centroid: sr?.centroid ?? null,
    both: sr?.both ?? 0,
  };
}
