/**
 * DATA-02 capability detection tests — fail-loud on unsupported encodings.
 *
 * Codex bindings (R-03a, R-03b):
 *   R-03a: All THREE unsupported classes must produce a named UnsupportedFinding:
 *     1. MS-Numpress (MS:1002312)
 *     2. Auxiliary arrays (populated auxiliary_arrays field)
 *     3. Directory storage (storage_type === 'directory')
 *   R-03b: When load ABORTS due to unsupported encoding:
 *     store.error = { class: 'unsupported-encoding', message, findings }
 *     ErrorBanner is the authoritative display; CapabilitiesPanel is NOT used.
 *
 * Test approach: uses synthetic mock readers for the detection tests (since no
 * real Numpress binary exists) and real fixtures for the "returns []" baseline.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openBlob, type Reader } from "./openUrl";
import { manifest } from "./fileMeta";
import { detectUnsupported } from "./capability";
import { UnsupportedEncodingError, CorruptFileError } from "./errors";

// ── Fixture paths ─────────────────────────────────────────────────────────────

const POINT_FIXTURE = fileURLToPath(
  new URL("../../test/data/example.mzpeak", import.meta.url),
);

async function openFixture(path: string): Promise<Reader> {
  const bytes = await readFile(path);
  return openBlob(new Blob([bytes]));
}

// ── Helper: build a synthetic reader-like object for mock testing ─────────────

function makeReader(
  arrayIndexEntries: Array<{ transform?: string | null; bufferFormat?: string; arrayTypeCURIE?: string }>,
  fileIndexMeta: Record<string, unknown> = {},
  storageType?: string,
): Reader {
  const fakeArrayIndex = {
    entries: arrayIndexEntries.map((e) => ({
      transform: e.transform !== undefined ? e.transform : null,
      bufferFormat: e.bufferFormat ?? "point",
      arrayTypeCURIE: e.arrayTypeCURIE ?? "MS:1000514",
    })),
  };
  return {
    _spectrumDataReader: { arrayIndex: fakeArrayIndex },
    _spectrumPeaksReader: null,
    spectrumMetadata: { length: 0, get: () => null },
    store: {
      fileIndex: {
        metadata: { ...fileIndexMeta, ...(storageType ? { storage_type: storageType } : {}) },
        files: [],
      },
    },
  } as unknown as Reader;
}

// ── R-03a: Numpress detection ─────────────────────────────────────────────────

describe("detectUnsupported — MS-Numpress (MS:1002312)", () => {
  it("returns a finding with code MS:1002312 when transform is Numpress Linear (R-03a)", () => {
    const reader = makeReader([
      { bufferFormat: "chunk_values", arrayTypeCURIE: "MS:1000514", transform: "MS:1002312" },
      { bufferFormat: "chunk_secondary", arrayTypeCURIE: "MS:1000515", transform: null },
    ]);
    const findings = detectUnsupported(reader, []);
    const numpressFindings = findings.filter((f) => f.code === "MS:1002312");
    expect(numpressFindings.length).toBeGreaterThan(0);
    expect(numpressFindings[0].label.toLowerCase()).toContain("numpress");
  });

  it("returns a finding with code MS:1002312 when transform is Numpress SLOF (MS:1002314)", () => {
    const reader = makeReader([
      { bufferFormat: "chunk_secondary", arrayTypeCURIE: "MS:1000515", transform: "MS:1002314" },
    ]);
    const findings = detectUnsupported(reader, []);
    expect(findings.some((f) => f.code === "MS:1002314")).toBe(true);
  });

  it("returns [] for a point-layout reader with no Numpress transforms (supported)", () => {
    const reader = makeReader([
      { bufferFormat: "point", arrayTypeCURIE: "MS:1000514", transform: "MS:1003901" },
      { bufferFormat: "point", arrayTypeCURIE: "MS:1000515", transform: "MS:1003902" },
    ]);
    const findings = detectUnsupported(reader, []);
    expect(findings).toEqual([]);
  });
});

// ── R-03a: Auxiliary arrays detection ────────────────────────────────────────

describe("detectUnsupported — auxiliary arrays (R-03a)", () => {
  it("returns a finding when fileIndex.metadata contains populated auxiliary_arrays", () => {
    const reader = makeReader(
      [{ bufferFormat: "point", arrayTypeCURIE: "MS:1000514" }],
      {
        auxiliary_arrays: [
          { name: "uv_trace", entity_type: "wavelength_spectrum" },
        ],
      },
    );
    const findings = detectUnsupported(reader, []);
    const auxFindings = findings.filter((f) =>
      f.code.includes("auxiliary") || f.label.toLowerCase().includes("auxiliary"),
    );
    expect(auxFindings.length).toBeGreaterThan(0);
  });

  it("returns [] when auxiliary_arrays is absent or empty", () => {
    const reader = makeReader(
      [{ bufferFormat: "point", arrayTypeCURIE: "MS:1000514" }],
      { auxiliary_arrays: [] },
    );
    const findings = detectUnsupported(reader, []);
    const auxFindings = findings.filter((f) =>
      f.code.includes("auxiliary") || f.label.toLowerCase().includes("auxiliary"),
    );
    expect(auxFindings.length).toBe(0);
  });

  it("returns [] when fileIndex.metadata has no auxiliary_arrays key", () => {
    const reader = makeReader(
      [{ bufferFormat: "point", arrayTypeCURIE: "MS:1000514" }],
      {},
    );
    const findings = detectUnsupported(reader, []);
    expect(findings).toEqual([]);
  });
});

// ── R-03a: Directory storage detection ───────────────────────────────────────

describe("detectUnsupported — directory storage (R-03a)", () => {
  it("returns a finding when fileIndex.metadata.storage_type === 'directory'", () => {
    const reader = makeReader(
      [{ bufferFormat: "point", arrayTypeCURIE: "MS:1000514" }],
      {},
      "directory",
    );
    const findings = detectUnsupported(reader, []);
    const dirFindings = findings.filter(
      (f) =>
        f.code.includes("directory") ||
        f.label.toLowerCase().includes("directory"),
    );
    expect(dirFindings.length).toBeGreaterThan(0);
  });

  it("returns [] for ZIP storage (storage_type absent / ZIP)", () => {
    const reader = makeReader(
      [{ bufferFormat: "point", arrayTypeCURIE: "MS:1000514" }],
      {},
    );
    const findings = detectUnsupported(reader, []);
    expect(findings).toEqual([]);
  });

  it("returns [] when storage_type === 'zip'", () => {
    const reader = makeReader(
      [{ bufferFormat: "point", arrayTypeCURIE: "MS:1000514" }],
      {},
      "zip",
    );
    const findings = detectUnsupported(reader, []);
    expect(findings).toEqual([]);
  });
});

// ── Real-fixture baseline: supported files return [] ─────────────────────────

describe("detectUnsupported — returns [] for supported real fixtures", () => {
  let pointReader: Reader;

  beforeAll(async () => {
    pointReader = await openFixture(POINT_FIXTURE);
    // Eagerly init the data reader so the arrayIndex is populated.
    await pointReader.spectrumData();
  });

  it("returns [] for the point-layout demo fixture (no unsupported encodings)", () => {
    const mf = manifest(pointReader);
    const findings = detectUnsupported(pointReader, mf);
    expect(findings).toEqual([]);
  });

});

// ── Error taxonomy ────────────────────────────────────────────────────────────

describe("UnsupportedEncodingError", () => {
  it("is an Error instance with the correct class discriminator", () => {
    const err = new UnsupportedEncodingError([
      { code: "MS:1002312", label: "MS-Numpress Linear" },
    ]);
    expect(err).toBeInstanceOf(Error);
    expect(err.findings.length).toBe(1);
    expect(err.findings[0].code).toBe("MS:1002312");
    expect(err.message).toContain("MS:1002312");
  });
});

describe("CorruptFileError", () => {
  it("is an Error instance distinct from UnsupportedEncodingError", () => {
    const err = new CorruptFileError("file could not be parsed");
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnsupportedEncodingError);
    expect(err.message).toContain("could not be parsed");
  });
});

// ── Store-level integration: error classification ─────────────────────────────
// These tests verify the store classifies errors correctly without loading
// the full UI. We test by directly calling openBlob on a corrupt blob and
// confirming the error type propagates correctly for classification.

describe("error classification: corrupt blob", () => {
  it("openBlob on garbage bytes throws an error (not UnsupportedEncodingError)", async () => {
    const corruptBlob = new Blob([new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x02, 0x03])]);
    let threw = false;
    let errorIsUnsupported = false;
    try {
      await openBlob(corruptBlob);
    } catch (err) {
      threw = true;
      errorIsUnsupported = err instanceof UnsupportedEncodingError;
    }
    expect(threw).toBe(true);
    expect(errorIsUnsupported).toBe(false);
  });
});
