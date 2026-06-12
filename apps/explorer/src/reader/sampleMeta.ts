// Orchestrator for embedded study sample-metadata (SDRF / ISA): locate the blob
// member, read + hash-verify it, detect the format, dispatch to the parser, and
// reconcile with the index.json projected keys. Mirrors readImaging's defensive
// posture; returns null when the file carries no study metadata (presence gate).
import type { Reader } from "./open";
import type {
  ChannelAssignment, HashState, StudyLabeling, StudyMetadata, StudyProvenance,
} from "./types";
import { readArchiveMember } from "./archive";
import { parseSdrf } from "./sdrf";
import { parseIsaTab, parseIsaJson, type IsaTabBundle } from "./isa";
import { classifyLabel, nominalPlex } from "./reagents";
import { parseCurie } from "./curie";

function numOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function hasText(v: unknown, sub: string): boolean {
  return String(v ?? "").toLowerCase().includes(sub);
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

type Format = "sdrf" | "isa-tab" | "isa-json";

function detectFormat(member: string | null, hint: string | null): Format | null {
  const h = (hint ?? "").toLowerCase();
  if (h.includes("isa-json") || h === "isa_json") return "isa-json";
  if (h.includes("isa")) return "isa-tab";
  if (h.includes("sdrf")) return "sdrf";
  const m = (member ?? "").toLowerCase();
  if (m.endsWith(".json") || m.includes("isa.json")) return "isa-json";
  if (m.includes("/isa/") || /(^|\/)i_.*\.txt$/.test(m)) return "isa-tab";
  if (m.includes("sdrf") || m.endsWith(".tsv")) return "sdrf";
  return null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    // Copy into a fresh ArrayBuffer-backed view (satisfies BufferSource typing).
    const buf = new Uint8Array(bytes);
    const d = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function memberNames(reader: Reader): string[] {
  const files = (reader as unknown as { store?: { fileIndex?: { files?: { name?: unknown }[] } } })
    .store?.fileIndex?.files ?? [];
  return files.map((f) => String(f?.name ?? "")).filter(Boolean);
}

/** Read + project the embedded study metadata, or null when none is present. */
export async function readStudyMetadata(
  reader: Reader,
  fileName: string | null,
): Promise<StudyMetadata | null> {
  const meta = obj((reader as unknown as { store?: { fileIndex?: { metadata?: unknown } } })
    .store?.fileIndex?.metadata);
  const prov = obj(meta?.sample_metadata);
  const study = obj(meta?.study);
  const sampleList: unknown[] = Array.isArray(meta?.sample_list) ? (meta!.sample_list as unknown[]) : [];
  const names = memberNames(reader);

  // Locate the blob member (the lossless anchor, for hash verify + raw view):
  // archive_name (v0.8 §3.9), then study.sample_metadata_ref, then legacy spellings,
  // then a name scan.
  const explicit =
    str(prov?.archive_name) ?? str(study?.sample_metadata_ref) ??
    str(prov?.member) ?? str(prov?.archive_path) ?? str(prov?.path);
  const scanned = names.find((n) => n.toLowerCase().includes("sample_metadata/")) ?? null;
  const member = explicit ?? scanned;

  // Projection = the ENCODED sample_list (labeled channels) + run_sample_binding.
  // This is the authoritative, run-scoped source we drive the summary from (the
  // blob is only re-served verbatim, never re-parsed for the summary). A thin
  // study block (accession/title only) is NOT a projection — fall to the blob,
  // which yields channels + biology + factors.
  const hasProjection = sampleList.length > 0 || obj(study?.run_sample_binding) != null;

  // Presence gate: a projection, a blob member, a sample_metadata block, or study.
  if (!hasProjection && !member && !prov && !study) return null;

  const diagnostics: string[] = [];
  if (!explicit && scanned) {
    diagnostics.push(`Blob member located by name scan ("${scanned}"); no explicit member field.`);
  }

  const formatHint = str(prov?.format) ?? str(study?.format);
  const format = detectFormat(member, formatHint) ?? "sdrf";
  const sha = str(prov?.sha256);
  const provenance: StudyProvenance = {
    format,
    sourceUri: str(prov?.source_uri) ?? str(prov?.sdrf_uri) ?? str(prov?.uri),
    embedScope: str(prov?.embed_scope),
    retrievedAt: str(prov?.retrieved_at),
    sha256: sha,
    hashState: "none",
    member,
  };

  // ── Projection-first ───────────────────────────────────────────────────────
  if (hasProjection) {
    // Verify the embedded blob's hash (best-effort; the member is small).
    if (member && sha) {
      try {
        const blob = await readArchiveMember(reader, member);
        provenance.hashState = await verify(blob?.bytes ?? null, sha);
      } catch { /* leave "none" */ }
    }
    return buildProjection(study, sampleList, format, provenance, diagnostics);
  }

  // ── Blob fallback (verbatim-only files: parse + file-match filter) ──────────
  if (!member) {
    diagnostics.push("Study metadata block present but no readable blob member was found.");
    return keysOnly(study, prov, member, diagnostics);
  }

  try {
    if (format === "isa-tab") {
      const bundle = await readIsaBundle(reader, member, names);
      provenance.hashState = await verify(bundle.hashBytes, sha);
      const sm = parseIsaTab(bundle.tab, fileName, provenance);
      return reconcile(sm, study, prov, diagnostics);
    }
    const blob = await readArchiveMember(reader, member);
    if (!blob) {
      diagnostics.push(`Blob member "${member}" could not be read.`);
      return keysOnly(study, prov, member, diagnostics);
    }
    provenance.hashState = await verify(blob.bytes, sha);
    const sm =
      format === "isa-json"
        ? parseIsaJson(safeJson(blob.text), fileName, provenance)
        : parseSdrf(blob.text, fileName, provenance);
    return reconcile(sm, study, prov, diagnostics);
  } catch (err) {
    diagnostics.push(`Failed to read study metadata: ${err instanceof Error ? err.message : String(err)}`);
    return keysOnly(study, prov, member, diagnostics);
  }
}

/** Build the run-scoped study summary from the ENCODED projection: join
 *  sample_list (the labeled channels) on run_sample_binding (this run's samples). */
function buildProjection(
  study: Record<string, unknown> | null,
  sampleList: unknown[],
  format: StudyMetadata["format"],
  provenance: StudyProvenance,
  diagnostics: string[],
): StudyMetadata {
  const rsb = obj(study?.run_sample_binding);
  const boundIds = new Set(
    (Array.isArray(rsb?.sample_ids) ? (rsb!.sample_ids as unknown[]) : []).map((x) => String(x)),
  );
  const runId = str(rsb?.run_id);
  const hasBinding = boundIds.size > 0;

  const channels: ChannelAssignment[] = [];
  for (const raw of sampleList) {
    const e = obj(raw);
    if (!e) continue;
    const params = Array.isArray(e.parameters) ? (e.parameters as unknown[]) : [];
    const find = (pred: (p: Record<string, unknown>) => boolean) => {
      for (const p of params) {
        const po = obj(p);
        if (po && pred(po)) return po;
      }
      return null;
    };
    // Only labeled (isobaric) sample_list entries are channels (carry MS:1002602).
    const labelP = find((p) => String(p.accession).toUpperCase() === "MS:1002602");
    if (!labelP) continue;
    const mzP = find((p) => hasText(p.accession, "reporter") || hasText(p.name, "reporter"));
    const roleP = find((p) => hasText(p.accession, "role") || hasText(p.name, "role"));
    const tagP = find((p) => String(p.accession).toUpperCase().startsWith("UNIMOD:"));
    const id = str(e.id);
    channels.push({
      channelLabel: str(labelP.value) ?? str(labelP.name),
      reporterMz: numOf(mzP?.value),
      role: str(roleP?.value),
      tag: tagP ? parseCurie(str(tagP.accession), str(tagP.value) ?? str(tagP.name)) : null,
      sampleId: id,
      sampleName: str(e.name),
      boundToThisRun: hasBinding ? id != null && boundIds.has(id) : true,
    });
  }

  if (!hasBinding && channels.length > 0) {
    diagnostics.push("No run_sample_binding in the index; showing all study channels (study-wide).");
  }

  const bound = channels.filter((c) => c.boundToThisRun);
  const firstLabel = bound[0]?.channelLabel ?? channels[0]?.channelLabel ?? null;
  const { kind, reagent } = classifyLabel(firstLabel);
  const labeling: StudyLabeling = { kind, reagent, plex: nominalPlex(reagent, bound.length) };

  return {
    format,
    source: "projection",
    investigation: {
      accession: str(study?.accession) ?? str(study?.dataset_accession),
      title: str(study?.title),
      description: null, contacts: [], publications: [], protocols: [],
    },
    channels,
    runId,
    rows: [],
    factors: [],
    labeling,
    counts: {
      sourceSamples: sampleList.length,
      channels: bound.length,
      dataFiles: 1,
      rows: channels.length,
    },
    biology: { organisms: [], tissues: [], diseases: [], cellTypes: [] },
    provenance,
    diagnostics,
  };
}

async function verify(bytes: Uint8Array | null, declared: string | null): Promise<HashState> {
  if (!declared) return "none";
  if (!bytes) return "declared";
  const actual = await sha256Hex(bytes);
  if (!actual) return "declared";
  return actual.toLowerCase() === declared.toLowerCase() ? "verified" : "mismatch";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Read all ISA-Tab members (i_/s_/a_) under the blob's directory. */
async function readIsaBundle(
  reader: Reader,
  member: string,
  names: string[],
): Promise<{ tab: IsaTabBundle; hashBytes: Uint8Array | null }> {
  const dir = member.includes("/") ? member.slice(0, member.lastIndexOf("/") + 1) : "";
  const inDir = names.filter((n) => n.startsWith(dir) || n.includes("/isa/"));
  const pick = async (pred: (b: string) => boolean): Promise<string[]> => {
    const out: string[] = [];
    for (const n of inDir) {
      const base = n.split("/").pop() ?? n;
      if (pred(base.toLowerCase())) {
        const m = await readArchiveMember(reader, n);
        if (m) out.push(m.text);
      }
    }
    return out;
  };
  const investigation = (await pick((b) => b.startsWith("i_")))[0] ?? "";
  const studies = await pick((b) => b.startsWith("s_"));
  const assays = await pick((b) => b.startsWith("a_"));
  // Hash the investigation member as the provenance anchor (best-effort).
  const inv = await readArchiveMember(reader, member);
  return { tab: { investigation, studies, assays }, hashBytes: inv?.bytes ?? null };
}

/** Fill blank investigation accession/title from the projected index keys. */
function reconcile(
  sm: StudyMetadata,
  study: Record<string, unknown> | null,
  prov: Record<string, unknown> | null,
  extraDiagnostics: string[],
): StudyMetadata {
  // v0.8 uses `accession` in metadata.study and `dataset_accession` in
  // metadata.sample_metadata (an inter-block inconsistency); accept both.
  const accession =
    str(study?.accession) ?? str(study?.dataset_accession) ?? str(prov?.dataset_accession);
  const title = str(study?.title);
  if ((study?.dataset_accession || prov?.dataset_accession) && !study?.accession) {
    extraDiagnostics.push('Index uses "dataset_accession"; prefer metadata.study.accession.');
  }
  return {
    ...sm,
    investigation: {
      ...sm.investigation,
      accession: sm.investigation.accession ?? accession,
      title: sm.investigation.title ?? title,
    },
    diagnostics: [...sm.diagnostics, ...extraDiagnostics],
  };
}

/** Last-resort banner from projected keys only (no readable blob). */
function keysOnly(
  study: Record<string, unknown> | null,
  prov: Record<string, unknown> | null,
  member: string | null,
  diagnostics: string[],
): StudyMetadata | null {
  const accession = str(study?.accession) ?? str(study?.dataset_accession);
  const title = str(study?.title);
  if (!accession && !title && !prov) return null;
  const fmt = (str(prov?.format) as StudyMetadata["format"]) ?? "sdrf";
  return {
    format: fmt,
    source: "projection",
    investigation: { accession, title, description: null, contacts: [], publications: [], protocols: [] },
    channels: [],
    runId: null,
    rows: [],
    factors: [],
    labeling: { kind: "label-free", reagent: null, plex: null },
    counts: { sourceSamples: 0, channels: 0, dataFiles: 0, rows: 0 },
    biology: { organisms: [], tissues: [], diseases: [], cellTypes: [] },
    provenance: {
      format: fmt,
      sourceUri: str(prov?.source_uri) ?? str(prov?.sdrf_uri),
      embedScope: str(prov?.embed_scope),
      retrievedAt: str(prov?.retrieved_at),
      sha256: str(prov?.sha256),
      hashState: "none",
      member,
    },
    diagnostics: [...diagnostics, "Showing projected index keys only (blob not parsed)."],
  };
}
