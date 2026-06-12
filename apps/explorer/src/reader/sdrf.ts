// SDRF-Proteomics reader. Pure function: parse a tab-delimited SDRF document into
// the format-agnostic StudyMetadata. No CSV quoting (SDRF cells contain ; and =).
// See docs/sdrf-sample-metadata-display-SPEC.md §5.
import type {
  Cell, ChannelRole, Investigation, StudyMetadata, StudyProvenance, StudyRow,
} from "./types";
import { classifyLabel } from "./reagents";
import { reporterMzFor } from "./reagents";
import { parseCell, matchesFile, finalizeStudy } from "./studyCommon";

type ColType = "source" | "assay" | "tech" | "char" | "comment" | "factor" | "other";
type Column = { type: ColType; key: string };

const HEADER = /^(characteristics|comment|factor value)\[(.+)\]$/;

function classifyColumn(header: string): Column {
  const h = header.trim();
  if (h === "source name") return { type: "source", key: "source name" };
  if (h === "assay name") return { type: "assay", key: "assay name" };
  if (h === "technology type") return { type: "tech", key: "technology type" };
  const m = HEADER.exec(h);
  if (m) {
    const kind = m[1];
    const key = m[2].trim();
    if (kind === "characteristics") return { type: "char", key };
    if (kind === "comment") return { type: "comment", key };
    return { type: "factor", key };
  }
  return { type: "other", key: h };
}

/** Parse an SDRF-Proteomics TSV into {@link StudyMetadata}. Never throws. */
export function parseSdrf(
  text: string,
  thisFileName: string | null,
  provenance: StudyProvenance,
): StudyMetadata {
  const diagnostics: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const emptyInvestigation: Investigation = {
    accession: provenance.sourceUri ? null : null,
    title: null, description: null, contacts: [], publications: [], protocols: [],
  };
  if (lines.length < 2) {
    diagnostics.push("SDRF has no data rows.");
    return finalizeStudy("sdrf", emptyInvestigation, [], provenance, diagnostics);
  }

  const cols = lines[0].split("\t").map(classifyColumn);
  const rows: StudyRow[] = [];

  for (let li = 1; li < lines.length; li++) {
    const cells = lines[li].split("\t");
    // Per-row collectors. Repeated comment[...] (e.g. modification parameters) → lists.
    const characteristics: Record<string, Cell> = {};
    const factors: Record<string, Cell> = {};
    const comments: Record<string, Cell[]> = {};
    let sourceName = "";
    let assayName: string | null = null;

    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci];
      const raw = cells[ci] ?? "";
      switch (col.type) {
        case "source": sourceName = raw.trim(); break;
        case "assay": assayName = raw.trim() || null; break;
        case "char": characteristics[col.key] = parseCell(raw); break;
        case "factor": factors[col.key] = parseCell(raw); break;
        case "comment": (comments[col.key] ??= []).push(parseCell(raw)); break;
        default: break;
      }
    }

    const comment = (k: string): Cell | undefined => comments[k]?.[0];
    const commentText = (k: string): string | null => comment(k)?.value ?? comment(k)?.raw ?? null;

    const label = commentText("label");
    const { kind: labelKind } = classifyLabel(label);
    const dataFile = commentText("data file");

    // Labeling tag: the modification-parameters entry that is a labeling reagent.
    let tag: Cell["cv"] = null;
    for (const c of comments["modification parameters"] ?? []) {
      if (c.value && /^(tmt|itraq)/i.test(c.value)) { tag = c.cv; break; }
    }

    // Pool members: characteristics[pooled sample] = SN=a;SN=b
    const pooledCell = characteristics["pooled sample"];
    const poolMembers: string[] = [];
    if (pooledCell?.raw && /SN=/i.test(pooledCell.raw)) {
      for (const tok of pooledCell.raw.split(";")) {
        const m = /^\s*SN\s*=\s*(.+?)\s*$/i.exec(tok);
        if (m) poolMembers.push(m[1]);
      }
    }
    const isPooled =
      poolMembers.length > 0 ||
      pooledCell?.reserved === "pooled" ||
      Object.values(characteristics).some((c) => c.reserved === "pooled");

    // Role: carrier/reference dedicated columns (value = a channel label) win.
    let role: ChannelRole = "unknown";
    const carrier = commentText("carrier channel");
    const reference = commentText("reference channel");
    if (label && carrier && carrier === label) role = "carrier";
    else if (label && reference && reference === label) role = "reference";
    else if (isPooled) role = "reference";
    else if (labelKind === "isobaric") role = "experimental";

    rows.push({
      sourceName,
      assayName,
      dataFile,
      label,
      labelKind,
      reporterMz: labelKind === "isobaric" ? reporterMzFor(label) : null,
      role,
      poolMembers,
      tag,
      fraction: commentText("fraction identifier"),
      characteristics,
      factors,
      matchesThisFile: matchesFile(dataFile, thisFileName),
    });
  }

  const anyMatch = rows.some((r) => r.matchesThisFile);
  if (!anyMatch && thisFileName) {
    diagnostics.push(
      `No SDRF row's data file matches "${thisFileName}"; showing all rows in the document.`,
    );
  }

  const accession = provenance.sourceUri?.match(/\b(PXD\d{6,})\b/)?.[1] ?? null;
  const investigation: Investigation = { ...emptyInvestigation, accession };
  return finalizeStudy("sdrf", investigation, rows, provenance, diagnostics);
}
