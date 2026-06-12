// Engine multi-channel ion-image render: the RGB-overlay primitive.
//
// HARVESTED from mzPeakIV's compute/worker layer (the read-only mzPeakIV tree):
//   - engineRenderMultiChannel ← src/worker/mzPeakWorker.ts `renderMultiChannel`
//     handler + `computeMultiIonImagesFast` (the position-aligned, null-in→null-out
//     multi-window render).
//
// IV's worker reads the file ONCE per render and accumulates every channel's
// windowed intensity in a single streamed pass over spectra_data row groups
// (`computeMultiIonImagesFast`) — a speed optimization that avoids re-reading the
// (possibly large, networked) archive once per channel. The engine layer here reads
// per-spectrum through the reader (engineRenderIonImage), so the faithful, correct
// reuse is to render each non-null channel via the SAME per-channel window-sum
// (`engineRenderIonImage`) and keep the result position-aligned with `channels`.
// The per-channel pixel values are byte-identical to IV's: same DATA-ARRAY source,
// same inclusive `[mz - tolDa, mz + tolDa]` window, same coord→spectrum mapping.
// Only the read STRATEGY differs (per-spectrum vs one streamed pass); the OUTPUT does
// not. Nothing here imports mzpeakts.

import type { ImagingGridWire } from "@mzpeak/contracts";
import { engineRenderIonImage } from "./imaging";
import type { Reader } from "../reader/openUrl";

/** One channel of a multi-channel overlay (mirrors contracts' ChannelRequest core). */
export type MultiChannelSpec = { mz: number; tolDa: number };

/**
 * Render an RGB-overlay's worth of ion images: one per channel SLOT, POSITION-ALIGNED
 * with `channels`. A non-null channel renders its ion image (the EXACT per-channel
 * window-sum of `engineRenderIonImage`: for each filled grid cell, sum the cell's
 * DATA-ARRAY intensity within `[mz - tolDa, mz + tolDa]` inclusive, written at the
 * cell's coordKey). A null channel maps to a null result slot — matching IV's
 * `computeMultiIonImagesFast` (null window in → null image out).
 *
 * Returns a `(Float32Array | null)[]` of `channels.length` entries: each non-null
 * entry is a dense `Float32Array(width*height)`; each null channel is `null`. The
 * caller (worker/dispatch) transfers the non-null buffers.
 */
export async function engineRenderMultiChannel(
  reader: Reader,
  gridWire: ImagingGridWire,
  channels: (MultiChannelSpec | null)[],
): Promise<(Float32Array | null)[]> {
  const out: (Float32Array | null)[] = new Array(channels.length).fill(null);
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    if (!ch) continue; // null slot → null result (position-aligned, IV parity)
    const { ionImage } = await engineRenderIonImage(reader, gridWire, ch.mz, ch.tolDa);
    out[c] = ionImage;
  }
  return out;
}
