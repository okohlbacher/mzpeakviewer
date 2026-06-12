import { useStore } from "../state/store";
import { Panel, StatRow } from "./ds";

/**
 * Human-readable acquisition summary (UAT-r3): replaces the raw-JSON "Metadata"
 * dumps in the researcher's primary view. Pulls the few fields a wet-lab user
 * actually reads — sample, instrument, software, source provenance, polarity —
 * from the (format-unstable) FileMetadata, defensively. The full raw metadata
 * still lives, unchanged, under "Format details".
 *
 * Defensive by design: mzPeak has no stability guarantee, so every field is
 * probed through optional access and rendered only when it resolves.
 */

type AnyParam = {
  name?: string;
  value?: unknown;
  accession?: string | null;
};

/** Safely pull a param list off any ParamDescribed-like object. */
function paramsOf(o: unknown): AnyParam[] {
  if (!o || typeof o !== "object") return [];
  const obj = o as Record<string, unknown>;
  const p = obj.parameters ?? obj.params ?? obj.contents;
  return Array.isArray(p) ? (p as AnyParam[]) : [];
}

function byAccession(ps: AnyParam[], acc: string): AnyParam | undefined {
  return ps.find((p) => p.accession === acc);
}

function byNameIncludes(ps: AnyParam[], sub: string): AnyParam | undefined {
  const s = sub.toLowerCase();
  return ps.find((p) => (p.name ?? "").toLowerCase().includes(s));
}

function str(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

/** Polarity from any of the standard positive/negative scan cvParams. */
function polarityOf(...lists: AnyParam[][]): string | null {
  for (const ps of lists) {
    if (byAccession(ps, "MS:1000130") || byNameIncludes(ps, "positive scan"))
      return "positive";
    if (byAccession(ps, "MS:1000129") || byNameIncludes(ps, "negative scan"))
      return "negative";
  }
  return null;
}

export function SampleRunPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const fileMeta = useStore((s) => s.fileMeta);
  const stats = useStore((s) => s.stats);
  if (!fileMeta) return null;

  const fm = fileMeta as Record<string, unknown>;
  const run = fm.run;
  const samples = Array.isArray(fm.samples) ? (fm.samples as unknown[]) : [];
  const software = Array.isArray(fm.software) ? (fm.software as unknown[]) : [];
  const instruments = Array.isArray(fm.instrumentConfigurations)
    ? (fm.instrumentConfigurations as unknown[])
    : [];
  const fileDesc = fm.fileDescription as Record<string, unknown> | undefined;
  const sourceFiles = Array.isArray(fileDesc?.sourceFiles)
    ? (fileDesc!.sourceFiles as Record<string, unknown>[])
    : [];

  // Run id (string-ish field on the run object).
  const runId = run && typeof run === "object" ? str((run as Record<string, unknown>).id) : null;

  // Sample names (fall back to id).
  const sampleNames = samples
    .map((s) => {
      const o = s as Record<string, unknown>;
      return str(o.name) ?? str(o.id);
    })
    .filter((x): x is string => x != null);

  // Software: "id v<version>".
  const softwareList = software
    .map((s) => {
      const o = s as Record<string, unknown>;
      const id = str(o.id);
      const ver = str(o.version);
      if (id && ver) return `${id} v${ver}`;
      return id ?? ver;
    })
    .filter((x): x is string => x != null);

  // Instrument model: probe each config's params + component params for a
  // "instrument model" cvParam (MS:1000031) or a descriptive name.
  let instrumentModel: string | null = null;
  for (const ic of instruments) {
    const ps = paramsOf(ic);
    const model = byAccession(ps, "MS:1000031") ?? byNameIncludes(ps, "instrument");
    if (model) {
      instrumentModel = str(model.value) ?? str(model.name);
      if (instrumentModel) break;
    }
    const comps = (ic as Record<string, unknown>).components;
    if (Array.isArray(comps)) {
      for (const c of comps) {
        const cm = byNameIncludes(paramsOf(c), "instrument");
        if (cm) {
          instrumentModel = str(cm.value) ?? str(cm.name) ?? null;
          if (instrumentModel) break;
        }
      }
    }
    if (instrumentModel) break;
  }

  // Provenance: original source filenames (the imzML / vendor RAW).
  const sources = sourceFiles
    .map((sf) => str(sf.name) ?? str(sf.location))
    .filter((x): x is string => x != null);

  const polarity = polarityOf(paramsOf(run), paramsOf(fileDesc));
  const mode =
    stats?.representationCounts &&
    (stats.representationCounts.profile > 0 || stats.representationCounts.centroid > 0)
      ? stats.representationCounts.profile >= stats.representationCounts.centroid
        ? "profile"
        : "centroid"
      : null;

  const rows: Array<[string, string | null]> = [
    ["Run", runId],
    ["Sample", sampleNames.length ? sampleNames.join(", ") : null],
    ["Instrument", instrumentModel],
    ["Software", softwareList.length ? softwareList.join(" · ") : null],
    ["Polarity", polarity],
    ["Spectrum mode", mode],
    ["Source", sources.length ? sources.join(", ") : null],
  ];
  const present = rows.filter(([, v]) => v != null);

  return (
    <Panel title="Sample & Run" testid="sample-run-panel" defaultOpen={defaultOpen}>
      <div data-testid="sample-run-table">
        {present.length > 0 ? (
          present.map(([label, value]) => (
            <StatRow key={label} label={label} value={value} />
          ))
        ) : (
          <p style={{ color: "var(--text-faint)", fontSize: "var(--text-xs)", margin: 0 }}>
            No descriptive run metadata in this file. See Format details for the
            raw metadata block.
          </p>
        )}
      </div>
    </Panel>
  );
}
