// PURE SDRF helpers shared by the worker (engine/studyMeta channel fallback) and the
// main thread (the app's Study-design view). One reagent table and one run-key
// normalization — duplicating either is exactly the kind of thing that drifts
// (a new raw-file extension or reporter alias added on one side only).

// ── Reagent reporter-ion m/z table (the file supplies only the label STRING, which we
//    look up here). TMT 0/2/6/10/11 + TMTpro 16/18 + iTRAQ 4/8. ──
export const REPORTER_MZ: Record<string, number> = {
  TMT126: 126.127726,
  // Unsuffixed TMT127–TMT130 are the classic TMT2/6-plex spellings (SDRF writes them, e.g.
  // PXD009465) — they carry the C-form reporter masses. Without these aliases a TMT6 run
  // resolved only 2/6 channels (126 + 131).
  TMT127: 127.131081, TMT128: 128.134436, TMT129: 129.13779, TMT130: 130.141145,
  TMT127N: 127.124761, TMT127C: 127.131081,
  TMT128N: 128.128116, TMT128C: 128.134436,
  TMT129N: 129.131471, TMT129C: 129.13779,
  TMT130N: 130.134825, TMT130C: 130.141145,
  TMT131: 131.13818, TMT131N: 131.13818, TMT131C: 131.1445,
  TMTPRO126: 126.127726,
  TMTPRO127N: 127.124761, TMTPRO127C: 127.131081,
  TMTPRO128N: 128.128116, TMTPRO128C: 128.134436,
  TMTPRO129N: 129.131471, TMTPRO129C: 129.13779,
  TMTPRO130N: 130.134825, TMTPRO130C: 130.141145,
  TMTPRO131N: 131.13818, TMTPRO131C: 131.1445,
  TMTPRO132N: 132.141535, TMTPRO132C: 132.147855,
  TMTPRO133N: 133.14489, TMTPRO133C: 133.15121,
  TMTPRO134N: 134.148245, TMTPRO134C: 134.154565,
  TMTPRO135N: 135.1516,
  ITRAQ113: 113.10788, ITRAQ114: 114.11123, ITRAQ115: 115.10826,
  ITRAQ116: 116.11162, ITRAQ117: 117.11497, ITRAQ118: 118.11201,
  ITRAQ119: 119.1153, ITRAQ121: 121.122,
};

/** Canonicalize an SDRF `comment[label]` value for reagent-table lookup. */
export function canonicalLabel(label: string): string {
  return label.trim().toUpperCase().replace(/[\s_-]+/g, "");
}

/** Resolve an SDRF `comment[label]` value to its reporter ion m/z (null = not isobaric). */
export function reporterMzFor(label: string | null): number | null {
  if (!label) return null;
  const v = REPORTER_MZ[canonicalLabel(label)];
  return typeof v === "number" ? v : null;
}

/** Decode mzML XML-id escapes (`_x0032_` → "2") — run ids starting with a digit are escaped. */
export function decodeXmlId(s: string): string {
  return s.replace(/_x([0-9a-fA-F]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Canonical run key for matching SDRF `comment[data file]` values against the index
 * `metadata.run.id`: basename, XML-id decoded, common MS extensions stripped, lowercased.
 */
export function sdrfRunKey(s: string): string {
  const base = s.split(/[\\/]/).pop() ?? s;
  return decodeXmlId(base)
    .replace(/\.(raw|d|wiff2?|mzml|mzxml|mzpeak)(\.gz)?$/i, "")
    .toLowerCase();
}
