// Named error taxonomy for the reader boundary.
//
// BOUNDARY CONTRACT: these classes are the ONLY way the reader communicates
// failure to the store and UI layers. No mzpeakts/Arrow types cross upward.
//
// Class hierarchy:
//   Error
//     ├── UnsupportedEncodingError  (DATA-02: unsupported but valid mzPeak file)
//     ├── CorruptFileError          (unreadable / not a valid mzPeak file)
//     └── (network)                 (URL unreachable / CORS-blocked — classified
//                                    from the fetch TypeError, no dedicated class)
import type { UnsupportedFinding } from "./types";

/** Discriminator string for store.error classification (R-03b). */
export type ReaderErrorClass = "unsupported-encoding" | "corrupt" | "network";

/**
 * Thrown when a file uses an encoding the bundled mzpeakts reader cannot
 * decode (MS-Numpress, auxiliary arrays, directory storage). Carries named
 * findings so the UI can render a class-specific, actionable message.
 *
 * This is a LOAD ABORT — the reader must not return any signal arrays after
 * throwing this error (DATA-02 / T-01-03-SPOOF).
 */
export class UnsupportedEncodingError extends Error {
  readonly findings: UnsupportedFinding[];

  constructor(findings: UnsupportedFinding[]) {
    const codes = findings.map((f) => f.code).join(", ");
    super(
      `File uses unsupported encoding(s): ${codes}. ` +
        `The bundled reader does not implement these encodings. ` +
        `See 'findings' for details.`,
    );
    this.name = "UnsupportedEncodingError";
    this.findings = findings;
    // Maintain proper prototype chain in transpiled environments.
    Object.setPrototypeOf(this, UnsupportedEncodingError.prototype);
  }
}

/**
 * Thrown when a file cannot be parsed at all — not a valid ZIP, missing the
 * mzpeak_index.json, corrupt Parquet, etc. Distinct from UnsupportedEncodingError
 * so the UI can prompt the user appropriately (PITFALLS 11 / T-01-03-INFO).
 */
export class CorruptFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptFileError";
    Object.setPrototypeOf(this, CorruptFileError.prototype);
  }
}
