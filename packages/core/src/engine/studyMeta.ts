// Engine: resolve isobaric (TMT/iTRAQ) channel assignments for the open run from the
// mzpeak index `metadata` block. Projects sample_list ⋈ run_sample_binding, joined on
// the MS:1002602 "sample label" parameter, plus the reagents reporter-ion table.
// When the projection is empty but the archive embeds an SDRF TSV
// (metadata.sample_metadata.member — `mzpeak-convert --sdrf` ≤0.7.7 embeds without
// projecting), the channels are derived from the TSV's comment[label] column instead
// (sdrfChannelsFallback below). Label-free files return no channels either way.
import type { Reader } from "../reader/openUrl";
import { plainify } from "../reader/fileMeta";
import { engineArchiveMemberBytes } from "./structure";
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

  // Surface the structured `study` block + the per-sample list (plainified) for the
  // Summary ▸ Study panel, plus the archive member path of the embedded SDRF file
  // (referenced by `metadata.sample_metadata.member`) so the full characteristics table
  // can be fetched on demand in the Study panel.
  const sampleMetadata = obj(meta.sample_metadata);
  const sdrfMember = str(sampleMetadata?.member);

  // SDRF fallback: current converters (`mzpeak-convert --sdrf` ≤0.7.7) embed the SDRF TSV
  // and back-references but do NOT project its rows into sample_list — so isobaric runs
  // would show no channels. When the projection is empty but an SDRF member is embedded,
  // derive the channels from the TSV itself: rows whose comment[data file] names this run
  // (metadata.run.id, XML-id escapes decoded), their comment[label] resolved through the
  // reagent table. The projection path stays authoritative when present.
  let effectiveChannels = channels;
  if (channels.length === 0 && sdrfMember) {
    effectiveChannels = await sdrfChannelsFallback(reader, sdrfMember, str(obj(meta.run)?.id));
  }

  return {
    present: effectiveChannels.length > 0,
    channels: effectiveChannels,
    sdrf: null,
    isa: null,
    study: meta.study != null ? (plainify(study) as unknown) : null,
    samples: sampleList.length ? (plainify(sampleList) as unknown[]) : undefined,
    sdrfMember,
  };
}

// ── SDRF-member channel fallback ──────────────────────────────────────────────

/** Cap for reading the embedded SDRF (they are small TSVs; PXD011799's is ~400 KB). */
const SDRF_FALLBACK_MAX_BYTES = 8 * 1024 * 1024;

/** Decode mzML XML-id escapes (`_x0032_` → "2") — run ids starting with a digit are escaped. */
function decodeXmlId(s: string): string {
  return s.replace(/_x([0-9a-fA-F]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Canonical run key: basename, XML-id decoded, common MS extensions stripped, lowercased. */
function runKey(s: string): string {
  const base = s.split(/[\\/]/).pop() ?? s;
  return decodeXmlId(base)
    .replace(/\.(raw|d|wiff2?|mzml|mzxml|mzpeak)(\.gz)?$/i, "")
    .toLowerCase();
}

/** Decode member bytes to text, transparently gunzipping (`.sdrf.tsv.gz` members). */
async function memberText(buf: ArrayBuffer): Promise<string> {
  const u8 = new Uint8Array(buf);
  if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b && typeof DecompressionStream !== "undefined") {
    const ds = new DecompressionStream("gzip");
    return await new Response(new Blob([u8]).stream().pipeThrough(ds)).text();
  }
  return new TextDecoder().decode(u8);
}

/**
 * Derive per-run isobaric channels from the embedded SDRF TSV: rows whose
 * `comment[data file]` matches `runId` (all rows when the run id is unknown or nothing
 * matches — fractions of a plex share one label set), `comment[label]` values resolved
 * through the reagent table (label-free/SILAC rows resolve to null and are skipped).
 * Deduplicated by label, sorted by reporter m/z. Never throws — a malformed/absent
 * member degrades to no channels, exactly the pre-fallback behaviour.
 */
async function sdrfChannelsFallback(
  reader: Reader,
  member: string,
  runId: string | null,
): Promise<ChannelAssignment[]> {
  try {
    const { bytes, truncated } = await engineArchiveMemberBytes(reader, member, SDRF_FALLBACK_MAX_BYTES);
    if (truncated) return [];
    const text = await memberText(bytes);
    const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0);
    if (lines.length < 2) return [];
    const cols = lines[0]!.split("\t").map((c) => c.trim().toLowerCase());
    const li = cols.indexOf("comment[label]");
    const di = cols.indexOf("comment[data file]");
    const si = cols.indexOf("source name");
    if (li < 0) return []; // no label column → nothing isobaric to project
    const want = runId ? runKey(runId) : null;

    const collect = (matchRun: boolean): ChannelAssignment[] => {
      const out: ChannelAssignment[] = [];
      const seen = new Set<string>();
      for (const line of lines.slice(1)) {
        const f = line.split("\t");
        if (matchRun && want != null && di >= 0 && runKey(f[di] ?? "") !== want) continue;
        const label = (f[li] ?? "").trim();
        const mz = reporterMzFor(label);
        if (mz == null) continue; // not an isobaric label (label-free, SILAC, blank)
        const key = label.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          channelLabel: label,
          reporterMz: mz,
          role: null,
          sampleId: null,
          sampleName: si >= 0 ? str(f[si]) : null,
          boundToThisRun: true,
        });
      }
      out.sort((a, b) => (a.reporterMz ?? 0) - (b.reporterMz ?? 0));
      return out;
    };

    // Prefer the rows that name this run; fall back to the study-wide distinct label set
    // (a fraction's data-file spelling may not match the run id exactly).
    const matched = collect(true);
    return matched.length > 0 ? matched : collect(false);
  } catch {
    return [];
  }
}
