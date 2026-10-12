// buildImagingGrid — the pure geometry + presence + diagnostics transform.
//
// A named pure export, no side effects (beyond one console.warn on the DoS cap),
// importing ONLY from ./types. It NEVER touches Arrow, bigint, or mzpeakts — it
// receives plain `{x,y}[]` coords from the reader boundary. The boundary is
// one-way: imaging/ does not import reader/.
import type {
  ImagingGrid,
  GridGeometry,
  GridDiagnostics,
  CoordSourceStrategy,
} from "./imagingTypes";

/**
 * DoS cap: refuse to allocate a presence mask larger than this many
 * cells. Map lookup is O(filled); only the mask is dense, so this bounds the single
 * dense allocation. 50M cells ≈ 50 MB Uint8Array — well beyond any real MSI grid.
 */
const MAX_CELLS = 50_000_000;

/** A plain (Arrow-free) coordinate pair. */
export interface Coord {
  x: number;
  y: number;
}

/**
 * Build a sparse, diagnosable `ImagingGrid` from plain coordinates.
 *
 * @param coords           per-spectrum {x,y} (1-based by spec, but base is READ from geometry)
 * @param spectrumIndices  parallel array: spectrumIndices[i] is the spectrum index for coords[i]
 * @param geometry         declared extent / pixel size / coordinate base (declared extent WINS)
 * @param coordSourceStrategy which CoordSource won (surfaced in diagnostics)
 * @returns the grid, or `null` when coords is empty (non-imaging is a valid null state)
 *          or when the declared/observed extent exceeds the DoS cap.
 */
export function buildImagingGrid(
  coords: Coord[],
  spectrumIndices: number[],
  geometry: GridGeometry | null,
  coordSourceStrategy: CoordSourceStrategy,
): ImagingGrid | null {
  // Non-imaging / empty: a valid null state, not an error.
  if (coords.length === 0) {
    return null;
  }

  // Read the base from geometry — NEVER hard-code −1.
  const coordinateBase = geometry?.coordinateBase ?? 1;

  // Normalize every coord ONCE to a 0-based integer cell; non-finite → NaN. Floor: MSI coords
  // are whole pixels, but a fractional value from a malformed file would otherwise produce a
  // non-integer Map key and a mask write that matches no real cell.
  const n = Math.min(coords.length, spectrumIndices.length);
  const cellX = new Float64Array(n), cellY = new Float64Array(n);
  let observedMaxX = 0, observedMaxY = 0; // observed extent (cells), for the canvas fallback
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(coords[i]!.x - coordinateBase), cy = Math.floor(coords[i]!.y - coordinateBase);
    const ok = Number.isFinite(cx) && Number.isFinite(cy);
    cellX[i] = ok ? cx : NaN;
    cellY[i] = ok ? cy : NaN;
    if (ok && cx + 1 > observedMaxX) observedMaxX = cx + 1;
    if (ok && cy + 1 > observedMaxY) observedMaxY = cy + 1;
  }

  // The CANVAS is the declared extent (it WINS over the observed max; coords beyond it are
  // skipped) — or the observed max without one. Optical registrations refer to it.
  const declared = geometry?.pixelCount ?? null;
  const canvasWidth = Math.floor(declared?.x ?? observedMaxX);
  const canvasHeight = Math.floor(declared?.y ?? observedMaxY);
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth <= 0 || canvasHeight <= 0) {
    return null;
  }
  const inCanvas = (i: number) => cellX[i]! >= 0 && cellY[i]! >= 0 && cellX[i]! < canvasWidth && cellY[i]! < canvasHeight;

  // The GRID is the occupied part of the canvas: the bounding box of the in-range coords. A run
  // that declares 735×259 but acquired only x 675–735, y 177–259 rendered as a small patch in a
  // corner of a black canvas; the MS views show the true extent of the MS data instead.
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let i = 0; i < n; i++) {
    if (!inCanvas(i)) continue; // NaN fails every comparison
    minX = Math.min(minX, cellX[i]!); maxX = Math.max(maxX, cellX[i]!);
    minY = Math.min(minY, cellY[i]!); maxY = Math.max(maxY, cellY[i]!);
  }
  if (maxX < 0) return null; // no coordinate inside the canvas
  const offsetX = minX, offsetY = minY;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const extentSource: GridDiagnostics["extentSource"] = declared ? "declared" : "max-coord";

  const totalCells = width * height;
  if (totalCells > MAX_CELLS) {
    console.warn(
      `buildImagingGrid: refusing ${width}×${height} = ${totalCells} cells ` +
        `(exceeds DoS cap of ${MAX_CELLS}); returning null.`,
    );
    return null;
  }

  // Sparse model: a Map lookup + a dense boolean presence mask.
  const coordToSpectrumIndex = new Map<number, number>();
  const presenceMask = new Uint8Array(totalCells);

  let duplicateCount = 0;
  let oobCount = 0;
  if (coords.length !== spectrumIndices.length) {
    // Mismatch is a caller bug; surface it in diagnostics rather than silently truncating.
    console.warn(
      `buildImagingGrid: coords.length (${coords.length}) !== spectrumIndices.length (${spectrumIndices.length}); processing ${n} pairs`,
    );
  }
  for (let i = 0; i < n; i++) {
    // Non-finite or outside the canvas: skipped and counted.
    if (!inCanvas(i)) {
      oobCount++;
      continue;
    }
    const x0 = cellX[i]! - offsetX, y0 = cellY[i]! - offsetY; // grid-local
    const key = y0 * width + x0; // row-major: row=y, col=x (col=position_x, row=position_y)
    if (coordToSpectrumIndex.has(key)) {
      // Keep the first writer; do not silently overwrite.
      duplicateCount++;
      continue;
    }
    coordToSpectrumIndex.set(key, spectrumIndices[i]!);
    presenceMask[key] = 1;
  }

  const filledCount = coordToSpectrumIndex.size;
  const missingCount = totalCells - filledCount;

  // Declared-vs-observed disagreement note: flag when a declared extent is
  // present AND coords reach beyond it on either axis.
  let discoveryDisagreement: string | null = null;
  if (
    declared &&
    (declared.x < observedMaxX || declared.y < observedMaxY)
  ) {
    discoveryDisagreement =
      `Declared extent ${declared.x}×${declared.y} is smaller than the ` +
      `observed coordinate span ${observedMaxX}×${observedMaxY}; ` +
      `declared extent wins (C4) and out-of-range coordinates were skipped.`;
  }

  const diagnostics: GridDiagnostics = {
    // Use `n` (the processed count) not `coords.length` — when the lengths
    // differ due to a broken reader-boundary join, `coords.length` overstates
    // the actually-joined pairs and hides the truncation in diagnostics.
    spectrumCount: n,
    uniqueCoordCount: filledCount,
    duplicateCount,
    missingCount,
    oobCount,
    extentSource,
    geometrySource: geometry?.geometrySource ?? "derived",
    discoveryDisagreement,
  };

  return {
    width,
    height,
    coordinateBase,
    canvas: { width: canvasWidth, height: canvasHeight, offsetX, offsetY },
    pixelSizeUm: geometry?.pixelSizeUm ?? null,
    pixelSizeSource: geometry?.pixelSizeSource ?? null,
    coordToSpectrumIndex,
    presenceMask,
    filledCount,
    totalCells,
    coordSourceStrategy,
    diagnostics,
  };
}
