export type OpticalBand = "UV" | "VIS" | "UV/VIS";

export const UV_VIS_DIVIDE_NM = 400;

/**
 * Classify observed wavelength min/max in nm.
 * 400 nm is the conventional UV/visible divide.
 */
export function classifyOpticalBand(
  minNm: number,
  maxNm: number,
): OpticalBand | null {
  if (!Number.isFinite(minNm) || !Number.isFinite(maxNm)) {
    return null;
  }

  if (minNm > maxNm || maxNm <= 0) {
    return null;
  }

  if (maxNm <= UV_VIS_DIVIDE_NM) {
    return "UV";
  }

  if (minNm >= UV_VIS_DIVIDE_NM) {
    return "VIS";
  }

  return "UV/VIS";
}
