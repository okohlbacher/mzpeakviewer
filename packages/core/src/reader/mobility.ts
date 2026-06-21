// Compact in-memory ion-mobility codec for timsTOF / IMS spectra.
//
// The mzPeak `mean inverse reduced ion mobility` column (1/K0, MS:1003006) is f64 on disk
// but a TIMS frame holds only a few hundred DISTINCT values (one per mobility/scan bin)
// across its >10⁵ peaks. Materializing it as a per-peak Float64Array wastes 8 bytes for
// ~10 bits of real information. `packMobility` dictionary-encodes it instead: a small
// ascending lookup of the distinct values + a per-peak index into it.

import type { MobilityCodec } from "@mzpeak/contracts";

/**
 * Dictionary-encode a raw per-peak 1/K0 array into a {@link MobilityCodec}.
 *
 * `values` are the distinct inputs, ascending; `index[i]` is the position of `raw[i]`
 * within `values`. The index is `Uint16Array` when there are ≤65535 distinct bins (always
 * true for timsTOF, ~hundreds), else `Uint32Array`. Non-finite inputs are kept as-is (a
 * single NaN bin), so the caller should sanitize alongside its m/z pairs first.
 */
export function packMobility(raw: ArrayLike<number>): MobilityCodec {
  const n = raw.length;
  // Distinct values (Map uses SameValueZero, so a stray NaN collapses to one bin).
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) seen.add(raw[i]!);
  const values = Float64Array.from(seen).sort(); // typed-array sort is numeric by default

  const rank = new Map<number, number>();
  for (let i = 0; i < values.length; i++) rank.set(values[i]!, i);

  const index = values.length <= 0xffff ? new Uint16Array(n) : new Uint32Array(n);
  for (let i = 0; i < n; i++) index[i] = rank.get(raw[i]!)!;

  return { values, index };
}

/** The 1/K0 value for peak `i` (decode a single entry without materializing the full array). */
export function mobilityAt(c: MobilityCodec, i: number): number {
  return c.values[c.index[i]!]!;
}
