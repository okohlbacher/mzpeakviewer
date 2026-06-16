// Engine: resolve isobaric (TMT/iTRAQ) channel assignments for the open run from the
// mzpeak index `metadata` block. Harvested from mzPeakExplorer's sampleMeta projection
// (sample_list ⋈ run_sample_binding, joined on the MS:1002602 "sample label" parameter)
// + reagents reporter-ion table. Projection path only (the producer-encoded channels);
// the SDRF/ISA-blob fallback is a later slice — label-free files just return no channels.
import type { Reader } from "../reader/openUrl";
import { plainify } from "../reader/fileMeta";
import type { StudyMeta, ChannelAssignment } from "@mzpeak/contracts";

// ── Reagent reporter-ion m/z table (shipped constants; the file supplies only the
//    label STRING, which we look up here). TMT 0/2/6/10/11 + TMTpro 16/18 + iTRAQ. ──
const REPORTER_MZ: Record<string, number> = {
  TMT126: 126.127726,
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
function reporterMzFor(label: string | null): number | null {
  if (!label) return null;
  const v = REPORTER_MZ[label.trim().toUpperCase().replace(/[\s_-]+/g, "")];
  return typeof v === "number" ? v : null;
}

// ── small coercion helpers ─────────────────────────────────────────────────────
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function numOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function hasText(v: unknown, needle: string): boolean {
  return typeof v === "string" && v.toLowerCase().includes(needle);
}

function readerMeta(reader: Reader): Record<string, unknown> {
  const store = (reader as unknown as { store?: { fileIndex?: { metadata?: unknown } } }).store;
  return obj(store?.fileIndex?.metadata) ?? {};
}

/**
 * Build the run-scoped channel list from the index `metadata`: each `sample_list`
 * entry carrying an MS:1002602 sample-label parameter is a channel; bound to the run
 * via `run_sample_binding.sample_ids` (study-wide if there is no binding). Reporter m/z
 * comes from the file when present, else the reagent table; otherwise null.
 */
export async function engineStudyMeta(reader: Reader): Promise<StudyMeta> {
  const meta = readerMeta(reader);
  const study = obj(meta.study) ?? meta;
  const sampleList = arr(meta.sample_list ?? study.sample_list);
  const rsb = obj(study.run_sample_binding ?? meta.run_sample_binding);
  const boundIds = new Set(arr(rsb?.sample_ids).map((x) => String(x)));
  const hasBinding = boundIds.size > 0;

  const channels: ChannelAssignment[] = [];
  for (const raw of sampleList) {
    const e = obj(raw);
    if (!e) continue;
    const params = arr(e.parameters);
    const find = (pred: (p: Record<string, unknown>) => boolean): Record<string, unknown> | null => {
      for (const p of params) {
        const po = obj(p);
        if (po && pred(po)) return po;
      }
      return null;
    };
    const labelP = find((p) => String(p.accession).toUpperCase() === "MS:1002602");
    if (!labelP) continue; // not an isobaric-labeled channel
    const mzP = find((p) => hasText(p.accession, "reporter") || hasText(p.name, "reporter"));
    const roleP = find((p) => hasText(p.accession, "role") || hasText(p.name, "role"));
    const label = str(labelP.value) ?? str(labelP.name);
    const id = str(e.id);
    channels.push({
      channelLabel: label,
      reporterMz: numOf(mzP?.value) ?? reporterMzFor(label),
      role: str(roleP?.value),
      sampleId: id,
      sampleName: str(e.name),
      boundToThisRun: hasBinding ? id != null && boundIds.has(id) : true,
    });
  }

  // MG-05: surface the structured `study` block + the per-sample list (plainified) for
  // the Summary ▸ Study panel. (The full SDRF characteristics matrix lives in a separate
  // embedded member referenced by sample_metadata — deferred.)
  return {
    present: channels.length > 0,
    channels,
    sdrf: null,
    isa: null,
    study: meta.study != null ? (plainify(study) as unknown) : null,
    samples: sampleList.length ? (plainify(sampleList) as unknown[]) : undefined,
  };
}
