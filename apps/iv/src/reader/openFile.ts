// Local-file entry point for the reader boundary.
//
// Uses `MzPeakReader.fromBlob` directly — the vendored reader has a first-class
// BlobReader path that works with browser `File` objects (which ARE `Blob` subclasses).
// This file is the ONLY place local-file bytes enter the reader; it enforces the same
// boundary rule as openUrl.ts: no mzpeakts import outside src/reader/.
import { openBlob, type Reader } from "./openUrl";

/**
 * Open a local `.mzpeak` File (from an `<input type=file>` or a drag-drop event)
 * via the vendored mzpeakts BlobReader.  A browser `File` IS a `Blob`, so we pass
 * it directly.  No `URL.createObjectURL` workaround needed.
 *
 * Boundary: zip.js `BlobReader` reads the file bytes locally; no bytes leave the
 * browser (T-01-02-INFO).
 */
export async function openFile(file: File): Promise<Reader> {
  // `File` extends `Blob`, so this is safe without casting.
  return openBlob(file);
}
