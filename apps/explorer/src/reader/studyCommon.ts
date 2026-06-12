// Shared helpers for the SDRF and ISA readers: cell parsing, file matching, and
// the format-agnostic finalize step (counts, factors, labeling, biology).
import type {
  Cell, ChannelAssignment, Investigation, StudyFactor, StudyLabeling, StudyMetadata,
  StudyProvenance, StudyRow,
} from "./types";
import { parseCurie } from "./curie";
import { classifyLabel, nominalPlex } from "./reagents";

const RESERVED = ["not available", "not applicable", "anonymized", "pooled"] as const;
const KNOWN_EXTS = [
  // `.mzpeak` first: the OPEN file is a .mzpeak, the SDRF names the .raw/.mzML —
  // both must strip to the shared stem to match (e.g. "...fr8.mzpeak" ↔ "...fr8.raw").
  ".mzpeak", ".wiff.scan", ".wiff2", ".wiff", ".raw", ".d", ".mzml", ".imzml", ".mzxml", ".mgf", ".dia",
];

/** Parse one SDRF/ISA cell value into a typed {@link Cell}. */
export function parseCell(raw: string): Cell {
  const text = (raw ?? "").trim();
  const empty: Cell = { raw: text, value: null, cv: null, unit: null, reserved: null, extra: {} };
  if (!text) return empty;

  const reserved = RESERVED.find((r) => r === text.toLowerCase()) ?? null;
  if (reserved) return { ...empty, reserved };

  // key=value;... grammar (NT/AC/MT/TA/PP/unit/…)
  if (text.includes("=")) {
    const extra: Record<string, string> = {};
    let value: string | null = null;
    let cvRaw: string | null = null;
    let unitRaw: string | null = null;
    for (const tok of text.split(";")) {
      const eq = tok.indexOf("=");
      if (eq < 0) continue;
      const k = tok.slice(0, eq).trim();
      const v = tok.slice(eq + 1).trim();
      const ku = k.toUpperCase();
      if (ku === "NT") value = v;
      else if (ku === "AC") cvRaw = v;
      else if (ku === "UNIT") unitRaw = v;
      else extra[k] = v;
    }
    if (value === null && cvRaw === null && Object.keys(extra).length === 0) {
      return { ...empty, value: text };
    }
    return {
      raw: text,
      value,
      cv: parseCurie(cvRaw, value),
      unit: parseCurie(unitRaw),
      reserved: null,
      extra,
    };
  }

  return { ...empty, value: text };
}

/** Last path segment, stripped of a known MS data-file extension, lower-cased. */
export function fileKey(name: string | null | undefined): string | null {
  if (!name) return null;
  let base = String(name).split(/[\\/]/).pop() ?? "";
  base = base.trim().toLowerCase();
  for (const ext of KNOWN_EXTS) {
    if (base.endsWith(ext)) {
      base = base.slice(0, -ext.length);
      break;
    }
  }
  return base || null;
}

/** Does an SDRF/ISA data-file value refer to the open archive's file? */
export function matchesFile(dataFile: string | null, thisFileName: string | null): boolean {
  const a = fileKey(dataFile);
  const b = fileKey(thisFileName);
  return a != null && b != null && a === b;
}

const cellText = (c: Cell | undefined): string | null => (c ? c.value : null);

function distinct(values: (string | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (v == null || v === "") continue;
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Build the format-agnostic {@link StudyMetadata} from parsed rows. */
export function finalizeStudy(
  format: StudyMetadata["format"],
  investigation: Investigation,
  rows: StudyRow[],
  provenance: StudyProvenance,
  diagnostics: string[],
): StudyMetadata {
  // Factors: distinct levels per factor name, across all rows.
  const factorNames = distinct(rows.flatMap((r) => Object.keys(r.factors)));
  const factors: StudyFactor[] = factorNames.map((name) => ({
    name,
    levels: distinct(rows.map((r) => cellText(r.factors[name]))),
  }));

  // Channels = plex of a run = max distinct isobaric labels within one
  // (file, assay) group — NOT total channel-rows across files (review §A-8/A-9).
  const groups = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.labelKind !== "isobaric" || !r.label) continue;
    const key = r.dataFile ?? r.assayName ?? "";
    let set = groups.get(key);
    if (!set) {
      set = new Set();
      groups.set(key, set);
    }
    set.add(r.label);
  }
  const observed = groups.size ? Math.max(...[...groups.values()].map((s) => s.size)) : 0;

  // Labeling: priority isobaric > silac > label-free > other.
  const kinds = new Set(rows.map((r) => r.labelKind));
  let labeling: StudyLabeling;
  if (kinds.has("isobaric")) {
    const first = rows.find((r) => r.labelKind === "isobaric");
    const reagent = first ? classifyLabel(first.label).reagent : null;
    labeling = { kind: "isobaric", reagent, plex: nominalPlex(reagent, observed) };
  } else if (kinds.has("silac")) {
    labeling = { kind: "silac", reagent: "SILAC", plex: null };
  } else if (kinds.has("label-free")) {
    labeling = { kind: "label-free", reagent: null, plex: null };
  } else {
    labeling = { kind: "other", reagent: null, plex: null };
  }

  const counts = {
    sourceSamples: distinct(rows.map((r) => r.sourceName)).length,
    channels: observed,
    dataFiles: distinct(rows.map((r) => r.dataFile)).length,
    rows: rows.length,
  };

  // Characteristic keys are lowercase in SDRF ("organism") but Title-Case in ISA
  // ("Organism") — look up case-insensitively.
  const charValue = (chars: Record<string, Cell>, key: string): string | null => {
    const hit = Object.keys(chars).find((k) => k.toLowerCase() === key);
    return hit ? cellText(chars[hit]) : null;
  };
  const charValues = (key: string) =>
    distinct(rows.map((r) => charValue(r.characteristics, key)));
  const biology = {
    organisms: charValues("organism"),
    tissues: charValues("organism part"),
    diseases: charValues("disease"),
    cellTypes: charValues("cell type"),
  };

  // Blob path: derive channel assignments from the isobaric rows (run-scoped by
  // the file match). The projection path builds richer assignments directly.
  const channels: ChannelAssignment[] = rows
    .filter((r) => r.labelKind === "isobaric")
    .map((r) => ({
      channelLabel: r.label,
      reporterMz: r.reporterMz,
      role: r.role,
      tag: r.tag,
      sampleId: null,
      sampleName: r.sourceName,
      boundToThisRun: r.matchesThisFile,
    }));

  return {
    format, source: "blob", investigation, channels, runId: null,
    rows, factors, labeling, counts, biology, provenance, diagnostics,
  };
}
