// PURE adapter: reader-extracted single-spectrum fields → the contract SpectrumArrays.
// Follows the capability.ts template: a pure function from plain, already-extracted
// data (NO mzpeakts handle, no Arrow) to a wire type, with a unit test. The reader-I/O
// (calling getSpectrum, reconstructing mz/intensity, reading the representation CV
// term off the metadata row) lives in the worker handler — this only reshapes.

import type { SpectrumArrays, SpectrumRepresentation } from "@mzpeak/contracts";

// MS:1000128 = profile spectrum, MS:1000127 = centroid spectrum. This is the
// authoritative mapping the Explorer reader uses in cv.ts (`toRepresentation`,
// lines 21-25: `raw === "MS:1000128" → "profile"`, `raw === "MS:1000127" → "centroid"`,
// else null). Mirrored here so the adapter is the single boundary that normalizes it.
const REPR_PROFILE = "MS:1000128";
const REPR_CENTROID = "MS:1000127";

/**
 * Plain single-spectrum shape the handler extracts from the reader (mirrors what
 * Explorer's `getSpectrumArrays` and IV's `readFastSpectrum` already produce). No
 * Arrow vectors, no reader handle — just the index, native id, the two signal
 * arrays, and the raw representation indicator straight off the spectrum/metadata.
 */
export type SpectrumInput = {
  /** Zero-based spectrum index. */
  index: number;
  /** Native spectrum id string (e.g. "scan=1"). */
  id: string;
  /** m/z values (any numeric array-like; coerced to Float64Array). */
  mz: ArrayLike<number>;
  /** intensity values (any numeric array-like; coerced to Float32Array). */
  intensity: ArrayLike<number>;
  /**
   * Raw representation indicator the source uses to decide profile vs centroid:
   * the MS:1000525 CV value ("MS:1000128"/"MS:1000127"), an already-resolved
   * "profile"/"centroid", or null/undefined when genuinely unknown.
   */
  representation?: string | null;
};

/** Map the raw representation indicator to the contract enum (null = unknown). */
function mapRepresentation(raw: string | null | undefined): SpectrumRepresentation {
  if (raw === REPR_PROFILE || raw === "profile") return "profile";
  if (raw === REPR_CENTROID || raw === "centroid") return "centroid";
  return null;
}

/** Coerce array-like → Float64Array without copying when it already is one. */
function toF64(a: ArrayLike<number>): Float64Array {
  return a instanceof Float64Array ? a : Float64Array.from(a);
}

/** Coerce array-like → Float32Array without copying when it already is one. */
function toF32(a: ArrayLike<number>): Float32Array {
  return a instanceof Float32Array ? a : Float32Array.from(a);
}

/** Reshape extracted spectrum fields into the wire `SpectrumArrays`. */
export function adaptSpectrum(input: SpectrumInput): SpectrumArrays {
  return {
    index: input.index,
    id: input.id,
    mz: toF64(input.mz),
    intensity: toF32(input.intensity),
    representation: mapRepresentation(input.representation),
  };
}
