// Engine multi-channel ion-image render: the RGB-overlay primitive.
//
// The position-aligned, null-in→null-out multi-window render. Reads the file ONCE per render
// and accumulates every channel's windowed intensity in a single streamed pass over
// spectra_data. `engineRenderMultiChannel` lives alongside the single-channel primitive in
// ./imaging so it shares the streamed build, the compact ion cache (built once and reused —
// cold streams ONCE not per-channel, warm re-sums from cache instantly), the MS1 gate, and
// the progressive-preview machinery. Each channel's pixel values stay byte-identical to a
// standalone `engineRenderIonImage`. Nothing here imports mzpeakts.
export {
  engineRenderMultiChannel,
  type MultiChannelSpec,
  type RenderMultiChannelOptions,
} from "./imaging";
