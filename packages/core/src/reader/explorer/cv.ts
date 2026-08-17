// Shared helpers for the reader's promoted-column "meta" bags, which are keyed
// by accession-derived names like "MS_1000511_ms_level". Single source of truth
// for the column names + small coercions used by both summary.ts and browse.ts.
import type { Representation } from "./types";

const REPR_PROFILE = "MS:1000128";
const REPR_CENTROID = "MS:1000127";

/** Top-level Arrow struct columns of the spectrum-metadata table. */
export const COL = {
  msLevel: "MS_1000511_ms_level",
  representation: "MS_1000525_spectrum_representation",
  time: "time",
  id: "id",
  tic: "MS_1000285_total_ion_current_unit_MS_1000131",
  mzLow: "MS_1000528_lowest_observed_mz_unit_MS_1000040",
  mzHigh: "MS_1000527_highest_observed_mz_unit_MS_1000040",
} as const;

// The flat (metadata-refactor) layout promotes these columns under PLAIN names — no nested
// accession prefix. The VALUES are identical (e.g. spectrum_representation still holds
// "MS:1000127"), only the column name differs. Resolve either spelling so the summary scan —
// which fills stats.msLevels (the MS-level filter), m/z range, TIC detection, representation
// counts — works on both layouts. Without this, flat files read every column as absent:
// msLevel becomes -1, the MS1/MS2 selector disappears, and m/z range shows "—".
export const COL_FLAT = {
  msLevel: "ms_level",
  representation: "spectrum_representation",
  time: "time",
  id: "id",
  tic: "total_ion_current",
  mzLow: "lowest_observed_mz",
  mzHigh: "highest_observed_mz",
} as const;

/** Resolve a promoted column by its nested name, falling back to the flat name. */
export function getCol<T>(
  vec: { getChild?: (n: string) => T | null } | null | undefined,
  key: keyof typeof COL,
): T | null {
  if (!vec?.getChild) return null;
  return vec.getChild(COL[key]) ?? vec.getChild(COL_FLAT[key]) ?? null;
}

/** Map a raw MS:1000525 value to the UI representation enum. */
export function toRepresentation(raw: unknown): Representation {
  if (raw === REPR_PROFILE) return "profile";
  if (raw === REPR_CENTROID) return "centroid";
  return null;
}

/** Narrow an unknown meta value to a plain record. */
export function bag(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
}

/** Coerce a numeric Arrow cell (number | bigint) to a finite number, else null.
 *  Strings are intentionally rejected so a stray "" can't become a real 0. */
export function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Representation of a record, from its promoted-column bag with an isProfile fallback. */
export function recRepresentation(rec: {
  meta?: unknown;
  isProfile?: boolean;
}): Representation {
  const m = bag(rec.meta);
  const raw = m[COL.representation] ?? (rec.isProfile ? REPR_PROFILE : undefined);
  return toRepresentation(raw);
}
