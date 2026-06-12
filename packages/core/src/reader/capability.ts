// Pre-render capability detection for the mzpeakts reader boundary.
//
// Inspects the reader's array index and file index metadata BEFORE any signal
// arrays are read and returns a list of named UnsupportedFindings for any
// encodings the bundled reader cannot decode.
//
// The caller (openUrl / openFile) must throw UnsupportedEncodingError(findings)
// if the returned array is non-empty (DATA-02 / PITFALL 3).
//
// Import boundary (R-03c): this file is inside src/reader/ and is the ONLY
// import-site of the encoding CV accessions. No mzpeakts types leak upward.
import type { Reader } from "./openUrl";
import type { ManifestEntry, UnsupportedFinding } from "./types";

// Supported transforms (for reference / documentation):
// "MS:1003901" = NULL_INTERPOLATE_CURIE (handled by interpolateNulls)
// "MS:1003902" = NULL_ZERO_CURIE (handled by nullToZero)
// "MS:1000576" = No compression (direct copy)
// "MS:1003089" = Delta encoding (decodeDelta)
// null         = No transform specified

// ── Unsupported encoding accessions (R-03a) ───────────────────────────────────

/** MS-Numpress Linear Prediction encoding — MS:1002312 */
const NUMPRESS_LINEAR = "MS:1002312";
/** MS-Numpress Positive Integer Compression — MS:1002313 */
const NUMPRESS_PIC = "MS:1002313";
/** MS-Numpress Short Logged Float encoding — MS:1002314 */
const NUMPRESS_SLOF = "MS:1002314";

const NUMPRESS_ACCESSIONS = new Map<string, string>([
  [NUMPRESS_LINEAR, "MS-Numpress Linear Prediction (MS:1002312)"],
  [NUMPRESS_PIC, "MS-Numpress Positive Integer Compression (MS:1002313)"],
  [NUMPRESS_SLOF, "MS-Numpress Short Logged Float (MS:1002314)"],
]);

// ── detectUnsupported ─────────────────────────────────────────────────────────

/**
 * Inspect the reader's static metadata (array index + file index) for any
 * encodings that the bundled mzpeakts reader cannot decode.
 *
 * Returns a named `UnsupportedFinding` per problem.
 * Returns `[]` if all encodings are supported.
 *
 * Checks (R-03a, in order):
 * 1. Numpress: any ArrayIndexEntry with `transform` in {MS:1002312, MS:1002313, MS:1002314}.
 * 2. Auxiliary arrays: populated `auxiliary_arrays` list in the file index metadata.
 * 3. Directory storage: `storage_type === 'directory'` in the file index metadata.
 */
export function detectUnsupported(
  reader: Reader,
  _manifest: ManifestEntry[],
): UnsupportedFinding[] {
  const findings: UnsupportedFinding[] = [];
  const seenCodes = new Set<string>();

  // ── 1. Numpress: check ArrayIndex transforms (static, from Parquet metadata) ──
  function checkArrayIndex(idx: unknown) {
    if (!idx || typeof idx !== "object") return;
    const entries = (idx as { entries?: unknown[] }).entries;
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const entry = e as { transform?: string | null; bufferFormat?: string };
      const transform = entry.transform ?? null;
      if (transform && NUMPRESS_ACCESSIONS.has(transform)) {
        if (!seenCodes.has(transform)) {
          seenCodes.add(transform);
          findings.push({
            code: transform,
            label: NUMPRESS_ACCESSIONS.get(transform)!,
          });
        }
      }
    }
  }

  checkArrayIndex(reader._spectrumDataReader?.arrayIndex ?? null);
  checkArrayIndex(reader._spectrumPeaksReader?.arrayIndex ?? null);

  // ── 2. Auxiliary arrays ──────────────────────────────────────────────────────
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

  // ── 3. Directory storage ─────────────────────────────────────────────────────
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
