// Pure SDRF → study-design model for the Study-design view. No React, no I/O —
// unit-testable. Encodes the review findings from the adversarial plan review:
//  - counts are reported SEPARATELY (rows / source names / assay names / data files) —
//    they are different things in SDRF and conflating them misleads (480/128/28/48 in
//    PXD011799).
//  - the label scheme is classified from THIS RUN's rows (a study can mix plexes),
//    through the shared reagent table (core adapt/sdrf), asserting a named plex only
//    for a complete recognized panel; otherwise reported honestly as partial.
//  - constant-vs-varying columns: "compact" mode hides constant columns EXCEPT an
//    always-keep set (source/assay/data file/label/factors), and the hidden protocol
//    metadata is resurfaced as an "Acquisition & processing" card instead of vanishing.
//  - duplicate column headers are valid SDRF → columns are keyed by index, never name.
//  - factor levels: normalized case-insensitively for counting, sentinel values
//    excluded, level list capped.
//  - caps everywhere (rows/cols/cells/levels); aggregation is single-pass.
import { canonicalLabel, reporterMzFor, sdrfRunKey } from "@mzpeak/core";

export type SdrfColumnClass =
  | "source"
  | "characteristics"
  | "assay"
  | "comment"
  | "factor"
  | "other";

export type SdrfColumn = {
  index: number;
  /** Raw header text, verbatim (duplicates allowed in SDRF). */
  raw: string;
  cls: SdrfColumnClass;
  /** Inner key for bracketed classes: characteristics[organism] → "organism". */
  key: string;
  /** True when every (bounded) row holds the same value. */
  constant: boolean;
};

export type LevelCount = { value: string; count: number };

export type SdrfFactor = {
  /** factor value[phenotype] → "phenotype" */
  name: string;
  columnIndex: number;
  /** Distinct levels with row counts (unit: SDRF rows), capped at MAX_FACTOR_LEVELS. */
  levels: LevelCount[];
  /** Total distinct levels before the cap. */
  totalLevels: number;
};

export type LabelScheme = {
  kind: "label-free" | "tmt" | "tmtpro" | "itraq" | "mixed" | "unknown" | "none";
  /** Human label, honest about partiality: "TMT10-plex", "TMT (7 of 10 channels)", … */
  label: string;
  /** Distinct resolved isobaric labels in the classified scope. */
  channels: number;
  /** True when the distinct labels form a complete recognized panel. */
  complete: boolean;
  /** "run" when classified from this run's rows, "study" when no rows matched the run. */
  scope: "run" | "study";
};

export type SdrfDesign = {
  columns: SdrfColumn[];
  /** Column index of comment[data file] (the run-matching column), or null. */
  dataFileColumnIndex: number | null;
  /** Raw rows, bounded to MAX_MODEL_ROWS (order preserved; cells NOT normalized). */
  rows: string[][];
  counts: { rows: number; sources: number; assays: number; dataFiles: number };
  /** Row indices (into `rows`) whose comment[data file] matches the run id. Exact only. */
  runRowIndices: number[];
  factors: SdrfFactor[];
  scheme: LabelScheme;
  /** Distributions for headline characteristics (organism/part/disease/instrument…). */
  highlights: { label: string; levels: LevelCount[]; totalLevels: number }[];
  /** Acquisition & processing card: distinct values of protocol comment columns. */
  protocol: { label: string; values: string[] }[];
  /** Model-level warnings (row/column caps hit, missing key columns…). */
  warnings: string[];
};

// ── caps (review F8/Q8: bound rows, cols, cells, levels — not just rendered rows) ──
export const MAX_MODEL_ROWS = 20_000;
export const MAX_MODEL_COLS = 256;
export const MAX_FACTOR_LEVELS = 30;
export const MAX_HIGHLIGHT_LEVELS = 8;
const MAX_CELL_CHARS = 2_000;

/** SDRF "no value" sentinels — excluded from level counting (case-insensitive). */
const SENTINELS = new Set(["", "not available", "not applicable", "na", "n/a", "none"]);

/** Columns kept visible even when constant, in compact mode (review: hiding the label or
 *  data-file column would make the table unreadable as a *design* table). */
const ALWAYS_KEEP = new Set(["source name", "assay name"]);
const ALWAYS_KEEP_COMMENT = new Set(["data file", "label", "fraction identifier", "technical replicate"]);

/** Protocol card allowlist: the comment[...] keys a proteomics reader scans for first. */
const PROTOCOL_KEYS: [string, string][] = [
  ["instrument", "Instrument"],
  ["cleavage agent details", "Cleavage agent"],
  ["modification parameters", "Modifications"],
  ["dissociation method", "Dissociation"],
  ["precursor mass tolerance", "Precursor tol."],
  ["fragment mass tolerance", "Fragment tol."],
  ["enrichment process", "Enrichment"],
  ["depletion", "Depletion"],
  ["collision energy", "Collision energy"],
  ["proteomics data acquisition method", "Acquisition"],
];

/** Headline characteristics for the overview cards. */
const HIGHLIGHT_KEYS: [string, string][] = [
  ["organism", "Organism"],
  ["organism part", "Organism part"],
  ["disease", "Disease"],
  ["cell type", "Cell type"],
  ["cell line", "Cell line"],
  ["developmental stage", "Stage"],
  ["sex", "Sex"],
];

function classify(raw: string): { cls: SdrfColumnClass; key: string } {
  const h = raw.trim().toLowerCase();
  if (h === "source name") return { cls: "source", key: "source name" };
  if (h === "assay name") return { cls: "assay", key: "assay name" };
  const m = /^(characteristics|comment|factor value)\s*\[(.*)\]$/.exec(h);
  if (m) {
    const cls = m[1] === "characteristics" ? "characteristics" : m[1] === "comment" ? "comment" : "factor";
    return { cls, key: (m[2] ?? "").trim() };
  }
  return { cls: "other", key: h };
}

/** Normalize a cell for AGGREGATION only (display always shows the raw text). */
function norm(v: string): string {
  return v.trim().toLowerCase();
}

function isSentinel(v: string): boolean {
  return SENTINELS.has(norm(v));
}

/** Count distinct normalized values → LevelCount[] (display uses the first raw spelling). */
function levelCounts(values: string[]): { levels: LevelCount[]; total: number } {
  const counts = new Map<string, { value: string; count: number }>();
  for (const v of values) {
    if (isSentinel(v)) continue;
    const k = norm(v);
    const e = counts.get(k);
    if (e) e.count++;
    else counts.set(k, { value: v.trim(), count: 1 });
  }
  const all = [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { levels: all, total: all.length };
}

/** Strip a UTF-8 BOM (review: `﻿source name` must still classify as source). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Known complete panels by (family, distinct-channel count).
const PANELS: Record<string, Record<number, string>> = {
  tmt: { 2: "TMT2-plex", 6: "TMT6-plex", 10: "TMT10-plex", 11: "TMT11-plex" },
  tmtpro: { 16: "TMTpro 16-plex", 18: "TMTpro 18-plex" },
  itraq: { 4: "iTRAQ 4-plex", 8: "iTRAQ 8-plex" },
};

/** Classify the label scheme from a set of comment[label] values (one scope). */
function classifyLabels(values: string[], scope: "run" | "study"): LabelScheme {
  const resolved = new Map<string, string>(); // canonical → family
  let sawAny = false;
  let sawLabelFree = false;
  let sawUnresolvable = false;
  for (const v of values) {
    if (isSentinel(v)) continue;
    sawAny = true;
    if (/label\s*free/i.test(v)) {
      sawLabelFree = true;
      continue;
    }
    const canon = canonicalLabel(v);
    if (reporterMzFor(v) == null) {
      sawUnresolvable = true;
      continue;
    }
    const family = canon.startsWith("TMTPRO") ? "tmtpro" : canon.startsWith("TMT") ? "tmt" : "itraq";
    resolved.set(canon, family);
  }
  if (!sawAny) return { kind: "none", label: "not annotated", channels: 0, complete: false, scope };
  if (resolved.size === 0) {
    return sawLabelFree
      ? { kind: "label-free", label: "label-free", channels: 0, complete: true, scope }
      : { kind: "unknown", label: "unrecognized labels", channels: 0, complete: false, scope };
  }
  const families = new Set(resolved.values());
  if (families.size > 1 || sawLabelFree) {
    return { kind: "mixed", label: `mixed labels (${resolved.size} channels)`, channels: resolved.size, complete: false, scope };
  }
  const family = [...families][0]! as "tmt" | "tmtpro" | "itraq";
  const panel = PANELS[family]?.[resolved.size];
  if (panel && !sawUnresolvable) {
    return { kind: family, label: panel, channels: resolved.size, complete: true, scope };
  }
  // Partial/odd count: report honestly (e.g. one fraction row missing, or a misspelling).
  const familyLabel = family === "tmtpro" ? "TMTpro" : family === "itraq" ? "iTRAQ" : "TMT";
  const next = Object.keys(PANELS[family] ?? {}).map(Number).find((n) => n >= resolved.size);
  return {
    kind: family,
    label: next ? `${familyLabel} (${resolved.size} of ${next} channels)` : `${familyLabel} (${resolved.size} channels)`,
    channels: resolved.size,
    complete: false,
    scope,
  };
}

/** Build the design model from a parsed SDRF (columns + rows) and the run id. */
export function buildSdrfDesign(
  rawColumns: string[],
  rawRows: string[][],
  runId: string | null,
): SdrfDesign {
  const warnings: string[] = [];

  // Bound the model.
  let columnsIn = rawColumns;
  if (columnsIn.length > MAX_MODEL_COLS) {
    warnings.push(`showing first ${MAX_MODEL_COLS} of ${columnsIn.length} columns`);
    columnsIn = columnsIn.slice(0, MAX_MODEL_COLS);
  }
  let rowsIn = rawRows;
  if (rowsIn.length > MAX_MODEL_ROWS) {
    warnings.push(`aggregates computed over the first ${MAX_MODEL_ROWS.toLocaleString()} of ${rawRows.length.toLocaleString()} rows`);
    rowsIn = rowsIn.slice(0, MAX_MODEL_ROWS);
  }
  // Clamp pathological cells once, for both aggregation and render.
  const rows = rowsIn.map((r) =>
    r.slice(0, columnsIn.length).map((c) => (c.length > MAX_CELL_CHARS ? c.slice(0, MAX_CELL_CHARS) + "…" : c)),
  );

  // Classify columns + constancy in one pass.
  const columns: SdrfColumn[] = columnsIn.map((raw, index) => {
    const { cls, key } = classify(raw);
    let constant = true;
    let first: string | null = null;
    for (const r of rows) {
      const v = norm(r[index] ?? "");
      if (first === null) first = v;
      else if (v !== first) {
        constant = false;
        break;
      }
    }
    return { index, raw, cls, key, constant };
  });

  const colsBy = (cls: SdrfColumnClass, key?: string) =>
    columns.filter((c) => c.cls === cls && (key === undefined || c.key === key));
  const cell = (r: string[], c: SdrfColumn | undefined) => (c ? (r[c.index] ?? "") : "");

  const sourceCol = colsBy("source")[0];
  const assayCol = colsBy("assay")[0];
  const dataFileCol = colsBy("comment", "data file")[0];
  const labelCols = colsBy("comment", "label");
  if (!sourceCol) warnings.push("no `source name` column — sample counting unavailable");

  // Separate counts (review: rows ≠ sources ≠ assays ≠ files).
  const distinct = (col: SdrfColumn | undefined) =>
    col ? new Set(rows.map((r) => norm(cell(r, col))).filter((v) => !SENTINELS.has(v))).size : 0;
  const counts = {
    rows: rawRows.length,
    sources: distinct(sourceCol),
    assays: distinct(assayCol),
    dataFiles: distinct(dataFileCol),
  };

  // This-run rows: EXACT matches only (review: no study-wide fallback for row pinning).
  const want = runId ? sdrfRunKey(runId) : null;
  const runRowIndices: number[] = [];
  if (want && dataFileCol) {
    rows.forEach((r, i) => {
      if (sdrfRunKey(cell(r, dataFileCol)) === want) runRowIndices.push(i);
    });
  }

  // Factors.
  const factors: SdrfFactor[] = colsBy("factor")
    .map((c) => {
      const { levels, total } = levelCounts(rows.map((r) => cell(r, c)));
      return { name: c.key, columnIndex: c.index, levels: levels.slice(0, MAX_FACTOR_LEVELS), totalLevels: total };
    })
    // A factor whose column holds only sentinels/empties carries no design information —
    // rendering it as a bare name confuses more than it informs (seen: MTBLS1129 "gene").
    .filter((f) => f.totalLevels > 0);

  // Label scheme: this run's rows when matched, else study-wide (labeled as such).
  const labelValues = (idxs: number[] | null) => {
    if (labelCols.length === 0) return [];
    const rr = idxs ? idxs.map((i) => rows[i]!) : rows;
    return rr.flatMap((r) => labelCols.map((c) => cell(r, c)));
  };
  const scheme =
    labelCols.length === 0
      ? ({ kind: "none", label: "not annotated", channels: 0, complete: false, scope: "study" } as LabelScheme)
      : runRowIndices.length > 0
        ? classifyLabels(labelValues(runRowIndices), "run")
        : classifyLabels(labelValues(null), "study");

  // Highlights (characteristics distributions).
  const highlights = HIGHLIGHT_KEYS.flatMap(([key, label]) => {
    const col = colsBy("characteristics", key)[0];
    if (!col) return [];
    const { levels, total } = levelCounts(rows.map((r) => cell(r, col)));
    if (total === 0) return [];
    return [{ label, levels: levels.slice(0, MAX_HIGHLIGHT_LEVELS), totalLevels: total }];
  });

  // Protocol card: distinct values across ALL matching comment columns (duplicates are
  // separate columns in SDRF — modification parameters is typically 3-5 columns).
  const protocol = PROTOCOL_KEYS.flatMap(([key, label]) => {
    const cols = colsBy("comment", key);
    if (cols.length === 0) return [];
    const vals = new Map<string, string>();
    for (const r of rows) {
      for (const c of cols) {
        const v = cell(r, c);
        if (!isSentinel(v)) vals.set(norm(v), v.trim());
      }
    }
    if (vals.size === 0) return [];
    return [{ label, values: [...vals.values()].slice(0, 12) }];
  });

  return {
    columns,
    dataFileColumnIndex: dataFileCol ? dataFileCol.index : null,
    rows,
    counts,
    runRowIndices,
    factors,
    scheme,
    highlights,
    protocol,
    warnings,
  };
}

/** SDRF structured values are ;-separated KEY=value lists (NT=name, AC=accession, …).
 *  For display, prefer the NT= (name) part; fall back to the raw string. Pure text — the
 *  raw value stays available in the table. */
export function sdrfValueName(v: string): string {
  // Cells are sometimes shipped quoted ("NT=…;AC=…") — strip wrapping quotes first.
  const unq = v.trim().replace(/^"(.*)"$/s, "$1").trim();
  if (!unq.includes("=")) return unq;
  const nt = unq.split(";").map((p) => p.trim()).find((p) => /^NT=/i.test(p));
  if (nt) return nt.slice(3).trim() || unq;
  return unq;
}

/** Visible columns for the table's "compact" mode: varying columns + the always-keep
 *  set (source/assay/data file/label/replicate/fraction + every factor). */
export function compactColumns(columns: SdrfColumn[]): SdrfColumn[] {
  return columns.filter(
    (c) =>
      !c.constant ||
      c.cls === "factor" ||
      (c.cls === "comment" && ALWAYS_KEEP_COMMENT.has(c.key)) ||
      ALWAYS_KEEP.has(c.key),
  );
}
