// The ONE module that imports `mzpeakts`.
//
// Everything else in the app depends on the opaque `Reader` handle re-exported
// here, never on `mzpeakts` directly. `grep -rl "from 'mzpeakts'" src/` must
// return only this file (acceptance criterion, R-03c).
//
// Exception: mzPeakWorker.ts also imports ZipStorage from mzpeakts for the
// fast-path load (reads only mzpeak_index.json). That import is the ONLY other
// mzpeakts import allowed — kept in the Worker module to stay within the
// reader/ encapsulation boundary.
import { MzPeakReader, ZipStorage, data as mzdata } from "mzpeakts";
import { HttpReader } from "@zip.js/zip.js";
import { detectUnsupported } from "./capability";
import { UnsupportedEncodingError } from "./errors";

// mzpeakts names the reconstructed point columns by their human-readable CV name.
const MZ_ARRAY_KEY = "m/z array";
const INTENSITY_ARRAY_KEY = "intensity array";

/**
 * Opaque reader handle. The concrete type is mzpeakts' `MzPeakReader`, but
 * callers should treat it as a black box and go through the helpers in
 * fileMeta.ts / arrays.ts. Typed via `InstanceType` so no `mzpeakts` types leak
 * into the rest of the app's surface beyond this alias.
 */
export type Reader = InstanceType<typeof MzPeakReader>;

/**
 * Run the capability gate after a reader has been opened + initialized.
 * Eagerly triggers spectrumData() so the arrayIndex is populated for detection.
 * Throws UnsupportedEncodingError if any unsupported encodings are found (DATA-02).
 */
async function capabilityGate(reader: Reader): Promise<Reader> {
  // Eagerly load the spectrum data reader so the arrayIndex is populated (needed
  // for Numpress detection from static Parquet metadata). TOLERATE its absence: a
  // chromatogram-only mzPeak has no spectrum data, and the unified engine must open
  // it rather than reject (review MAJOR — the single open boundary serves both
  // imaging/LC spectra files AND chrom-only files, matching Explorer's open).
  try {
    await reader.spectrumData();
  } catch {
    // No spectrum data (e.g. chromatogram-only file) — continue; downstream reads
    // that genuinely need spectra fail loudly at their own call site.
  }
  const findings = detectUnsupported(reader, []);
  if (findings.length > 0) {
    throw new UnsupportedEncodingError(findings);
  }
  return reader;
}

/**
 * Initialize a full MzPeakReader from an already-opened ZipStorage.
 * Called lazily on the first renderIonImage / selectSpectrum — NOT during
 * the initial file open (which uses ZipStorage.fromUrl/fromBlob directly).
 * Runs the capability gate before returning.
 */
export async function openReaderFromStore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: ZipStorage<any>,
): Promise<Reader> {
  const reader = await MzPeakReader.fromStore(store);
  return capabilityGate(reader);
}

/**
 * Open a `.mzpeak` from a URL (HTTP range requests via zip.js). Eagerly loads
 * metadata; signal arrays are read lazily on demand. The boundary into the
 * vendored WASM reader. Runs the capability gate before returning.
 *
 * `forceRangeRequests: true` is REQUIRED for the data.mzpeak.org / BunnyCDN host:
 * its 206 Partial Content responses carry a correct `Content-Range` but OMIT the
 * `Accept-Ranges` header, so zip.js's default probe concludes ranges are
 * unsupported and throws "HTTP range unsupported" — even though ranges work. We
 * force range mode rather than trust the (missing) advertisement header. This
 * mirrors the Explorer reader (reader/explorer/open.ts); the vendored
 * `MzPeakReader.fromUrl()` builds an unforced `HttpRangeReader`, so we construct
 * the store ourselves instead of using it.
 * @deprecated Use ZipStorage.fromUrl() for the fast path + openReaderFromStore()
 * for lazy full init. This function reads all metadata eagerly.
 */
export async function openUrl(url: string | URL): Promise<Reader> {
  // boundary: mzpeakts/parquet-wasm — opening untrusted file bytes over HTTP.
  const httpReader = new HttpReader(String(url), {
    useRangeHeader: true,
    forceRangeRequests: true,
  });
  const reader = await MzPeakReader.fromStore(new ZipStorage(httpReader));
  return capabilityGate(reader);
}

/**
 * Open a `.mzpeak` from a local File/Blob (no createObjectURL hack needed —
 * mzpeakts has a first-class `fromBlob`). Runs the capability gate before returning.
 */
export async function openBlob(blob: Blob): Promise<Reader> {
  // boundary: mzpeakts/parquet-wasm — opening untrusted local file bytes.
  const reader = await MzPeakReader.fromBlob(blob);
  return capabilityGate(reader);
}

/** One spectrum's plain point arrays, harvested from the bulk spectra_data stream. */
export type StreamedSpectrumArrays = {
  index: number;
  mz: Float64Array;
  intensity: Float32Array;
};

/**
 * Stream EVERY spectrum's (mz, intensity) data arrays in ONE sequential pass over the
 * spectra_data parquet row groups (mzpeakts `DataArraysReader.enumerate`), reading each
 * row group exactly once.
 *
 * This is the IV ion-index discipline and the fix for the O(pixels)×row-group blow-up of
 * the per-pixel path: `reader.getSpectrum(i)` → `DataArraysReader.get(i)` re-reads+decodes
 * a WHOLE row group on every call, so summing an ion image pixel-by-pixel re-reads the same
 * row groups thousands of times (measured ≈ 700 ms/pixel over the CDN ⇒ a 34,840-pixel image
 * never finishes). Enumerating instead touches each row group once.
 *
 * Spectra whose data-array source has no rows (e.g. centroid-only spectra) are simply not
 * yielded — the caller falls back to a per-spectrum read for those few. Kept in this module
 * so the `mzpeakts` import stays confined here (reader-boundary acceptance criterion R-03c).
 */
export async function* streamSpectraDataArrays(
  reader: Reader,
): AsyncGenerator<StreamedSpectrumArrays> {
  // An absent OR empty (0-row-group) spectra_data parquet makes mzpeakts throw
  // ("Empty Parquet file") — common for all-centroid LC/DDA files. Treat as no stream.
  let dr: Awaited<ReturnType<Reader["spectrumData"]>>;
  try {
    dr = await reader.spectrumData();
  } catch {
    return;
  }
  yield* streamArrays(dr);
}

/**
 * Same single-pass bulk stream, but over `spectra_peaks` (mzpeakts `reader.spectrumPeaks`)
 * — the CENTROID source. LC/DDA files store their MS1+MS2 spectra here (not in spectra_data),
 * so this is the path the LC spectrum prefetch reads. Yields `{index, mz, intensity}` for
 * every spectrum that has peak rows; empty/absent → yields nothing.
 */
export async function* streamSpectraPeaksArrays(
  reader: Reader,
): AsyncGenerator<StreamedSpectrumArrays> {
  let dr: Awaited<ReturnType<Reader["spectrumPeaks"]>>;
  try {
    dr = await reader.spectrumPeaks();
  } catch {
    return; // absent/empty spectra_peaks → no stream
  }
  yield* streamArrays(dr);
}

/** Shared core: enumerate a mzpeakts DataArraysReader (data OR peaks) once, row group by
 *  row group, yielding decoded (mz, intensity) per entry. */
async function* streamArrays(
  dataReader: Awaited<ReturnType<Reader["spectrumData"]>>,
): AsyncGenerator<StreamedSpectrumArrays> {
  if (!dataReader) return;
  for await (const [idx, table] of dataReader.enumerate()) {
    // Non-tabular layout (ColumnMap) → skip. Duck-typed so we don't depend on an
    // `instanceof Arrow.Table` across module-instance boundaries.
    const t = table as { schema?: unknown; getChildAt?: unknown };
    if (!t || !t.schema || typeof t.getChildAt !== "function") continue;
    const packed = mzdata.packTableIntoDataArrays(table as Parameters<typeof mzdata.packTableIntoDataArrays>[0]);
    // The m/z and intensity point columns are numeric at runtime; `packTableIntoDataArrays`
    // types its values as a broad union (incl. string[]/BigInt64Array), so narrow here.
    const mzRaw = packed[MZ_ARRAY_KEY] as unknown as ArrayLike<number> | undefined;
    const inRaw = packed[INTENSITY_ARRAY_KEY] as unknown as ArrayLike<number> | undefined;
    if (!mzRaw || !inRaw) continue;
    yield { index: Number(idx), mz: Float64Array.from(mzRaw), intensity: Float32Array.from(inRaw) };
  }
}
