// Static physical-constant reagent table for isobaric labels: reporter-ion m/z
// and label classification. Shipped data, NOT read from the (untrusted) blob —
// the blob only supplies the label STRING, which we look up here.
//
// Reporter-ion monoisotopic m/z (TMT/TMTpro per Thermo; iTRAQ per Sciex). Values
// are display-grade (the dashboard shows ~3 decimals).
import type { LabelKind } from "./types";

/** Normalize a label for lookup: upper-case, strip spaces/dashes. */
function norm(label: string): string {
  return label.trim().toUpperCase().replace(/[\s_-]+/g, "");
}

// TMT 0/2/6/10/11-plex reporter ions.
const TMT: Record<string, number> = {
  TMT126: 126.127726,
  TMT127N: 127.124761, TMT127C: 127.131081,
  TMT128N: 128.128116, TMT128C: 128.134436,
  TMT129N: 129.131471, TMT129C: 129.13779,
  TMT130N: 130.134825, TMT130C: 130.141145,
  TMT131: 131.13818, TMT131N: 131.13818, TMT131C: 131.1445,
};

// TMTpro 16/18-plex reporter ions (superset; includes the TMT126..131 channels).
const TMTPRO: Record<string, number> = {
  TMTPRO126: 126.127726,
  TMTPRO127N: 127.124761, TMTPRO127C: 127.131081,
  TMTPRO128N: 128.128116, TMTPRO128C: 128.134436,
  TMTPRO129N: 129.131471, TMTPRO129C: 129.13779,
  TMTPRO130N: 130.134825, TMTPRO130C: 130.141145,
  TMTPRO131N: 131.13818, TMTPRO131C: 131.1445,
  TMTPRO132N: 132.141535, TMTPRO132C: 132.147855,
  TMTPRO133N: 133.14489, TMTPRO133C: 133.15121,
  TMTPRO134N: 134.148245, TMTPRO134C: 134.154565,
  TMTPRO135N: 135.151600,
};

// iTRAQ 4-plex + 8-plex reporter ions.
const ITRAQ: Record<string, number> = {
  ITRAQ113: 113.10788, ITRAQ114: 114.11123, ITRAQ115: 115.10826,
  ITRAQ116: 116.11162, ITRAQ117: 117.11497, ITRAQ118: 118.11201,
  ITRAQ119: 119.11530, ITRAQ121: 121.12200,
};

const REPORTER_MZ: Record<string, number> = { ...TMT, ...TMTPRO, ...ITRAQ };

/** Reporter-ion m/z for an isobaric label, or null when not in the table
 *  (e.g. an unrecognized or partially-supported tag — NEVER a sentinel 0/NaN). */
export function reporterMzFor(label: string | null | undefined): number | null {
  if (!label) return null;
  const v = REPORTER_MZ[norm(label)];
  return typeof v === "number" ? v : null;
}

/** Nominal reagent plex when a reagent + observed channel count are known. */
export function nominalPlex(reagent: string | null, observed: number): number | null {
  if (reagent === "TMT") return [2, 6, 10, 11].includes(observed) ? observed : null;
  if (reagent === "TMTpro") return [16, 18].includes(observed) ? observed : null;
  if (reagent === "iTRAQ") return [4, 8].includes(observed) ? observed : null;
  return null;
}

/** Classify a `comment[label]` value by its lexical form (review §A-6: by VALUE,
 *  not mere presence). */
export function classifyLabel(label: string | null | undefined): {
  kind: LabelKind;
  reagent: string | null;
} {
  if (!label) return { kind: "label-free", reagent: null };
  const u = label.trim().toUpperCase();
  if (/^TMTPRO/.test(u)) return { kind: "isobaric", reagent: "TMTpro" };
  if (/^TMT\d/.test(u)) return { kind: "isobaric", reagent: "TMT" };
  if (/^ITRAQ/.test(u)) return { kind: "isobaric", reagent: "iTRAQ" };
  if (/^SILAC/.test(u)) return { kind: "silac", reagent: "SILAC" };
  if (u === "LABEL FREE SAMPLE" || u === "LABEL FREE" || u === "LABEL-FREE")
    return { kind: "label-free", reagent: null };
  return { kind: "other", reagent: null };
}
