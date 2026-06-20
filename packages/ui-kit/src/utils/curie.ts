// Case-insensitive CURIE parsing for SDRF/ISA accessions.
// SDRF inlines `AC=MS:1002602` / `AC=UNIMOD:737` / `AC=Unimod:27`; ISA carries a
// purl URL like http://purl.obolibrary.org/obo/OBI_0000366. Prefix casing varies
// in the wild, so we match on an upper-cased `id` but preserve the original.

/** A parsed controlled-vocabulary reference. */
export type CvRef = { prefix: string; accession: string; id: string; label: string | null };

const OBO_URL = /obolibrary\.org\/obo\/([A-Za-z]+)[_:](\w+)/;
const CURIE = /^\s*([A-Za-z][A-Za-z0-9.]*)[:_](.+?)\s*$/;

/** Parse an accession string into a {@link CvRef}, or null if it isn't one. */
export function parseCurie(s: string | null | undefined, label: string | null = null): CvRef | null {
  if (!s) return null;
  const text = s.trim();
  let prefix: string | null = null;
  let accession: string | null = null;

  const url = OBO_URL.exec(text);
  if (url) {
    prefix = url[1] ?? null;
    accession = url[2] ?? null;
  } else {
    const m = CURIE.exec(text);
    if (!m) return null;
    prefix = m[1] ?? null;
    accession = m[2] ?? null;
  }
  if (!prefix || !accession) return null;
  return {
    prefix,
    accession,
    id: `${prefix.toUpperCase()}:${accession}`,
    label: label ?? null,
  };
}

/** Build an OLS (Ontology Lookup Service) search URL for an accession not in the
 *  bundled CV map (NCBITaxon / EFO / Unimod / Cellosaurus …). */
export function olsUrl(ref: CvRef): string {
  return `https://www.ebi.ac.uk/ols4/search?q=${encodeURIComponent(ref.id)}`;
}
