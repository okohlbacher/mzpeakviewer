// Public API of the spectrum-plot cluster.

// The component + its prop/data types.
export { SpectrumPlot } from "./SpectrumPlot";
export type { ReporterMarker } from "./SpectrumPlot";

// Chromatogram navigator (time vs intensity, click-to-pick).
export { ChromPlot } from "./ChromPlot";
export type { ChromPoint } from "./ChromPlot";

// Multi-trace chromatogram overlay (DIA fragment peak group).
export { MultiChromPlot } from "./MultiChromPlot";
export type { ChromTrace } from "./MultiChromPlot";

// Spectrum data shape the plot consumes (contracts wire shape + `representation`).
export type { SpectrumArrays, Representation } from "./peaks";

// Reusable peak-picking helpers.
export { topPeakIndices, nearestPeakIndex } from "./peaks";

// Reusable chart-theme helpers (palette, axes, range, formatting).
export { STAGE, xRange, finiteExtent, compactIntensity, stageAxes } from "./chartTheme";

// uPlot interaction plugin (wheel-zoom / middle-drag pan).
export { wheelZoomPlugin } from "./uplotZoom";

// uPlot lifecycle hook shared by spectrum/chromatogram plots.
export { useUplot } from "./useUplot";
