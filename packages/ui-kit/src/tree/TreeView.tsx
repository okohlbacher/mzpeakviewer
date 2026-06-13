import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  accessionIn,
  cvName,
  cvTitle,
  isBareAccession,
  useCvTerms,
  type CvMap,
} from "../utils/cvTerms";

/**
 * Recursive collapsible tree for arbitrary plainified metadata (POJOs / arrays /
 * primitives). Objects and arrays are expandable nodes; primitives are leaves.
 * Keys / values that look like CV accessions (MS:1000511, IMS_1000050_…) get a
 * distinct colour, a hover tooltip with the ontology term + definition, and —
 * for a bare accession — the term name inline.
 *
 * Optional props (additive, default off so existing call sites are unchanged):
 *   query     — filter to nodes whose key/value/CV-name matches; ancestors of a
 *               match are force-expanded and the matched substring is highlighted.
 *   allEpoch  — bump this number to reset every node's manual open/close state…
 *   allOpen   — …to this value (true = expand all, false = collapse all).
 * Every row carries a hover-revealed Copy button (writes the subtree as JSON).
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

function entriesOf(value: unknown): [string, unknown][] {
  return Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
}

/** Does this node (or any descendant) match the query against keys, primitive
 *  values, or resolved CV term names? Cheap recursive scan (metadata is small). */
function subtreeMatches(label: string, value: unknown, cv: CvMap | null, q: string): boolean {
  const ql = q.toLowerCase();
  if (label.toLowerCase().includes(ql)) return true;
  if (CV_RE.test(label)) {
    const nm = cvName(cv, accessionIn(label));
    if (nm && nm.toLowerCase().includes(ql)) return true;
  }
  if (isPrimitive(value)) {
    const s = value === null ? "null" : String(value);
    if (s.toLowerCase().includes(ql)) return true;
    if (typeof value === "string" && isBareAccession(value)) {
      const nm = cvName(cv, accessionIn(value));
      if (nm && nm.toLowerCase().includes(ql)) return true;
    }
    return false;
  }
  return entriesOf(value).some(([k, v]) => subtreeMatches(k, v, cv, q));
}

/** Highlight every case-insensitive occurrence of `q` in `text`. */
function highlight(text: string, q: string | undefined): ReactNode {
  if (!q) return text;
  const ql = q.toLowerCase();
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const hit = lower.indexOf(ql, i);
    if (hit < 0) {
      out.push(text.slice(i));
      break;
    }
    if (hit > i) out.push(text.slice(i, hit));
    out.push(
      <mark className="tree-hit" key={n++}>
        {text.slice(hit, hit + q.length)}
      </mark>,
    );
    i = hit + q.length;
  }
  return out;
}

async function copyJson(value: unknown): Promise<void> {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard blocked (insecure context / permissions) — silent no-op.
  }
}

function CopyBtn({ value }: { value: unknown }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="tree-copy"
      title="Copy as JSON"
      aria-label="Copy as JSON"
      onClick={(e) => {
        e.stopPropagation();
        void copyJson(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 900);
        });
      }}
    >
      {done ? "✓" : "⧉"}
    </button>
  );
}

/** A key/label span that highlights + annotates CV accessions. */
function CvLabel({ label, cv, query }: { label: string; cv: CvMap | null; query?: string }) {
  const isCv = CV_RE.test(label);
  if (!isCv) return <span className="tree-key">{highlight(label, query)}</span>;
  const acc = accessionIn(label);
  const name = isBareAccession(label) ? cvName(cv, acc) : null;
  return (
    <>
      <span className="tree-cv" title={cvTitle(cv, acc)}>
        {highlight(label, query)}
      </span>
      {name && <span className="tree-cv-name">{highlight(name, query)}</span>}
    </>
  );
}

function Leaf({
  label,
  value,
  cv,
  query,
}: {
  label: string;
  value: unknown;
  cv: CvMap | null;
  query?: string;
}) {
  const isStr = typeof value === "string";
  const vAcc = isStr && isBareAccession(value as string) ? accessionIn(value as string) : null;
  const vName = cvName(cv, vAcc);
  const valText = value === null ? "null" : isStr ? `"${value}"` : String(value);
  return (
    <div className="tree-row">
      <span className="tree-caret" />
      <CvLabel label={label} cv={cv} query={query} />
      <span>:</span>
      <span className={`tree-val${isStr ? " str" : ""}`} title={cvTitle(cv, vAcc)}>
        {highlight(valText, query)}
      </span>
      {vName && <span className="tree-cv-name">{highlight(vName, query)}</span>}
      <CopyBtn value={value} />
    </div>
  );
}

function Node({
  label,
  value,
  depth,
  defaultOpen,
  cv,
  query,
  allEpoch,
  allOpen,
}: {
  label: string;
  value: unknown;
  depth: number;
  defaultOpen: number;
  cv: CvMap | null;
  query?: string;
  allEpoch: number;
  allOpen: boolean | null;
}) {
  // Manual open/close override; reset to follow allOpen whenever allEpoch bumps.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  useEffect(() => {
    setUserOpen(null);
  }, [allEpoch]);

  if (isPrimitive(value)) {
    return <Leaf label={label} value={value} cv={cv} query={query} />;
  }

  const allEntries = entriesOf(value);
  const q = query && query.length > 0 ? query : undefined;
  const entries = q ? allEntries.filter(([k, v]) => subtreeMatches(k, v, cv, q)) : allEntries;

  // While searching, force-expand match paths; otherwise honour user → allOpen → default.
  const open = q ? true : (userOpen ?? (allOpen ?? depth < defaultOpen));

  return (
    <div>
      <div
        className="tree-row expandable"
        onClick={() => !q && setUserOpen(() => !open)}
        role="button"
        aria-expanded={open}
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !q) {
            e.preventDefault();
            setUserOpen(() => !open);
          }
        }}
      >
        <span className="tree-caret">{open ? "▾" : "▸"}</span>
        <CvLabel label={label} cv={cv} query={query} />
        <span className="tree-count">{previewLabel(value)}</span>
        <CopyBtn value={value} />
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
                query={query}
                allEpoch={allEpoch}
                allOpen={allOpen}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export type TreeViewProps = {
  label: string;
  value: unknown;
  defaultOpen?: number;
  /** Filter/highlight query (case-insensitive over keys, values, CV names). */
  query?: string;
  /** Bump to reset all manual open/close state to `allOpen`. */
  allEpoch?: number;
  /** Target open state on an allEpoch bump (true = expand all, false = collapse all). */
  allOpen?: boolean | null;
};

export function TreeView({
  label,
  value,
  defaultOpen = 1,
  query,
  allEpoch = 0,
  allOpen = null,
}: TreeViewProps) {
  const cv = useCvTerms();
  const q = query && query.length > 0 ? query : undefined;
  // When searching, hide a whole top-level tree that has no match anywhere.
  const visible = useMemo(() => (q ? subtreeMatches(label, value, cv, q) : true), [q, label, value, cv]);
  if (!visible) return null;
  return (
    <div className="tree">
      <Node
        label={label}
        value={value}
        depth={0}
        defaultOpen={defaultOpen}
        cv={cv}
        query={query}
        allEpoch={allEpoch}
        allOpen={allOpen}
      />
    </div>
  );
}
