import { useState } from "react";
import {
  accessionIn,
  cvName,
  cvTitle,
  isBareAccession,
  useCvTerms,
  type CvMap,
} from "./cvTerms";

/**
 * Recursive collapsible tree for arbitrary plainified metadata (POJOs / arrays /
 * primitives). Objects and arrays are expandable nodes; primitives are leaves.
 * Keys / values that look like CV accessions (MS:1000511, IMS_1000050_…) get a
 * distinct colour, a hover tooltip with the ontology term + definition, and —
 * for a bare accession — the term name inline.
 */

const CV_RE = /^(MS|IMS|UO|PEFF|BTO|NCIT)[:_]\d{4,}/;

function isPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v !== "object";
}

function previewLabel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v && typeof v === "object") {
    const n = Object.keys(v as object).length;
    return `{${n}}`;
  }
  return "";
}

/** A key/label span that highlights + annotates CV accessions. */
function CvLabel({ label, cv }: { label: string; cv: CvMap | null }) {
  const isCv = CV_RE.test(label);
  if (!isCv) return <span className="tree-key">{label}</span>;
  const acc = accessionIn(label);
  const name = isBareAccession(label) ? cvName(cv, acc) : null;
  return (
    <>
      <span className="tree-cv" title={cvTitle(cv, acc)}>
        {label}
      </span>
      {name && <span className="tree-cv-name">{name}</span>}
    </>
  );
}

function Leaf({ label, value, cv }: { label: string; value: unknown; cv: CvMap | null }) {
  const isStr = typeof value === "string";
  // A string value that is itself an accession (e.g. spectrum_representation).
  const vAcc = isStr && isBareAccession(value as string) ? accessionIn(value as string) : null;
  const vName = cvName(cv, vAcc);
  return (
    <div className="tree-row">
      <span className="tree-caret" />
      <CvLabel label={label} cv={cv} />
      <span>:</span>
      <span className={`tree-val${isStr ? " str" : ""}`} title={cvTitle(cv, vAcc)}>
        {value === null ? "null" : isStr ? `"${value}"` : String(value)}
      </span>
      {vName && <span className="tree-cv-name">{vName}</span>}
    </div>
  );
}

function Node({
  label,
  value,
  depth,
  defaultOpen,
  cv,
}: {
  label: string;
  value: unknown;
  depth: number;
  defaultOpen: number;
  cv: CvMap | null;
}) {
  const [open, setOpen] = useState(depth < defaultOpen);

  if (isPrimitive(value)) {
    return <Leaf label={label} value={value} cv={cv} />;
  }

  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);

  return (
    <div>
      <div
        className="tree-row expandable"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className="tree-caret">{open ? "▾" : "▸"}</span>
        <CvLabel label={label} cv={cv} />
        <span className="tree-count">{previewLabel(value)}</span>
      </div>
      {open && (
        <div className="tree-node">
          {entries.length === 0 ? (
            <div className="tree-row">
              <span className="tree-caret" />
              <span className="tree-count">(empty)</span>
            </div>
          ) : (
            entries.map(([k, v]) => (
              <Node
                key={k}
                label={k}
                value={v}
                depth={depth + 1}
                defaultOpen={defaultOpen}
                cv={cv}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function TreeView({
  label,
  value,
  defaultOpen = 1,
}: {
  label: string;
  value: unknown;
  defaultOpen?: number;
}) {
  const cv = useCvTerms();
  return (
    <div className="tree">
      <Node label={label} value={value} depth={0} defaultOpen={defaultOpen} cv={cv} />
    </div>
  );
}
