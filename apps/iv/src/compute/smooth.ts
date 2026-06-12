// smooth.ts — BL-04: separable 2D Gaussian smoothing for Float32Array ion images.
//
// Pure compute module: no external dependencies, no side effects, no mutations of
// the input array. Absent pixels (presenceMask[k] === 0) are excluded from both
// the weighted sum AND the denominator so they do not bleed intensity into
// neighboring present pixels.

/**
 * Build a 1D Gaussian kernel of half-width `radius` (full length = 2*radius+1).
 *
 * Weights are `exp(-(i*i) / (2*sigma*sigma))` for i in [-radius, radius] and
 * are normalized so that the full kernel sums to 1. The center element is at
 * index `radius`.
 */
function buildKernel(sigma: number, radius: number): Float64Array {
  const size = 2 * radius + 1;
  const k = new Float64Array(size);
  const denom = 2 * sigma * sigma;
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const d = i - radius;
    k[i] = Math.exp(-(d * d) / denom);
    sum += k[i];
  }
  // Normalize.
  for (let i = 0; i < size; i++) {
    k[i] /= sum;
  }
  return k;
}

/**
 * Apply a 1D Gaussian kernel row-wise (horizontal pass) to a row-major
 * Float32Array image, respecting the presence mask.
 *
 * Absent pixels (presenceMask[y*width+x] === 0) contribute 0 to weighted sums
 * and are excluded from the normalization denominator. The output value for an
 * absent pixel is left as 0; only present pixels receive a smoothed value.
 *
 * Boundary handling: clamp-to-edge (out-of-bounds column indices are clamped to
 * [0, width-1]).
 */
function gaussianRows(
  src: Float32Array,
  width: number,
  height: number,
  presenceMask: Uint8Array,
  kernel: Float64Array,
  radius: number,
): Float32Array {
  const dst = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      const k = rowBase + x;
      if (presenceMask[k] === 0) {
        // Absent pixel — output stays 0; don't smooth into it.
        continue;
      }
      let weightedSum = 0;
      let weightSum = 0;
      for (let d = -radius; d <= radius; d++) {
        // Clamp source column to [0, width-1].
        const sx = Math.max(0, Math.min(width - 1, x + d));
        const sk = rowBase + sx;
        if (presenceMask[sk] === 0) {
          // Absent neighbour: exclude weight entirely (no bleed).
          continue;
        }
        const w = kernel[d + radius];
        weightedSum += w * src[sk];
        weightSum += w;
      }
      dst[k] = weightSum > 0 ? weightedSum / weightSum : src[k];
    }
  }
  return dst;
}

/**
 * Apply a 1D Gaussian kernel column-wise (vertical pass) to a row-major
 * Float32Array image, respecting the presence mask.
 *
 * Same absent-pixel exclusion and clamp-to-edge logic as `gaussianRows`.
 */
function gaussianCols(
  src: Float32Array,
  width: number,
  height: number,
  presenceMask: Uint8Array,
  kernel: Float64Array,
  radius: number,
): Float32Array {
  const dst = new Float32Array(src.length);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const k = y * width + x;
      if (presenceMask[k] === 0) {
        continue;
      }
      let weightedSum = 0;
      let weightSum = 0;
      for (let d = -radius; d <= radius; d++) {
        // Clamp source row to [0, height-1].
        const sy = Math.max(0, Math.min(height - 1, y + d));
        const sk = sy * width + x;
        if (presenceMask[sk] === 0) {
          continue;
        }
        const w = kernel[d + radius];
        weightedSum += w * src[sk];
        weightSum += w;
      }
      dst[k] = weightSum > 0 ? weightedSum / weightSum : src[k];
    }
  }
  return dst;
}

/**
 * Apply separable 2D Gaussian smoothing to a row-major Float32Array ion image.
 *
 * The smoothing is performed as two separable 1D passes (row-wise then
 * column-wise) — mathematically equivalent to a 2D Gaussian convolution but
 * O(width * height * radius) instead of O(width * height * radius^2).
 *
 * Absent pixels (presenceMask[k] === 0) are excluded from both the weighted sum
 * AND the normalization denominator during each pass, so they cannot bleed
 * intensity into neighboring present pixels. The output value at an absent
 * pixel position is always 0.
 *
 * Kernel radius is `Math.ceil(3 * sigma)` (minimum 1), giving coverage to
 * ±3σ — capturing >99.7 % of the Gaussian mass.
 *
 * @param image       Row-major Float32Array of length `width * height`.
 * @param width       Number of columns.
 * @param height      Number of rows.
 * @param presenceMask Uint8Array of length `width * height`; 1 = pixel present.
 * @param sigma       Standard deviation of the Gaussian in pixels.
 *                    Pass 0 (or any non-positive value) to skip smoothing.
 * @returns A new Float32Array of the same length; the input is never mutated.
 */
export function gaussianSmooth(
  image: Float32Array,
  width: number,
  height: number,
  presenceMask: Uint8Array,
  sigma: number,
): Float32Array {
  // Early exit: sigma ≤ 0 means no smoothing — return a copy so callers always
  // get a new buffer and can never accidentally mutate the source.
  if (sigma <= 0) {
    return image.slice();
  }

  const radius = Math.max(1, Math.ceil(3 * sigma));
  const kernel = buildKernel(sigma, radius);

  // Two separable passes: horizontal then vertical.
  const afterRows = gaussianRows(image, width, height, presenceMask, kernel, radius);
  return gaussianCols(afterRows, width, height, presenceMask, kernel, radius);
}
