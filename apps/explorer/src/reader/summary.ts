// File overview, split into a fast O(1) part (shown immediately) and a single
// async per-spectrum pass (the "explore the rest" step). The async pass yields
// to the event loop periodically so a million-spectrum file never freezes the
// UI, and it produces BOTH the summary aggregates and the Browse navigation
// index in one sweep (no double iteration). No signal arrays are ever read.
import type { Reader } from "./open";
import { COL, numOrNull, toRepresentation } from "./cv";
import { readImaging } from "./imaging";
import type {
  FileSummary,
  ManifestEntry,
  SpectrumIndexRow,
} from "./types";

/** Minimal shape of an Apache Arrow child vector (one column). */
type ArrowCol = { get(i: number): unknown } | null;
type ArrowStructVec = {
  length: number;
  getChild?: (name: string) => ArrowCol;
} | null;

/** Fields the async scan fills in; merged onto the fast summary when it finishes. */
export type ScanAggregates = Pick<
  FileSummary,
  "msLevelCounts" | "representationCounts" | "mzRange" | "rtRange" | "isImaging"
>;

export type ScanResult = { rows: SpectrumIndexRow[]; aggregates: ScanAggregates };

/**
 * Immediate overview — counts, storage layout, encodings, and a cheap imaging
 * flag from the index discovery block. The per-spectrum fields are left empty
 * (filled in by {@link scanSpectra}). No iteration over all spectra.
 */
export function computeFastSummary(
  reader: Reader,
  manifest: ManifestEntry[],
  fileName: string,
  fileSize: number | null,
): FileSummary {
  const { layout, encodings } = detectLayout(reader);

  // Imaging discovery block (metadata only). Drives both the boolean flag and
  // the detailed imaging readout (pixel grid, optical images, scan geometry).
  const imaging = readImaging(reader);

  return {
    fileName,
    fileSize,
    numSpectra: reader.spectrumMetadata?.length ?? 0,
    numChromatograms: reader.numChromatograms ?? 0,
    numEntities: manifest.length,
    msLevelCounts: {},
    representationCounts: { profile: 0, centroid: 0, unknown: 0 },
    mzRange: null,
    rtRange: null,
    layout,
    encodings,
    isImaging: imaging?.isImaging ?? false,
    imaging,
    instrument: instrumentModel(reader),
  };
}

// Instrument-model CV term (MS:1000031) and a few non-model params to skip when
// the model isn't explicitly tagged.
const INSTRUMENT_MODEL_ACC = "MS:1000031";
const NON_MODEL_NAME = /serial|customization|resolution|software|version/i;

/** Best-effort instrument model name from the first instrument configuration. */
function instrumentModel(reader: Reader): string | null {
  const fm = reader.fileMetadata as
    | { instrumentConfigurations?: unknown[] }
    | undefined;
  const configs = fm?.instrumentConfigurations;
  if (!Array.isArray(configs)) return null;
  for (const cfg of configs) {
    const c = cfg as { parameters?: unknown[]; params?: unknown[] };
    const params = (c.parameters ?? c.params) as
      | { accession?: string; name?: string }[]
      | undefined;
    if (!Array.isArray(params)) continue;
    // Prefer the param explicitly typed as the instrument model.
    const tagged = params.find((p) => p?.accession === INSTRUMENT_MODEL_ACC);
    if (tagged?.name) return tagged.name;
    const named = params.find(
      (p) => typeof p?.name === "string" && p.name && !NON_MODEL_NAME.test(p.name),
    );
    if (named?.name) return named.name;
  }
  return null;
}

/**
 * Single async pass over the spectrum metadata table. Time-sliced: it yields to
 * the event loop whenever a slice has run longer than `SLICE_MS`, so even a
 * multi-hundred-thousand-spectrum file never freezes the UI. Returns the Browse
 * navigation index plus the aggregate stats, and reports progress.
 */
const SLICE_MS = 12;

export async function scanSpectra(
  reader: Reader,
  onProgress?: (done: number, total: number) => void,
): Promise<ScanResult> {
  const sm = reader.spectrumMetadata;
  const n = sm?.length ?? 0;
  // Read the Browse index straight from the Arrow struct columns. This avoids
  // sm.get(i), which materializes each row's nested scans/precursors — far too
  // slow on a large file (it left `scanned` stuck false, so the MS-level filter
  // showed a perpetual "0"). The Arrow-backed reader always exposes columns; if
  // an exotic reader doesn't, the index is left empty (direct browsing still works).
  const vec = (sm as unknown as { spectra?: ArrowStructVec })?.spectra ?? null;
  if (!vec?.getChild) {
    onProgress?.(n, n);
    return {
      rows: [],
      aggregates: {
        msLevelCounts: {},
        representationCounts: { profile: 0, centroid: 0, unknown: 0 },
        mzRange: null,
        rtRange: null,
        isImaging: false,
      },
    };
  }
  return scanByColumns(vec, n, onProgress);
}

/** Browse-index pass over the top-level Arrow columns (no row materialization). */
async function scanByColumns(
  vec: NonNullable<ArrowStructVec>,
  n: number,
  onProgress?: (done: number, total: number) => void,
): Promise<ScanResult> {
  const get = (name: string): ArrowCol => vec.getChild!(name);
  const msLevelCol = get(COL.msLevel);
  const reprCol = get(COL.representation);
  const timeCol = get(COL.time);
  const idCol = get(COL.id);
  const ticCol = get(COL.tic);
  const mzLoCol = get(COL.mzLow);
  const mzHiCol = get(COL.mzHigh);

  const rows: SpectrumIndexRow[] = new Array(n);
  const msLevelCounts: Record<number, number> = {};
  let profile = 0;
  let centroid = 0;
  let unknownRep = 0;
  let mzMin: number | null = null;
  let mzMax: number | null = null;
  let rtMin: number | null = null;
  let rtMax: number | null = null;
  let sliceStart = performance.now();

  for (let i = 0; i < n; i++) {
    const msLevel = numOrNull(msLevelCol?.get(i));
    if (msLevel !== null) {
      msLevelCounts[msLevel] = (msLevelCounts[msLevel] ?? 0) + 1;
    }

    const representation = toRepresentation(reprCol?.get(i));
    if (representation === "profile") profile++;
    else if (representation === "centroid") centroid++;
    else unknownRep++;

    const time = numOrNull(timeCol?.get(i));
    if (time !== null) {
      if (rtMin === null || time < rtMin) rtMin = time;
      if (rtMax === null || time > rtMax) rtMax = time;
    }

    const lo = numOrNull(mzLoCol?.get(i));
    const hi = numOrNull(mzHiCol?.get(i));
    if (lo !== null && (mzMin === null || lo < mzMin)) mzMin = lo;
    if (hi !== null && (mzMax === null || hi > mzMax)) mzMax = hi;

    rows[i] = {
      index: i,
      id: String(idCol?.get(i) ?? i),
      msLevel,
      representation,
      time,
      tic: numOrNull(ticCol?.get(i)),
    };

    if (performance.now() - sliceStart > SLICE_MS) {
      onProgress?.(i + 1, n);
      await new Promise<void>((r) => setTimeout(r, 0));
      sliceStart = performance.now();
    }
  }
  onProgress?.(n, n);

  return {
    rows,
    aggregates: {
      msLevelCounts,
      representationCounts: { profile, centroid, unknown: unknownRep },
      mzRange: mzMin !== null && mzMax !== null ? [mzMin, mzMax] : null,
      rtRange: rtMin !== null && rtMax !== null ? [rtMin, rtMax] : null,
      // The imaging flag is owned by readImaging() (the authoritative index-block
      // discovery) and OR-merged in the store; the per-spectrum probe is omitted
      // here to keep this pass column-only.
      isImaging: false,
    },
  };
}

const BF_CHUNK = new Set([
  "chunk_values",
  "chunk_encoding",
  "chunk_start",
  "chunk_end",
  "chunk_secondary",
  "chunk_transform",
]);

function detectLayout(reader: Reader): {
  layout: FileSummary["layout"];
  encodings: string[];
} {
  const bufferFormats = new Set<string>();
  const encodings = new Set<string>();

  const collect = (idx: unknown) => {
    if (!idx || typeof idx !== "object") return;
    const entries = (idx as { entries?: unknown[] }).entries;
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const entry = e as { bufferFormat?: string; arrayTypeCURIE?: string };
      if (entry.bufferFormat) bufferFormats.add(String(entry.bufferFormat));
      if (entry.arrayTypeCURIE) encodings.add(String(entry.arrayTypeCURIE));
    }
  };
  collect(reader._spectrumDataReader?.arrayIndex);
  collect(reader._spectrumPeaksReader?.arrayIndex);

  let layout: FileSummary["layout"] = "unknown";
  if (bufferFormats.size > 0) {
    const hasPoint = bufferFormats.has("point");
    const hasChunk = [...bufferFormats].some((b) => BF_CHUNK.has(b));
    if (hasPoint && hasChunk) layout = "mixed";
    else if (hasChunk) layout = "chunked";
    else if (hasPoint) layout = "point";
  }

  return { layout, encodings: [...encodings].sort() };
}
