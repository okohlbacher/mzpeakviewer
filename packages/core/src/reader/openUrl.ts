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
import { MzPeakReader, ZipStorage } from "mzpeakts";
import { HttpReader } from "@zip.js/zip.js";
import { detectUnsupported } from "./capability";
import { UnsupportedEncodingError } from "./errors";

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
