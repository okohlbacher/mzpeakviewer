// Engine: scan breakdown — the Browse index + aggregate FileStats for an LC/general
// (non-imaging) mzPeak file. Drives Explorer's time-sliced per-spectrum scan to get
// the SpectrumIndexRow[] plus aggregates in one sweep, columnarizes the rows into the
// wire BrowseIndex via the pure adapter, and assembles FileStats from the fast summary
// (counts + instrument) merged with the scan aggregates (ranges + level/repr counts).
//
// Reader I/O is harvested from mzPeakExplorer (src/reader/explorer/{open,summary}.ts);
// the columnar mapping is the pure adapt/browse.ts adapter. No signal arrays are read.
import type { FileStats, BrowseIndex } from "@mzpeak/contracts";
import { buildBrowseIndex, type BrowseRow } from "../adapt/browse";
import type { Reader } from "../reader/explorer/open";
import { computeFastSummary, scanSpectra } from "../reader/explorer/summary";
import type { SpectrumIndexRow } from "../reader/explorer/types";

/** Number of `mzpeak_index.json` entities — the `numEntities` stat. Minimal,
 *  plainify-free read of the already-parsed index (mirrors Explorer meta.ts). */
function countEntities(reader: Reader): number {
  const files = (
    reader as unknown as {
      store?: { fileIndex?: { files?: unknown[] } };
    }
  ).store?.fileIndex?.files;
  return Array.isArray(files) ? files.length : 0;
}

/** Map an Explorer SpectrumIndexRow to the adapter's BrowseRow (drops index/representation). */
function toBrowseRow(r: SpectrumIndexRow): BrowseRow {
  return { id: r.id, msLevel: r.msLevel, time: r.time, tic: r.tic };
}

/**
 * Run the per-spectrum scan and assemble the wire stats + browse index.
 *
 * @returns `stats` (FileStats aggregates) and `browse` (per-spectrum BrowseIndex,
 *   parallel typed arrays of length `stats.numSpectra`).
 */
export async function engineScanBreakdown(
  reader: Reader,
): Promise<{ stats: FileStats; browse: BrowseIndex }> {
  const numEntities = countEntities(reader);
  const fast = computeFastSummary(reader, [], "", null);
  const { rows, aggregates } = await scanSpectra(reader);

  const browse = buildBrowseIndex(rows.map(toBrowseRow));

  const msLevels = Object.keys(aggregates.msLevelCounts)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const stats: FileStats = {
    numSpectra: fast.numSpectra,
    numEntities,
    mzRange: aggregates.mzRange,
    rtRange: aggregates.rtRange,
    msLevels,
    spectraPerLevel: aggregates.msLevelCounts,
    representationCounts: {
      profile: aggregates.representationCounts.profile,
      centroid: aggregates.representationCounts.centroid,
      unknown: aggregates.representationCounts.unknown,
    },
    instrument: fast.instrument,
  };

  return { stats, browse };
}
