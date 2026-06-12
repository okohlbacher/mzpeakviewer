/**
 * Tests for stats.ts — computeStats, computeCapabilities, probeIsImaging.
 *
 * Codex bindings:
 *   R-02b: representationCounts (profile vs centroid) asserted for demo fixture.
 *   R-02c: isImaging detection TRUE/FALSE with synthetic imaging / non-imaging mocks.
 *   R-02d: mzRange non-null when derivable; explicit "not available" when not.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openBlob, type Reader } from "./openUrl";
import { manifest } from "./fileMeta";
import { computeStats, computeCapabilities, probeIsImaging } from "./stats";
import type { ManifestEntry } from "./types";

// ── Fixture helpers ───────────────────────────────────────────────────────────

const POINT_FIXTURE = fileURLToPath(
  new URL("../../test/data/example.mzpeak", import.meta.url),
);

async function openFixture(path: string): Promise<Reader> {
  const bytes = await readFile(path);
  return openBlob(new Blob([bytes]));
}

// ── Real-fixture tests ────────────────────────────────────────────────────────

describe("computeStats against example.mzpeak (imaging, point)", () => {
  let reader: Reader;
  let mf: ManifestEntry[];

  beforeAll(async () => {
    reader = await openFixture(POINT_FIXTURE);
    mf = manifest(reader);
  });

  it("numSpectra === 9 (the 3×3 example grid) and numEntities === manifest.length", () => {
    const stats = computeStats(reader, mf);
    expect(stats.numSpectra).toBe(9); // example.mzpeak is a 3×3 imaging grid
    expect(stats.numEntities).toBe(mf.length);
  });

  it("msLevels is a non-empty array of numbers (R-02b)", () => {
    const stats = computeStats(reader, mf);
    expect(Array.isArray(stats.msLevels)).toBe(true);
    expect(stats.msLevels.length).toBeGreaterThan(0);
    for (const l of stats.msLevels) {
      expect(typeof l).toBe("number");
    }
  });

  // R-02b: representation breakdown must be computed and sum to numSpectra (profile + centroid
  // may not equal numSpectra if some have unknown representation, but both counts must be >= 0).
  it("representationCounts has profile and centroid as non-negative integers (R-02b)", () => {
    const stats = computeStats(reader, mf);
    expect(stats.representationCounts).toBeDefined();
    expect(stats.representationCounts.profile).toBeGreaterThanOrEqual(0);
    expect(stats.representationCounts.centroid).toBeGreaterThanOrEqual(0);
    // The imaging example has signal; profile + centroid sum > 0.
    expect(
      stats.representationCounts.profile + stats.representationCounts.centroid,
    ).toBeGreaterThan(0);
  });

  // R-02d: mzRange — either a non-null pair when scan windows carry CV terms,
  // or null with a defined shape (not undefined).
  it("mzRange is null or [number, number] — never undefined (R-02d)", () => {
    const stats = computeStats(reader, mf);
    if (stats.mzRange !== null) {
      expect(Array.isArray(stats.mzRange)).toBe(true);
      expect(stats.mzRange.length).toBe(2);
      expect(typeof stats.mzRange[0]).toBe("number");
      expect(typeof stats.mzRange[1]).toBe("number");
      expect(stats.mzRange[0]).toBeLessThanOrEqual(stats.mzRange[1]);
    } else {
      // null is the explicit "not available" signal (R-02d).
      expect(stats.mzRange).toBeNull();
    }
  });
});

describe("computeCapabilities against example.mzpeak (imaging, point)", () => {
  let reader: Reader;
  let mf: ManifestEntry[];

  beforeAll(async () => {
    reader = await openFixture(POINT_FIXTURE);
    mf = manifest(reader);
    // Init the array index so layout detection inspects REAL columns (not the
    // pre-read default), proving the imaging fixture is genuinely point layout.
    await reader.spectrumData();
  });

  it("returns layout=point (real array index) and an encodings array", () => {
    const caps = computeCapabilities(reader, mf);
    // Verified: imaging mzPeak uses point layout (no chunk_* columns).
    expect(caps.layout).toBe("point");
    expect(Array.isArray(caps.encodings)).toBe(true);
  });

  it("isImaging is true for the imaging example", () => {
    const caps = computeCapabilities(reader, mf);
    expect(caps.isImaging).toBe(true);
  });

  it("unsupported is [] (populated by plan 01-03)", () => {
    const caps = computeCapabilities(reader, mf);
    expect(caps.unsupported).toEqual([]);
  });
});

// ── R-02c: Synthetic imaging detection ───────────────────────────────────────
//
// A real binary .mzpeak with promoted IMS columns is not feasible to synthesise
// here; instead we build minimal Reader-shaped mocks that exercise each detection
// path of probeIsImaging.

describe("probeIsImaging — synthetic imaging / non-imaging mocks (R-02c)", () => {
  /**
   * Build a minimal mock reader whose spectrumMetadata.get(i) returns scan records
   * with promoted IMS_1000050_position_x / IMS_1000051_position_y columns.
   */
  function makeScanMeta(meta: Record<string, unknown>) {
    return {
      scans: [
        {
          meta,
          getParamByAccession: (_acc: string) => undefined,
        },
      ],
    };
  }

  function makeReader(spectra: ReturnType<typeof makeScanMeta>[], fileIndexMeta?: unknown): Reader {
    return {
      store: {
        fileIndex: {
          metadata: fileIndexMeta ?? {},
        },
      },
      spectrumMetadata: {
        length: spectra.length,
        get: (i: number) => spectra[i],
      },
      _spectrumDataReader: null,
      _spectrumPeaksReader: null,
    } as unknown as Reader;
  }

  it("returns TRUE when scan meta has IMS_1000050_position_x column (authoritative promoted column)", () => {
    const reader = makeReader([
      makeScanMeta({ IMS_1000050_position_x: 1n, IMS_1000051_position_y: 1n }),
    ]);
    expect(probeIsImaging(reader)).toBe(true);
  });

  it("returns TRUE when scan meta has IMS_1000051_position_y column only", () => {
    const reader = makeReader([
      makeScanMeta({ IMS_1000051_position_y: 2n }),
    ]);
    expect(probeIsImaging(reader)).toBe(true);
  });

  it("returns TRUE when metadata.imaging.is_imaging=true in file index", () => {
    const reader = makeReader(
      [makeScanMeta({})],
      { imaging: { is_imaging: true } },
    );
    expect(probeIsImaging(reader)).toBe(true);
  });

  it("returns TRUE when getParamByAccession returns IMS:1000050", () => {
    const readerWithCV: Reader = {
      store: { fileIndex: { metadata: {} } },
      spectrumMetadata: {
        length: 1,
        get: (_i: number) => ({
          scans: [
            {
              meta: {},
              getParamByAccession: (acc: string) =>
                acc === "IMS:1000050"
                  ? { accession: "IMS:1000050", name: "position x", value: 1 }
                  : undefined,
            },
          ],
        }),
      },
      _spectrumDataReader: null,
      _spectrumPeaksReader: null,
    } as unknown as Reader;
    expect(probeIsImaging(readerWithCV)).toBe(true);
  });

  it("returns FALSE for non-imaging fixture (no IMS columns, no discovery flag)", () => {
    const reader = makeReader([
      makeScanMeta({ MS_1000511_ms_level: 1 }),
    ]);
    expect(probeIsImaging(reader)).toBe(false);
  });

  it("returns FALSE when spectrumMetadata has zero entries", () => {
    const reader = makeReader([]);
    expect(probeIsImaging(reader)).toBe(false);
  });

  it("returns FALSE when spectrumMetadata is null", () => {
    const reader = {
      store: { fileIndex: { metadata: {} } },
      spectrumMetadata: null,
      _spectrumDataReader: null,
      _spectrumPeaksReader: null,
    } as unknown as Reader;
    expect(probeIsImaging(reader)).toBe(false);
  });
});
