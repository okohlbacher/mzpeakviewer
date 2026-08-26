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
import { reporterMzFor, sdrfRunKey } from "../adapt/sdrf";

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
  const runId = str(obj(meta.run)?.id);
  let effectiveChannels = channels;
  let channelsSource: StudyMeta["channelsSource"] = channels.length > 0 ? "projected" : "none";
  // The projection is authoritative only when it yielded at least one channel WITH a
  // reporter m/z — label params whose labels resolve to no reporter (non-isobaric or
  // unknown reagent names) must not suppress an SDRF fallback that can do better.
  const projectedUsable = channels.some((c) => c.reporterMz != null);
  if (!projectedUsable && sdrfMember) {
    const fb = await sdrfChannelsFallback(reader, sdrfMember, runId);
    if (fb.channels.length > 0) {
      effectiveChannels = fb.channels;
      channelsSource = fb.matchedRun ? "sdrf-run" : "sdrf-study";
    }
  }

  return {
    present: effectiveChannels.length > 0,
    channels: effectiveChannels,
    sdrf: null,
    isa: null,
    study: meta.study != null ? (plainify(study) as unknown) : null,
    samples: sampleList.length ? (plainify(sampleList) as unknown[]) : undefined,
    sdrfMember,
    sdrfMeta: sampleMetadata
      ? {
          datasetAccession: str(sampleMetadata.dataset_accession),
          sha256: str(sampleMetadata.sha256),
          embedScope: str(sampleMetadata.embed_scope),
          precedence: str(sampleMetadata.precedence),
        }
      : null,
    channelsSource,
    runId,
  };
}

// ── SDRF-member channel fallback ──────────────────────────────────────────────

/** Cap for reading the embedded SDRF (they are small TSVs; PXD011799's is ~400 KB). */
const SDRF_FALLBACK_MAX_BYTES = 8 * 1024 * 1024;

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
): Promise<{ channels: ChannelAssignment[]; matchedRun: boolean }> {
  const NONE = { channels: [], matchedRun: false };
  try {
    const { bytes, truncated } = await engineArchiveMemberBytes(reader, member, SDRF_FALLBACK_MAX_BYTES);
    if (truncated) return NONE;
    const text = await memberText(bytes);
    const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0);
    if (lines.length < 2) return NONE;
    const cols = lines[0]!.split("\t").map((c) => c.trim().toLowerCase());
    const li = cols.indexOf("comment[label]");
    const di = cols.indexOf("comment[data file]");
    const si = cols.indexOf("source name");
    if (li < 0) return NONE; // no label column → nothing isobaric to project
    const want = runId ? sdrfRunKey(runId) : null;

    const collect = (matchRun: boolean): ChannelAssignment[] => {
      const out: ChannelAssignment[] = [];
      const seen = new Set<string>();
      for (const line of lines.slice(1)) {
        const f = line.split("\t");
        if (matchRun && want != null && di >= 0 && sdrfRunKey(f[di] ?? "") !== want) continue;
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
    // (a fraction's data-file spelling may not match the run id exactly). The caller is
    // told which case happened so the UI can label a study-wide set honestly. With no
    // run id or no data-file column the "matched" pass filters nothing — that is the
    // study-wide set and must NOT be reported as run-matched.
    const canMatchRun = want != null && di >= 0;
    const matched = canMatchRun ? collect(true) : [];
    if (matched.length > 0) return { channels: matched, matchedRun: true };
    return { channels: collect(false), matchedRun: false };
  } catch {
    return NONE;
  }
}
