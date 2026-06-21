// Public API of the spectrum-plot cluster.

// The component + its prop/data types.
export { SpectrumPlot } from "./SpectrumPlot";
export type { ReporterMarker } from "./SpectrumPlot";

// UV/VIS (wavelength) spectrum plot — separate from the MS SpectrumPlot.
export { WavelengthSpectrumPlot } from "./WavelengthSpectrumPlot";
export type { WavelengthPlotMode } from "./WavelengthSpectrumPlot";

// PDA/DAD derived views over the time×wavelength matrix: chromatogram traces
// (max / extracted single-λ) and the 2D viridis heatmap.
export { WavelengthChromatogramPlot } from "./WavelengthChromatogramPlot";
export { WavelengthHeatmap } from "./WavelengthHeatmap";

// Chromatogram navigator (time vs intensity, click-to-pick).
export { ChromPlot } from "./ChromPlot";
export type { ChromPoint } from "./ChromPlot";

// 2-D ion-mobility frame heatmap (m/z × 1/K0) for timsTOF / IMS spectra.
export { MobilityFrameHeatmap } from "./MobilityFrameHeatmap";

// Spectrum data shape the plot consumes (contracts wire shape + `representation`).
export type { SpectrumArrays, Representation } from "./peaks";

// Reusable peak-picking helpers.
export { nearestPeakIndex } from "./peaks";

// Reusable chart-theme helpers (palette, axes, range, formatting).
export { xRange, finiteExtent, compactIntensity, stageAxes } from "./chartTheme";
