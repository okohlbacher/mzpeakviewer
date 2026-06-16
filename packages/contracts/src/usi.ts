// USI — Universal Spectrum Identifier (PSI). PURE parse/build grammar, mirroring
// url/grammar.ts: no store, no I/O. The app derives the parts (collection from the
// source URL, msRun from the filename, the selector flag/value from the selection)
// and calls buildUsi(); resolving a USI back is parseUsi() + the app's scan/index
// resolver.
//
// Format: mzspec:<collection>:<msRun>:<indexFlag>:<value>[:<interpretation>]
//   indexFlag ∈ "scan" | "index" | "nativeId"
//   e.g. mzspec:PXD011799:20170131_Lumos_…_fr8:scan:10000
//
// Spec: https://www.psidev.info/usi (HUPO-PSI/usi).

/** How the spectrum is addressed within its run. */
export type UsiIndexFlag = "scan" | "index" | "nativeId";

export type Usi = {
  collection: string;
  msRun: string;
  flag: UsiIndexFlag;
  value: string;
  /** Optional trailing interpretation (peptidoform/charge/…); preserved verbatim. */
  interpretation?: string | null;
};

/** PSI placeholder collection for spectra NOT in a ProteomeXchange repository (local /
 *  unsubmitted files) — lets us always emit a *valid* USI even with no dataset accession. */
export const USI_LOCAL_COLLECTION = "USI000000";

const FLAGS: readonly UsiIndexFlag[] = ["scan", "index", "nativeId"];

/**
 * Parse a USI string into its parts, or null if it isn't a well-formed USI. The value
 * may itself contain `=`/spaces (Thermo nativeIDs) but not `:`; any colon-bearing tail
 * after the value is treated as the (optional) interpretation.
 */
export function parseUsi(usi: string): Usi | null {
  if (typeof usi !== "string") return null;
  const parts = usi.trim().split(":");
  // mzspec : collection : msRun : flag : value [ : interpretation… ]
  if (parts.length < 5) return null;
  if (parts[0]!.toLowerCase() !== "mzspec") return null;
  const [, collection, msRun, flagRaw, value, ...rest] = parts;
  const flag = FLAGS.find((f) => f.toLowerCase() === String(flagRaw).toLowerCase());
  if (!collection || !msRun || !flag || value == null || value === "") return null;
  const interpretation = rest.length ? rest.join(":") : null;
  return { collection, msRun, flag, value, interpretation };
}

/** Build a USI string from its parts. */
export function buildUsi(u: Usi): string {
  const base = `mzspec:${u.collection}:${u.msRun}:${u.flag}:${u.value}`;
  return u.interpretation ? `${base}:${u.interpretation}` : base;
}
