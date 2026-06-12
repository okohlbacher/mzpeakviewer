// @mzpeak/ui-kit — unified design tokens + purely presentational components for the
// mzPeak viewer. No reader, no store, no imaging assumptions. Harvested from the two
// source apps (IV's `ds/` design system + Explorer's pure plot/tree/util components).
//
// Stylesheet: import "@mzpeak/ui-kit/styles.css" once in the app.

// Design-system primitives (from mzPeakIV ds/*)
export * from "./primitives";
// Spectrum plot stack (from mzPeakExplorer)
export * from "./spectrum";
// Metadata JSON tree (from mzPeakExplorer)
export * from "./tree";
// cv / format utilities (from mzPeakExplorer)
export * from "./utils";
