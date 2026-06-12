// HARVESTED from mzPeakExplorer/src/reader/open.ts (read-only source; do not edit there).
// The ONE module that imports `mzpeakts`. Everything else depends on the opaque
// `Reader` handle re-exported here.
import { MzPeakReader, ZipStorage } from "mzpeakts";
import { HttpReader } from "@zip.js/zip.js";

/**
 * Opaque reader handle. Concretely an mzpeakts `MzPeakReader`, but callers treat
 * it as a black box and go through the helpers in summary.ts / browse.ts.
 */
export type Reader = InstanceType<typeof MzPeakReader>;

/**
 * Eagerly trigger the spectrum-data reader so the array index is populated
 * (needed for layout/encoding detection). Best-effort: a file with no spectrum
 * data must still open.
 */
async function warm(reader: Reader): Promise<Reader> {
  try {
    await reader.spectrumData();
  } catch {
    // Some files (e.g. chromatogram-only) have no spectrum data — ignore.
  }
  return reader;
}

/** Open a `.mzpeak` from a local File/Blob (no bytes leave the browser). */
export async function openBlob(blob: Blob): Promise<Reader> {
  return warm(await MzPeakReader.fromBlob(blob));
}

/** Open a `.mzpeak` from a URL (HTTP range requests via zip.js).
 *
 * Equivalent to `MzPeakReader.fromUrl(url)` but with `forceRangeRequests: true`:
 * the CDN (data.mzpeak.org / BunnyCDN) serves correct 206 range responses but
 * omits `Accept-Ranges` on them, which makes zip.js throw "HTTP Range not
 * supported". Range demonstrably works (206 + Content-Range), so force it rather
 * than probe for the missing advertisement header. */
export async function openUrl(url: string | URL): Promise<Reader> {
  const reader = new HttpReader(String(url), { useRangeHeader: true, forceRangeRequests: true });
  return warm(await MzPeakReader.fromStore(new ZipStorage(reader)));
}
