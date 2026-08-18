// Canonical guards for the Study-design model (pure; no React/WASM). Cases encode the
// adversarial-review findings: separate counts, per-run label-scheme classification with
// honest partials, duplicate columns by index, sentinel exclusion, compact-column keeps,
// exact-only run matching, BOM tolerance.
import { describe, it, expect } from "vitest";
import { buildSdrfDesign, compactColumns, stripBom } from "./sdrfDesign";
import { parseSdrf } from "./sdrf";

const COLS = [
  "source name",
  "characteristics[organism]",
  "characteristics[disease]",
  "assay name",
  "comment[data file]",
  "comment[label]",
  "comment[instrument]",
  "factor value[disease]",
];

// 4 rows: TMT2 pair on run A (fr1), TMT2 pair on run B (fr2). organism constant;
// disease varies and is the factor.
const ROWS = [
  ["s1", "Homo sapiens", "normal", "run1", "20170131_run_fr1.raw", "TMT126", "Q Exactive", "normal"],
  ["s2", "homo sapiens", "tumor", "run1", "20170131_run_fr1.raw", "TMT127", "Q Exactive", "tumor"],
  ["s1", "Homo sapiens", "normal", "run2", "20170131_run_fr2.raw", "TMT126", "Q Exactive", "normal"],
  ["s2", "Homo sapiens", "tumor", "run2", "20170131_run_fr2.raw", "TMT127", "Q Exactive", "tumor"],
];

describe("buildSdrfDesign", () => {
  it("reports rows / sources / assays / data files as SEPARATE counts", () => {
    const d = buildSdrfDesign(COLS, ROWS, null);
    expect(d.counts).toEqual({ rows: 4, sources: 2, assays: 2, dataFiles: 2 });
  });

  it("matches this run's rows exactly (XML-id-escaped run id), never study-wide", () => {
    const d = buildSdrfDesign(COLS, ROWS, "_x0032_0170131_run_fr1");
    expect(d.runRowIndices).toEqual([0, 1]);
    const none = buildSdrfDesign(COLS, ROWS, "some_other_run");
    expect(none.runRowIndices).toEqual([]); // exact-only: no fallback for row pinning
  });

  it("classifies the label scheme from THIS run's rows (complete TMT2)", () => {
    const d = buildSdrfDesign(COLS, ROWS, "_x0032_0170131_run_fr1");
    expect(d.scheme).toMatchObject({ kind: "tmt", label: "TMT2-plex", channels: 2, complete: true, scope: "run" });
  });

  it("reports a partial plex honestly instead of inventing one", () => {
    const rows = ROWS.slice(0, 1); // only TMT126 present
    const d = buildSdrfDesign(COLS, rows, "_x0032_0170131_run_fr1");
    expect(d.scheme.complete).toBe(false);
    expect(d.scheme.label).toMatch(/TMT \(1 of 2 channels\)/);
  });

  it("classic TMT6 unsuffixed labels resolve (core reagent-table aliases)", () => {
    const rows = ["TMT126", "TMT127", "TMT128", "TMT129", "TMT130", "TMT131"].map((l, i) => [
      `s${i}`, "Homo sapiens", "normal", "run1", "a.raw", l, "LTQ", "normal",
    ]);
    const d = buildSdrfDesign(COLS, rows, null);
    expect(d.scheme).toMatchObject({ label: "TMT6-plex", complete: true });
  });

  it("label-free scheme + factor levels normalized case-insensitively, sentinels excluded", () => {
    const rows = [
      ["s1", "Homo sapiens", "normal", "r1", "a.raw", "label free sample", "LTQ", "Normal"],
      ["s2", "Homo sapiens", "tumor", "r2", "b.raw", "label free sample", "LTQ", "normal"],
      ["s3", "Homo sapiens", "not available", "r3", "c.raw", "label free sample", "LTQ", "not applicable"],
    ];
    const d = buildSdrfDesign(COLS, rows, null);
    expect(d.scheme.kind).toBe("label-free");
    const factor = d.factors[0]!;
    expect(factor.name).toBe("disease");
    expect(factor.levels).toEqual([{ value: "Normal", count: 2 }]); // case-folded; sentinel dropped
  });

  it("compactColumns keeps varying + always-keep columns, drops constant noise", () => {
    const d = buildSdrfDesign(COLS, ROWS, null);
    const kept = compactColumns(d.columns).map((c) => c.raw);
    expect(kept).toContain("source name"); // always-keep even though could be varying
    expect(kept).toContain("comment[data file]");
    expect(kept).toContain("comment[label]");
    expect(kept).toContain("factor value[disease]");
    expect(kept).not.toContain("characteristics[organism]"); // constant (case-insensitively)
    expect(kept).not.toContain("comment[instrument]"); // constant → protocol card instead
  });

  it("constant protocol columns surface in the Acquisition & processing card", () => {
    const d = buildSdrfDesign(COLS, ROWS, null);
    expect(d.protocol).toEqual([{ label: "Instrument", values: ["Q Exactive"] }]);
  });

  it("duplicate column headers stay positionally distinct", () => {
    const cols = ["source name", "comment[modification parameters]", "comment[modification parameters]"];
    const rows = [["s1", "Carbamidomethyl", "Oxidation"]];
    const d = buildSdrfDesign(cols, rows, null);
    expect(d.columns.filter((c) => c.key === "modification parameters")).toHaveLength(2);
    expect(d.protocol[0]!.values.sort()).toEqual(["Carbamidomethyl", "Oxidation"]);
  });

  it("tolerates a UTF-8 BOM on the header row", () => {
    const { columns } = parseSdrf(stripBom("﻿source name\tassay name\ns1\tr1"));
    const d = buildSdrfDesign(columns, [["s1", "r1"]], null);
    expect(d.counts.sources).toBe(1);
  });
});
