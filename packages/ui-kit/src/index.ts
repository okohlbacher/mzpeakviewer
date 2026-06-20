// @mzpeak/ui-kit — unified design tokens + purely presentational components for the
// mzPeak viewer. No reader, no store, no imaging assumptions.
//
// Stylesheet: import "@mzpeak/ui-kit/styles.css" once in the app.

// Design-system primitives
export * from "./primitives";
// Accessible interactive controls. Aliased to avoid a name clash with the
// primitives' tablist-flavored SegmentedControl: this radio-group variant is
// the one to use for value-selecting subtabs.
export {
  SegmentedControl as RadioSegmentedControl,
  type SegmentedControlProps as RadioSegmentedControlProps,
  type SegmentedControlOption as RadioSegmentedControlOption,
} from "./controls";
// Spectrum plot stack
export * from "./spectrum";
// Metadata JSON tree
export * from "./tree";
// cv / format utilities
export * from "./utils";
