// Tiny dependency-free SDRF (Sample and Data Relationship Format) TSV parser.
// SDRF is a tab-separated table: a single header row ("source name",
// "characteristics[...]", "assay name", "comment[label]", …) followed by one row
// per sample. We do the minimal thing: split on newlines, drop empty trailing
// lines, split each line on tabs. First line = columns; the rest = data rows.

export function parseSdrf(text: string): { columns: string[]; rows: string[][] } {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\r$/, "")) // tolerate CRLF
    .filter((l, i, arr) => l.length > 0 || i < arr.length - 1); // drop empty trailing lines

  // Remove any remaining wholly-empty lines (e.g. blank rows in the middle/end).
  const nonEmpty = lines.filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return { columns: [], rows: [] };

  const columns = nonEmpty[0]!.split("\t"); // guarded: nonEmpty.length > 0 above
  const rows = nonEmpty.slice(1).map((l) => l.split("\t"));
  return { columns, rows };
}
