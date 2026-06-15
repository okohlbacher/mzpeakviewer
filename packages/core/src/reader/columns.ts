// Shared promoted-column readers over the in-memory spectrum metadata table.
//
// The MS-level column ("MS_1000511_ms_level", canonicalized as COL.msLevel) was read by a
// byte-identical helper in BOTH engine/open.ts (readAllMsLevels) and engine/imaging.ts
// (readMsLevels). Centralized here so there is one reader and one column literal (COL).
import { COL } from "./explorer/cv";
import type { Reader } from "./openUrl";

/**
 * Bulk-read the promoted MS-level column vectorized into an `Int16Array`: `0` for an
 * absent/non-finite level (treated as "unannotated"); `null` when the column is absent (caller
 * then doesn't filter). The promoted columns live on `reader.spectrumMetadata.spectra`.
 */
export function readMsLevels(reader: Reader): Int16Array | null {
  const sm = (reader as unknown as {
    spectrumMetadata?: {
      spectra?: { getChild?: (n: string) => { get(i: number): unknown } | null } | null;
      length?: number;
    } | null;
  }).spectrumMetadata;
  const spectra = sm?.spectra;
  if (!spectra || typeof spectra.getChild !== "function") return null;
  const col = spectra.getChild(COL.msLevel);
  if (!col) return null;
  const n = sm?.length ?? 0;
  const levels = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = col.get(i);
    levels[i] = typeof v === "number" && Number.isFinite(v) ? v : 0;
  }
  return levels;
}
