// SEQUEST .dta export of the currently displayed spectrum (whichever facet is shown).
//
// Format: first line `MH+ charge` (the singly-protonated precursor mass and the charge
// state), then one `m/z intensity` pair per line, space-separated. Classic .dta is an
// MS2 format; for spectra WITHOUT precursor information (MS1, or files whose converter
// wrote no selected-ion rows) we emit the conventional placeholder header `0 1` so the
// two-column peak list still round-trips through .dta-reading tools.
const PROTON = 1.00727646688; // Da

/** Precursor info extracted from the spectrum's metadata tree. */
export type DtaPrecursor = { mz: number; charge: number | null };

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}

/**
 * Pull the precursor (selected-ion m/z + charge) out of the plainified spectrum
 * metadata tree. Prefers the selected ion (real measured precursor); falls back to the
 * isolation-window target (DIA — window center, charge unknown). Defensive against the
 * nested/flat key spellings; returns null when the spectrum has no precursor at all.
 */
export function precursorFromMeta(meta: unknown): DtaPrecursor | null {
  const m = meta as {
    selectedIons?: unknown; selected_ions?: unknown;
    precursors?: unknown;
  } | null | undefined;
  if (!m || typeof m !== "object") return null;

  const ions = (m.selectedIons ?? m.selected_ions) as Array<Record<string, unknown>> | undefined;
  const ion = Array.isArray(ions) ? ions[0] : undefined;
  if (ion) {
    const mz = num(ion.mz) ?? num(ion["MS_1000744_selected_ion_mz"]) ?? num(ion["selected_ion_mz"]);
    if (mz != null && mz > 0) {
      const charge =
        num(ion.chargeState) ?? num(ion.charge_state) ?? num(ion["MS_1000041_charge_state"]) ?? null;
      return { mz, charge: charge != null && charge >= 1 ? Math.round(charge) : null };
    }
  }

  const precs = m.precursors as Array<Record<string, unknown>> | undefined;
  const p0 = Array.isArray(precs) ? precs[0] : undefined;
  const iw = (p0?.isolationWindow ?? p0?.isolation_window) as Record<string, unknown> | undefined;
  const target = num(iw?.target) ?? num(iw?.["MS_1000827_isolation_window_target_mz"]);
  if (target != null && target > 0) return { mz: target, charge: null };
  return null;
}

/** Trim a fixed-decimal number ("450.120000" → "450.12", "450.000000" → "450"). */
function fmt(v: number, decimals: number): string {
  return v
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

/**
 * Build the .dta text for a displayed spectrum. `charge` defaults to 1 (the standard
 * assumption when the file records none — MH+ then equals the precursor m/z).
 * Throws on an empty spectrum: an empty .dta is never what the user wants.
 */
export function buildDta(
  mz: ArrayLike<number>,
  intensity: ArrayLike<number>,
  precursor: DtaPrecursor | null,
): string {
  if (mz.length === 0) throw new Error("This spectrum has no data points to export.");
  const lines: string[] = [];
  if (precursor) {
    const z = precursor.charge ?? 1;
    const mhPlus = precursor.mz * z - (z - 1) * PROTON;
    lines.push(`${fmt(mhPlus, 6)} ${z}`);
  } else {
    lines.push("0 1"); // conventional "no precursor" header (MS1 / precursor-less files)
  }
  for (let i = 0; i < mz.length; i++) {
    lines.push(`${fmt(mz[i]!, 6)} ${fmt(intensity[i]!, 4)}`);
  }
  return lines.join("\n") + "\n";
}

/** `HEK_PosOAD1.native.mzpeak`, 17, "centroid" → `HEK_PosOAD1.native.spec17.centroid.dta` */
export function dtaFilename(fileName: string | null, index: number, facet: string | null): string {
  const stem = (fileName ?? "spectrum").replace(/\.mzpeak$/i, "");
  return `${stem}.spec${index}${facet ? `.${facet}` : ""}.dta`;
}
