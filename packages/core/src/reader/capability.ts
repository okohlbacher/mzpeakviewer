// Pre-render capability detection for the mzpeakts reader boundary.
//
// Inspects the reader's array index and file index metadata BEFORE any signal
// arrays are read and returns a list of named UnsupportedFindings for any
// encodings the bundled reader cannot decode.
//
// The caller (openUrl / openFile) must throw UnsupportedEncodingError(findings)
// if the returned array is non-empty.
//
// Import boundary: this file is inside src/reader/ and is the ONLY import-site
// of the encoding CV accessions. No mzpeakts types leak upward.
import type { Reader } from "./openUrl";
import type { ManifestEntry, UnsupportedFinding } from "./types";

// ── detectUnsupported ─────────────────────────────────────────────────────────

/**
 * Inspect the reader's static metadata (array index + file index) for any
 * encodings that the bundled mzpeakts reader cannot decode.
 *
 * Returns a named `UnsupportedFinding` per problem.
 * Returns `[]` if all encodings are supported.
 *
 * Checks: a populated `auxiliary_arrays` list, and `storage_type === 'directory'`, in the file
 * index metadata. (Every array transform in use — delta, Numpress Linear/SLOF/PIC, the coordinate
 * grid, null-zero/interpolate — is decoded by the vendored reader, so none is gated here.)
 */
export function detectUnsupported(
  reader: Reader,
  _manifest: ManifestEntry[],
): UnsupportedFinding[] {
  const findings: UnsupportedFinding[] = [];
  const seenCodes = new Set<string>();

  // ── Auxiliary arrays ──────────────────────────────────────────────────────
  const fileIndexMeta: Record<string, unknown> =
    (reader.store?.fileIndex?.metadata as Record<string, unknown>) ?? {};
  const auxArrays = fileIndexMeta["auxiliary_arrays"];
  if (Array.isArray(auxArrays) && auxArrays.length > 0) {
    const code = "auxiliary-arrays";
    if (!seenCodes.has(code)) {
      seenCodes.add(code);
      findings.push({
        code,
        label: `Auxiliary arrays (${auxArrays.length} entry/entries) — the bundled reader does not decode auxiliary array data`,
      });
    }
  }

  // ── Directory storage ─────────────────────────────────────────────────────
  const storageType = fileIndexMeta["storage_type"];
  if (typeof storageType === "string" && storageType.toLowerCase() === "directory") {
    const code = "directory-storage";
    if (!seenCodes.has(code)) {
      seenCodes.add(code);
      findings.push({
        code,
        label: "Directory storage (storage_type: directory) — the bundled reader only supports uncompressed ZIP containers",
      });
    }
  }

  return findings;
}
