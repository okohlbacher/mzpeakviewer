// ISA-Tab / ISA-JSON reader (MetaboLights world). Projects the investigation +
// study/assay tables into the format-agnostic StudyMetadata. ISA carries CV
// out-of-band (a value column followed by Term Source REF / Term Accession
// Number), unlike SDRF's inline NT=/AC=. See spec §6.
import type {
  Cell, Investigation, StudyMetadata, StudyProvenance, StudyRow,
} from "./types";
import { parseCurie } from "./curie";
import { parseCell, matchesFile, finalizeStudy } from "./studyCommon";

export type IsaTabBundle = {
  investigation: string;
  studies: string[];
  assays: string[];
};

// ---- i_Investigation.txt (section-keyed tab blocks) ----

/** Flatten the investigation file into a key → values map (keys are unique
 *  enough across sections that we don't need to track section nesting for the
 *  fields we surface). First study wins. */
function investigationMap(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || !line.includes("\t")) continue; // section headers have no tab
    const parts = line.split("\t");
    const key = parts[0].trim();
    const vals = parts.slice(1).map((v) => v.trim().replace(/^"|"$/g, "")).filter(Boolean);
    if (key && !map.has(key)) map.set(key, vals);
  }
  return map;
}

function parseInvestigation(text: string): { investigation: Investigation; factorNames: string[] } {
  const m = investigationMap(text);
  const first = (k: string) => m.get(k)?.[0] ?? null;
  const contacts: string[] = [];
  const last = m.get("Study Person Last Name") ?? [];
  const firstN = m.get("Study Person First Name") ?? [];
  for (let i = 0; i < Math.max(last.length, firstN.length); i++) {
    const name = [firstN[i], last[i]].filter(Boolean).join(" ").trim();
    if (name) contacts.push(name);
  }
  const investigation: Investigation = {
    accession: first("Study Identifier"),
    title: first("Study Title") ?? first("Investigation Title"),
    description: first("Study Description") ?? first("Investigation Description"),
    contacts,
    publications: m.get("Study Publication Title") ?? m.get("Investigation Publication Title") ?? [],
    protocols: m.get("Study Protocol Name") ?? [],
  };
  return { investigation, factorNames: m.get("Study Factor Name") ?? [] };
}

// ---- s_*.txt / a_*.txt tables (CV out-of-band) ----

type IsaCol = { kind: "source" | "sample" | "char" | "factor" | "datafile" | "termref" | "termacc" | "other"; key: string };
const BRACKET = /^(Characteristics|Factor Value|Parameter Value|Comment)\[(.+)\]$/;

function classifyIsaColumn(h: string): IsaCol {
  const t = h.trim();
  if (t === "Source Name") return { kind: "source", key: t };
  if (t === "Sample Name") return { kind: "sample", key: t };
  if (t === "Term Source REF") return { kind: "termref", key: t };
  if (t === "Term Accession Number") return { kind: "termacc", key: t };
  if (/^(Raw Spectral Data File|Derived Spectral Data File|Raw Data File|Derived Data File|Acquisition Parameter Data File)$/.test(t))
    return { kind: "datafile", key: t };
  const b = BRACKET.exec(t);
  if (b) {
    if (b[1] === "Characteristics") return { kind: "char", key: b[2].trim() };
    if (b[1] === "Factor Value") return { kind: "factor", key: b[2].trim() };
  }
  return { kind: "other", key: t };
}

type IsaRow = {
  sourceName: string | null;
  sampleName: string | null;
  dataFile: string | null;
  characteristics: Record<string, Cell>;
  factors: Record<string, Cell>;
};

/** Parse an ISA s_/a_ table; attaches out-of-band CV (Term Source REF + Term
 *  Accession Number columns that immediately follow a value column). */
function parseIsaTable(text: string): IsaRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const cols = lines[0].split("\t").map((h) => classifyIsaColumn(h.replace(/^"|"$/g, "")));
  const out: IsaRow[] = [];

  for (let li = 1; li < lines.length; li++) {
    const cells = lines[li].split("\t").map((c) => c.replace(/^"|"$/g, ""));
    const row: IsaRow = {
      sourceName: null, sampleName: null, dataFile: null, characteristics: {}, factors: {},
    };
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci];
      const raw = (cells[ci] ?? "").trim();
      switch (col.kind) {
        case "source": row.sourceName = raw || null; break;
        case "sample": row.sampleName = raw || null; break;
        case "datafile": if (raw) row.dataFile = raw; break;
        case "char":
        case "factor": {
          const cell = parseCell(raw);
          // Out-of-band CV: next cols may be Term Source REF + Term Accession Number.
          const refCol = cols[ci + 1];
          const accCol = cols[ci + 2];
          if (accCol?.kind === "termacc") {
            const acc = (cells[ci + 2] ?? "").trim();
            const ref = refCol?.kind === "termref" ? (cells[ci + 1] ?? "").trim() : "";
            const cv = parseCurie(acc || (ref && raw ? `${ref}:${raw}` : null), raw || null);
            if (cv) cell.cv = cv;
          }
          (col.kind === "char" ? row.characteristics : row.factors)[col.key] = cell;
          break;
        }
        default: break;
      }
    }
    out.push(row);
  }
  return out;
}

/** Project an ISA-Tab bundle into {@link StudyMetadata}. Never throws. */
export function parseIsaTab(
  bundle: IsaTabBundle,
  thisFileName: string | null,
  provenance: StudyProvenance,
): StudyMetadata {
  const diagnostics: string[] = [];
  const { investigation, factorNames } = parseInvestigation(bundle.investigation || "");

  // Study file(s): sample characteristics AND factor values, keyed by Sample Name.
  // ISA permits factor values at study scope (the s_ file), so capture them here.
  const studyByName = new Map<string, IsaRow>();
  for (const s of bundle.studies) {
    for (const r of parseIsaTable(s)) {
      const key = r.sampleName ?? r.sourceName ?? "";
      if (key) studyByName.set(key, r);
    }
  }

  const rows: StudyRow[] = [];
  const assayRows = bundle.assays.flatMap((a) => parseIsaTable(a));
  const source = assayRows.length ? assayRows : [...studyByName.values()];

  for (const r of source) {
    const sample = (r.sampleName && studyByName.get(r.sampleName)) || null;
    const characteristics = { ...(sample?.characteristics ?? {}), ...r.characteristics };
    const factors = { ...(sample?.factors ?? {}), ...r.factors };
    rows.push({
      sourceName: sample?.sourceName ?? r.sourceName ?? r.sampleName ?? "",
      assayName: r.sampleName ?? null,
      dataFile: r.dataFile,
      label: null,
      labelKind: "label-free", // ISA metabolomics is overwhelmingly label-free
      reporterMz: null,
      role: "unknown",
      poolMembers: [],
      tag: null,
      fraction: null,
      characteristics,
      factors,
      matchesThisFile: matchesFile(r.dataFile, thisFileName),
    });
  }

  if (factorNames.length && !rows.some((r) => Object.keys(r.factors).length)) {
    diagnostics.push(`Study factors declared (${factorNames.join(", ")}) but no per-row factor values found.`);
  }

  return finalizeStudy("isa-tab", investigation, rows, provenance, diagnostics);
}

// ---- ISA-JSON (minimal projection) ----

/** Project ISA-JSON into {@link StudyMetadata}. Minimal/defensive (no fixture yet). */
export function parseIsaJson(
  json: unknown,
  thisFileName: string | null,
  provenance: StudyProvenance,
): StudyMetadata {
  const diagnostics: string[] = [];
  const inv = (json as { investigation?: Record<string, unknown> })?.investigation
    ?? (json as Record<string, unknown>);
  const study = (Array.isArray((inv as { studies?: unknown[] })?.studies)
    ? (inv as { studies: Record<string, unknown>[] }).studies[0]
    : undefined) ?? {};
  const investigation: Investigation = {
    accession: String((study as { identifier?: unknown }).identifier ?? (inv as { identifier?: unknown })?.identifier ?? "") || null,
    title: String((study as { title?: unknown }).title ?? (inv as { title?: unknown })?.title ?? "") || null,
    description: String((study as { description?: unknown }).description ?? "") || null,
    contacts: [], publications: [], protocols: [],
  };
  diagnostics.push("ISA-JSON parsed with the minimal projection (investigation only).");
  void thisFileName;
  return finalizeStudy("isa-json", investigation, [], provenance, diagnostics);
}
