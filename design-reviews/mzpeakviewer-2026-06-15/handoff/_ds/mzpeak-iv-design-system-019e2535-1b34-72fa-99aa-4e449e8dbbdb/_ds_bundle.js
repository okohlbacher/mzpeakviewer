/* @ds-bundle: {"format":3,"namespace":"MzPeakDesignSystem_019e25","components":[{"name":"Button","sourcePath":"components/controls/Button.jsx"},{"name":"SegmentedControl","sourcePath":"components/controls/SegmentedControl.jsx"},{"name":"Badge","sourcePath":"components/data/Badge.jsx"},{"name":"ColormapScale","sourcePath":"components/data/ColormapScale.jsx"},{"name":"Panel","sourcePath":"components/data/Panel.jsx"},{"name":"StatRow","sourcePath":"components/data/StatRow.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"NumberField","sourcePath":"components/forms/NumberField.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"}],"sourceHashes":{"components/controls/Button.jsx":"2109ee298dd2","components/controls/SegmentedControl.jsx":"8364ec68f463","components/data/Badge.jsx":"769cbf931989","components/data/ColormapScale.jsx":"b5d3ddb6b0a2","components/data/Panel.jsx":"0b4388c3af53","components/data/StatRow.jsx":"72172ea4e7ef","components/forms/Checkbox.jsx":"336037688c1b","components/forms/NumberField.jsx":"00d5c6160ca1","components/forms/Select.jsx":"4fef6c5a5e09","design_handoff_mzpeakiv_ds_sync/reference/ds-runtime-fallback.js":"17d0964f60a9","design_handoff_mzpeakiv_redesign/design-system/ds-runtime-fallback.js":"17d0964f60a9","design_handoff_mzpeakiv_redesign/prototype-reference/app.jsx":"eb8f36f5d0cd","design_handoff_mzpeakiv_redesign/prototype-reference/engine.js":"5c9bd1b0a2ea","design_handoff_mzpeakiv_redesign/prototype-reference/icons.js":"462841b029aa","design_handoff_mzpeakiv_redesign/prototype-reference/panels.jsx":"e2d76fb3efe9","design_handoff_mzpeakiv_redesign/prototype-reference/stage.jsx":"6553a6d80479","ds-runtime-fallback.js":"17d0964f60a9","ui_kits/mzpeak-iv/app.jsx":"fcfb3c851d9b","ui_kits/mzpeak-iv/engine.js":"635008569986","ui_kits/mzpeak-iv/icons.js":"462841b029aa","ui_kits/mzpeak-iv/panels.jsx":"1e3814031049","ui_kits/mzpeak-iv/stage.jsx":"ec28b6d05794"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.MzPeakDesignSystem_019e25 = window.MzPeakDesignSystem_019e25 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/controls/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — the primary action control for mzPeak interfaces.
 * Variants: primary (default), secondary (outline), ghost, danger.
 */
function Button({
  variant = "primary",
  size = "md",
  iconLeft = null,
  iconRight = null,
  block = false,
  className = "",
  children,
  ...rest
}) {
  const cls = ["mz-btn", variant !== "primary" ? `mz-btn--${variant}` : "", size === "sm" ? "mz-btn--sm" : "", !children ? "mz-btn--icon" : "", block ? "mz-btn--block" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    className: cls
  }, rest), iconLeft ? /*#__PURE__*/React.createElement("span", {
    className: "mz-ic",
    "aria-hidden": "true"
  }, iconLeft) : null, children, iconRight ? /*#__PURE__*/React.createElement("span", {
    className: "mz-ic",
    "aria-hidden": "true"
  }, iconRight) : null);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Button.jsx", error: String((e && e.message) || e) }); }

// components/controls/SegmentedControl.jsx
try { (() => {
/**
 * SegmentedControl — the connected tab/toggle group used throughout mzPeakIV
 * for view switching (Overview / Ion Image / Multi-channel), colormap and
 * scale selection. Single-select.
 *
 * @param {{value:string,label?:string,icon?:any}[]} options
 */
function SegmentedControl({
  options = [],
  value,
  onChange = () => {},
  size = "md",
  ariaLabel = "View",
  className = ""
}) {
  const cls = ["mz-seg", size === "sm" ? "mz-seg--sm" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", {
    className: cls,
    role: "tablist",
    "aria-label": ariaLabel
  }, options.map(opt => /*#__PURE__*/React.createElement("button", {
    key: opt.value,
    role: "tab",
    type: "button",
    "aria-selected": opt.value === value,
    className: "mz-seg__item",
    onClick: () => onChange(opt.value)
  }, opt.icon ? /*#__PURE__*/React.createElement("span", {
    className: "mz-ic",
    "aria-hidden": "true"
  }, opt.icon) : null, opt.label ?? opt.value)));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/data/Badge.jsx
try { (() => {
/**
 * Badge — compact status / metadata pill (mode, MS level, peak counts).
 */
function Badge({
  tone = "neutral",
  dot = false,
  mono = false,
  className = "",
  children
}) {
  const cls = ["mz-badge", `mz-badge--${tone}`, mono ? "mz-badge--mono" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", {
    className: cls
  }, dot ? /*#__PURE__*/React.createElement("span", {
    className: "mz-badge__dot",
    "aria-hidden": "true"
  }) : null, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Badge.jsx", error: String((e && e.message) || e) }); }

// components/data/ColormapScale.jsx
try { (() => {
/**
 * ColormapScale — the signature legend / scale bar for ion images. Renders the
 * perceptually-uniform gradient (viridis / inferno / gray / basepeak) with
 * low/high tick labels. Horizontal by default; vertical for a canvas-side rail.
 */
function ColormapScale({
  colormap = "viridis",
  low = "0",
  high = "max",
  orientation = "horizontal",
  onStage = false,
  className = ""
}) {
  const cls = ["mz-cmap", orientation === "vertical" ? "mz-cmap--vertical" : "", onStage ? "mz-cmap--stage" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("div", {
    className: cls
  }, /*#__PURE__*/React.createElement("div", {
    className: `mz-cmap__bar mz-cmap__bar--${colormap}`
  }), /*#__PURE__*/React.createElement("div", {
    className: "mz-cmap__ticks"
  }, /*#__PURE__*/React.createElement("span", null, low), /*#__PURE__*/React.createElement("span", null, high)));
}
Object.assign(__ds_scope, { ColormapScale });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ColormapScale.jsx", error: String((e && e.message) || e) }); }

// components/data/Panel.jsx
try { (() => {
const {
  useState
} = React;
const Chev = /*#__PURE__*/React.createElement("svg", {
  className: "mz-panel__chev",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2.4",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "m6 9 6 6 6-6"
}));

/**
 * Panel — a collapsible titled section for the inspector rail. Uncontrolled by
 * default (defaultOpen); pass `open` + `onToggle` to control it.
 */
function Panel({
  title,
  count = null,
  defaultOpen = true,
  open,
  onToggle,
  className = "",
  children
}) {
  const [internal, setInternal] = useState(defaultOpen);
  const isOpen = open ?? internal;
  const toggle = () => onToggle ? onToggle(!isOpen) : setInternal(v => !v);
  return /*#__PURE__*/React.createElement("section", {
    className: ["mz-panel", className].filter(Boolean).join(" "),
    "data-open": isOpen
  }, /*#__PURE__*/React.createElement("button", {
    className: "mz-panel__head",
    onClick: toggle,
    "aria-expanded": isOpen
  }, Chev, /*#__PURE__*/React.createElement("span", {
    className: "mz-panel__title"
  }, title), count != null ? /*#__PURE__*/React.createElement("span", {
    className: "mz-panel__count"
  }, count) : null), /*#__PURE__*/React.createElement("div", {
    className: "mz-panel__body"
  }, children));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Panel.jsx", error: String((e && e.message) || e) }); }

// components/data/StatRow.jsx
try { (() => {
/**
 * StatRow — a key/value row for the inspector. The value renders in mono,
 * tabular numerals. Pass a string or rich nodes; use <em> inside the value to
 * dim units (handled by the stylesheet).
 */
function StatRow({
  label,
  value,
  className = ""
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: ["mz-statrow", className].filter(Boolean).join(" ")
  }, /*#__PURE__*/React.createElement("span", {
    className: "mz-statrow__key"
  }, label), /*#__PURE__*/React.createElement("span", {
    className: "mz-statrow__val"
  }, value ?? /*#__PURE__*/React.createElement("em", null, "\u2014")));
}
Object.assign(__ds_scope, { StatRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatRow.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const Check = /*#__PURE__*/React.createElement("svg", {
  className: "mz-ic",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "3",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "M20 6 9 17l-5-5"
}));

/**
 * Checkbox — compact labelled toggle (TIC normalisation, overlay flags).
 */
function Checkbox({
  checked,
  onChange = () => {},
  label,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: ["mz-check", className].filter(Boolean).join(" ")
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    onChange: e => onChange(e.target.checked, e)
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "mz-check__box"
  }, Check), label ? /*#__PURE__*/React.createElement("span", null, label) : null);
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/NumberField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * NumberField — a monospace numeric input with an optional unit suffix (Da, µm,
 * ppm). Used for m/z ranges, tolerances and smoothing parameters.
 */
function NumberField({
  value,
  onChange = () => {},
  unit = null,
  size = "md",
  placeholder = "",
  width,
  className = "",
  ariaLabel,
  ...rest
}) {
  const cls = ["mz-input", size === "sm" ? "mz-input--sm" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", {
    className: cls,
    style: width ? {
      width
    } : undefined
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "number",
    inputMode: "decimal",
    value: value,
    placeholder: placeholder,
    "aria-label": ariaLabel,
    onChange: e => onChange(e.target.value, e)
  }, rest)), unit ? /*#__PURE__*/React.createElement("span", {
    className: "mz-input__unit"
  }, unit) : null);
}
Object.assign(__ds_scope, { NumberField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/NumberField.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const Chevron = /*#__PURE__*/React.createElement("svg", {
  className: "mz-select__chev",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2.2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "m6 9 6 6 6-6"
}));

/**
 * Select — a styled native dropdown for compact option sets (contrast mode,
 * percentile clip, export format).
 *
 * @param {{value:string,label:string}[]} options
 */
function Select({
  value,
  onChange = () => {},
  options = [],
  size = "md",
  ariaLabel,
  className = "",
  ...rest
}) {
  const cls = ["mz-select", size === "sm" ? "mz-select--sm" : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("span", {
    className: cls
  }, /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    "aria-label": ariaLabel,
    onChange: e => onChange(e.target.value, e)
  }, rest), options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label))), Chevron);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// design_handoff_mzpeakiv_ds_sync/reference/ds-runtime-fallback.js
try { (() => {
/* ──────────────────────────────────────────────────────────────────────────
   mzPeak DS — runtime fallback shim
   Defines window.MzPeakDesignSystem_019e25 with plain-JS (React.createElement)
   implementations of the 9 primitives, ONLY if the compiled _ds_bundle.js did
   not already provide them. Class names + props match the .jsx sources exactly,
   so cards/kits render identically whether or not the compiled bundle is served.
   Load this AFTER <script src="…/_ds_bundle.js"> and BEFORE any consumer code.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  if (window.MzPeakDesignSystem_019e25 && window.MzPeakDesignSystem_019e25.Button) return;
  if (typeof React === "undefined") {
    console.warn("[mzPeak DS] React not loaded before fallback shim");
    return;
  }
  const h = React.createElement;
  const cx = (...a) => a.filter(Boolean).join(" ");
  const svg = (attrs, d) => h("svg", Object.assign({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  }, attrs), h("path", {
    d
  }));
  function Button({
    variant = "primary",
    size = "md",
    iconLeft,
    iconRight,
    block,
    className = "",
    children,
    ...rest
  }) {
    const cls = cx("mz-btn", variant !== "primary" && "mz-btn--" + variant, size === "sm" && "mz-btn--sm", !children && "mz-btn--icon", block && "mz-btn--block", className);
    return h("button", Object.assign({
      className: cls
    }, rest), iconLeft && h("span", {
      className: "mz-ic",
      "aria-hidden": true
    }, iconLeft), children, iconRight && h("span", {
      className: "mz-ic",
      "aria-hidden": true
    }, iconRight));
  }
  function SegmentedControl({
    options = [],
    value,
    onChange = () => {},
    size = "md",
    ariaLabel = "View",
    className = ""
  }) {
    return h("div", {
      className: cx("mz-seg", size === "sm" && "mz-seg--sm", className),
      role: "tablist",
      "aria-label": ariaLabel
    }, options.map(o => h("button", {
      key: o.value,
      role: "tab",
      type: "button",
      "aria-selected": o.value === value,
      className: "mz-seg__item",
      onClick: () => onChange(o.value)
    }, o.icon && h("span", {
      className: "mz-ic",
      "aria-hidden": true
    }, o.icon), o.label != null ? o.label : o.value)));
  }
  function NumberField({
    value,
    onChange = () => {},
    unit,
    size = "md",
    placeholder = "",
    width,
    className = "",
    ariaLabel,
    ...rest
  }) {
    return h("span", {
      className: cx("mz-input", size === "sm" && "mz-input--sm", className),
      style: width ? {
        width
      } : undefined
    }, h("input", Object.assign({
      type: "number",
      inputMode: "decimal",
      value,
      placeholder,
      "aria-label": ariaLabel,
      onChange: e => onChange(e.target.value, e)
    }, rest)), unit && h("span", {
      className: "mz-input__unit"
    }, unit));
  }
  function Select({
    value,
    onChange = () => {},
    options = [],
    size = "md",
    ariaLabel,
    className = "",
    ...rest
  }) {
    return h("span", {
      className: cx("mz-select", size === "sm" && "mz-select--sm", className)
    }, h("select", Object.assign({
      value,
      "aria-label": ariaLabel,
      onChange: e => onChange(e.target.value, e)
    }, rest), options.map(o => h("option", {
      key: o.value,
      value: o.value
    }, o.label))), svg({
      className: "mz-select__chev",
      strokeWidth: 2.2
    }, "m6 9 6 6 6-6"));
  }
  function Checkbox({
    checked,
    onChange = () => {},
    label,
    className = "",
    ...rest
  }) {
    return h("label", {
      className: cx("mz-check", className)
    }, h("input", Object.assign({
      type: "checkbox",
      checked,
      onChange: e => onChange(e.target.checked, e)
    }, rest)), h("span", {
      className: "mz-check__box"
    }, svg({
      className: "mz-ic",
      strokeWidth: 3
    }, "M20 6 9 17l-5-5")), label && h("span", null, label));
  }
  function Badge({
    tone = "neutral",
    dot,
    mono,
    className = "",
    children
  }) {
    return h("span", {
      className: cx("mz-badge", "mz-badge--" + tone, mono && "mz-badge--mono", className)
    }, dot && h("span", {
      className: "mz-badge__dot",
      "aria-hidden": true
    }), children);
  }
  function StatRow({
    label,
    value,
    className = ""
  }) {
    return h("div", {
      className: cx("mz-statrow", className)
    }, h("span", {
      className: "mz-statrow__key"
    }, label), h("span", {
      className: "mz-statrow__val"
    }, value != null ? value : h("em", null, "—")));
  }
  function ColormapScale({
    colormap = "viridis",
    low = "0",
    high = "max",
    orientation = "horizontal",
    onStage,
    className = ""
  }) {
    return h("div", {
      className: cx("mz-cmap", orientation === "vertical" && "mz-cmap--vertical", onStage && "mz-cmap--stage", className)
    }, h("div", {
      className: "mz-cmap__bar mz-cmap__bar--" + colormap
    }), h("div", {
      className: "mz-cmap__ticks"
    }, h("span", null, low), h("span", null, high)));
  }
  function Panel({
    title,
    count,
    defaultOpen = true,
    open,
    onToggle,
    className = "",
    children
  }) {
    const [internal, setInternal] = React.useState(defaultOpen);
    const isOpen = open != null ? open : internal;
    const toggle = () => onToggle ? onToggle(!isOpen) : setInternal(v => !v);
    return h("section", {
      className: cx("mz-panel", className),
      "data-open": isOpen
    }, h("button", {
      className: "mz-panel__head",
      onClick: toggle,
      "aria-expanded": isOpen
    }, svg({
      className: "mz-panel__chev",
      strokeWidth: 2.4
    }, "m6 9 6 6 6-6"), h("span", {
      className: "mz-panel__title"
    }, title), count != null && h("span", {
      className: "mz-panel__count"
    }, count)), h("div", {
      className: "mz-panel__body"
    }, children));
  }
  window.MzPeakDesignSystem_019e25 = Object.assign(window.MzPeakDesignSystem_019e25 || {}, {
    Button,
    SegmentedControl,
    NumberField,
    Select,
    Checkbox,
    Badge,
    StatRow,
    ColormapScale,
    Panel
  });
  console.info("[mzPeak DS] using runtime fallback shim (compiled bundle not served)");
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "design_handoff_mzpeakiv_ds_sync/reference/ds-runtime-fallback.js", error: String((e && e.message) || e) }); }

// design_handoff_mzpeakiv_redesign/design-system/ds-runtime-fallback.js
try { (() => {
/* ──────────────────────────────────────────────────────────────────────────
   mzPeak DS — runtime fallback shim
   Defines window.MzPeakDesignSystem_019e25 with plain-JS (React.createElement)
   implementations of the 9 primitives, ONLY if the compiled _ds_bundle.js did
   not already provide them. Class names + props match the .jsx sources exactly,
   so cards/kits render identically whether or not the compiled bundle is served.
   Load this AFTER <script src="…/_ds_bundle.js"> and BEFORE any consumer code.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  if (window.MzPeakDesignSystem_019e25 && window.MzPeakDesignSystem_019e25.Button) return;
  if (typeof React === "undefined") {
    console.warn("[mzPeak DS] React not loaded before fallback shim");
    return;
  }
  const h = React.createElement;
  const cx = (...a) => a.filter(Boolean).join(" ");
  const svg = (attrs, d) => h("svg", Object.assign({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  }, attrs), h("path", {
    d
  }));
  function Button({
    variant = "primary",
    size = "md",
    iconLeft,
    iconRight,
    block,
    className = "",
    children,
    ...rest
  }) {
    const cls = cx("mz-btn", variant !== "primary" && "mz-btn--" + variant, size === "sm" && "mz-btn--sm", !children && "mz-btn--icon", block && "mz-btn--block", className);
    return h("button", Object.assign({
      className: cls
    }, rest), iconLeft && h("span", {
      className: "mz-ic",
      "aria-hidden": true
    }, iconLeft), children, iconRight && h("span", {
      className: "mz-ic",
      "aria-hidden": true
    }, iconRight));
  }
  function SegmentedControl({
    options = [],
    value,
    onChange = () => {},
    size = "md",
    ariaLabel = "View",
    className = ""
  }) {
    return h("div", {
      className: cx("mz-seg", size === "sm" && "mz-seg--sm", className),
      role: "tablist",
      "aria-label": ariaLabel
    }, options.map(o => h("button", {
      key: o.value,
      role: "tab",
      type: "button",
      "aria-selected": o.value === value,
      className: "mz-seg__item",
      onClick: () => onChange(o.value)
    }, o.icon && h("span", {
      className: "mz-ic",
      "aria-hidden": true
    }, o.icon), o.label != null ? o.label : o.value)));
  }
  function NumberField({
    value,
    onChange = () => {},
    unit,
    size = "md",
    placeholder = "",
    width,
    className = "",
    ariaLabel,
    ...rest
  }) {
    return h("span", {
      className: cx("mz-input", size === "sm" && "mz-input--sm", className),
      style: width ? {
        width
      } : undefined
    }, h("input", Object.assign({
      type: "number",
      inputMode: "decimal",
      value,
      placeholder,
      "aria-label": ariaLabel,
      onChange: e => onChange(e.target.value, e)
    }, rest)), unit && h("span", {
      className: "mz-input__unit"
    }, unit));
  }
  function Select({
    value,
    onChange = () => {},
    options = [],
    size = "md",
    ariaLabel,
    className = "",
    ...rest
  }) {
    return h("span", {
      className: cx("mz-select", size === "sm" && "mz-select--sm", className)
    }, h("select", Object.assign({
      value,
      "aria-label": ariaLabel,
      onChange: e => onChange(e.target.value, e)
    }, rest), options.map(o => h("option", {
      key: o.value,
      value: o.value
    }, o.label))), svg({
      className: "mz-select__chev",
      strokeWidth: 2.2
    }, "m6 9 6 6 6-6"));
  }
  function Checkbox({
    checked,
    onChange = () => {},
    label,
    className = "",
    ...rest
  }) {
    return h("label", {
      className: cx("mz-check", className)
    }, h("input", Object.assign({
      type: "checkbox",
      checked,
      onChange: e => onChange(e.target.checked, e)
    }, rest)), h("span", {
      className: "mz-check__box"
    }, svg({
      className: "mz-ic",
      strokeWidth: 3
    }, "M20 6 9 17l-5-5")), label && h("span", null, label));
  }
  function Badge({
    tone = "neutral",
    dot,
    mono,
    className = "",
    children
  }) {
    return h("span", {
      className: cx("mz-badge", "mz-badge--" + tone, mono && "mz-badge--mono", className)
    }, dot && h("span", {
      className: "mz-badge__dot",
      "aria-hidden": true
    }), children);
  }
  function StatRow({
    label,
    value,
    className = ""
  }) {
    return h("div", {
      className: cx("mz-statrow", className)
    }, h("span", {
      className: "mz-statrow__key"
    }, label), h("span", {
      className: "mz-statrow__val"
    }, value != null ? value : h("em", null, "—")));
  }
  function ColormapScale({
    colormap = "viridis",
    low = "0",
    high = "max",
    orientation = "horizontal",
    onStage,
    className = ""
  }) {
    return h("div", {
      className: cx("mz-cmap", orientation === "vertical" && "mz-cmap--vertical", onStage && "mz-cmap--stage", className)
    }, h("div", {
      className: "mz-cmap__bar mz-cmap__bar--" + colormap
    }), h("div", {
      className: "mz-cmap__ticks"
    }, h("span", null, low), h("span", null, high)));
  }
  function Panel({
    title,
    count,
    defaultOpen = true,
    open,
    onToggle,
    className = "",
    children
  }) {
    const [internal, setInternal] = React.useState(defaultOpen);
    const isOpen = open != null ? open : internal;
    const toggle = () => onToggle ? onToggle(!isOpen) : setInternal(v => !v);
    return h("section", {
      className: cx("mz-panel", className),
      "data-open": isOpen
    }, h("button", {
      className: "mz-panel__head",
      onClick: toggle,
      "aria-expanded": isOpen
    }, svg({
      className: "mz-panel__chev",
      strokeWidth: 2.4
    }, "m6 9 6 6 6-6"), h("span", {
      className: "mz-panel__title"
    }, title), count != null && h("span", {
      className: "mz-panel__count"
    }, count)), h("div", {
      className: "mz-panel__body"
    }, children));
  }
  window.MzPeakDesignSystem_019e25 = Object.assign(window.MzPeakDesignSystem_019e25 || {}, {
    Button,
    SegmentedControl,
    NumberField,
    Select,
    Checkbox,
    Badge,
    StatRow,
    ColormapScale,
    Panel
  });
  console.info("[mzPeak DS] using runtime fallback shim (compiled bundle not served)");
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "design_handoff_mzpeakiv_redesign/design-system/ds-runtime-fallback.js", error: String((e && e.message) || e) }); }

// design_handoff_mzpeakiv_redesign/prototype-reference/app.jsx
try { (() => {
/* mzPeak IV — app orchestrator + per-view toolbar. Mounts into #root. */
const DSx = window.MzPeakDesignSystem_019e25;
const {
  Button: B3,
  SegmentedControl: Seg3,
  NumberField: NF3
} = DSx;
const MZ = window.MZ;
function Toolbar(props) {
  const {
    view,
    setView,
    ovMode,
    setOvMode,
    s,
    mzStart,
    setMzStart,
    mzEnd,
    setMzEnd,
    onShowIon,
    mc,
    setMc,
    onRenderMulti,
    setColormap,
    onExport
  } = props;
  const I = window.Icons;
  return /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement(Seg3, {
    ariaLabel: "View",
    value: view,
    onChange: setView,
    options: [{
      value: "overview",
      label: "Overview",
      icon: /*#__PURE__*/React.createElement(I.Grid, {
        size: 13
      })
    }, {
      value: "ion",
      label: "Ion Image",
      icon: /*#__PURE__*/React.createElement(I.Image, {
        size: 13
      })
    }, {
      value: "multi",
      label: "Multi-channel",
      icon: /*#__PURE__*/React.createElement(I.Layers, {
        size: 13
      })
    }]
  }), /*#__PURE__*/React.createElement("div", {
    className: "toolbar__sep"
  }), view === "overview" && /*#__PURE__*/React.createElement(Seg3, {
    size: "sm",
    ariaLabel: "Overview mode",
    value: ovMode,
    onChange: setOvMode,
    options: [{
      value: "tic",
      label: "TIC"
    }, {
      value: "basepeak",
      label: "Base-peak m/z"
    }]
  }), view === "ion" && /*#__PURE__*/React.createElement("div", {
    className: "toolbar__group"
  }, /*#__PURE__*/React.createElement("span", {
    className: "toolbar__lbl"
  }, "m/z"), /*#__PURE__*/React.createElement(NF3, {
    size: "sm",
    width: "84px",
    value: mzStart,
    onChange: setMzStart,
    ariaLabel: "m/z start"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-faint)"
    }
  }, "\u2013"), /*#__PURE__*/React.createElement(NF3, {
    size: "sm",
    width: "84px",
    value: mzEnd,
    onChange: setMzEnd,
    unit: "Da",
    ariaLabel: "m/z end"
  }), /*#__PURE__*/React.createElement(B3, {
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(I.Image, {
      size: 14
    }),
    onClick: onShowIon
  }, "Show Ion Image")), view === "multi" && /*#__PURE__*/React.createElement("div", {
    className: "toolbar__group"
  }, ["r", "g", "b"].map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    className: "mc-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mc-sw",
    style: {
      background: c === "r" ? "var(--channel-r)" : c === "g" ? "var(--channel-g)" : "var(--channel-b)"
    }
  }), /*#__PURE__*/React.createElement(NF3, {
    size: "sm",
    width: "78px",
    value: mc[c],
    onChange: v => setMc({
      ...mc,
      [c]: v
    }),
    ariaLabel: c + " m/z"
  }))), /*#__PURE__*/React.createElement(B3, {
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(I.Layers, {
      size: 14
    }),
    onClick: onRenderMulti
  }, "Render")), /*#__PURE__*/React.createElement("div", {
    className: "toolbar__spacer"
  }), view === "overview" && ovMode === "tic" || view === "ion" ? /*#__PURE__*/React.createElement(Seg3, {
    size: "sm",
    ariaLabel: "Colormap",
    value: s.colormap,
    onChange: setColormap,
    options: [{
      value: "viridis",
      label: "viridis"
    }, {
      value: "inferno",
      label: "inferno"
    }, {
      value: "gray",
      label: "gray"
    }]
  }) : null, (view === "ion" || view === "multi") && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "toolbar__sep"
  }), /*#__PURE__*/React.createElement(B3, {
    variant: "secondary",
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(I.Download, {
      size: 14
    }),
    onClick: onExport
  }, "TIFF")));
}
function App() {
  const [loaded, setLoaded] = React.useState(false);
  const [view, setView] = React.useState("overview");
  const [ovMode, setOvMode] = React.useState("tic");
  const [s, setS] = React.useState({
    colormap: "viridis",
    scale: "linear",
    percentile: 0.99,
    contrast: "none",
    ticNorm: false,
    smooth: "0"
  });
  const set = p => setS(o => ({
    ...o,
    ...p
  }));
  const [mzStart, setMzStart] = React.useState("740.00");
  const [mzEnd, setMzEnd] = React.useState("742.00");
  const [ion, setIon] = React.useState({
    field: MZ.ION["740.50"],
    key: "ion740",
    center: 741,
    tol: 1
  });
  const [mc, setMc] = React.useState({
    r: "772.52",
    g: "740.50",
    b: "798.54"
  });
  const [mcFields, setMcFields] = React.useState({
    r: MZ.ION["772.52"],
    g: MZ.ION["740.50"],
    b: MZ.ION["798.54"]
  });
  const [mcKey, setMcKey] = React.useState("mc0");
  const [sel, setSel] = React.useState(null);
  const [meanActive, setMean] = React.useState(false);
  const [settingsOpen, setSettings] = React.useState(false);
  const [railOpen, setRail] = React.useState(typeof window !== "undefined" && window.innerWidth > 1040);
  const [isWide, setIsWide] = React.useState(typeof window !== "undefined" && window.innerWidth > 1040);
  React.useEffect(() => {
    const f = () => setIsWide(window.innerWidth > 1040);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const showRail = loaded && (isWide || railOpen);
  const opt = {
    colormap: s.colormap,
    scale: s.scale,
    percentile: s.percentile
  };

  // Build the painter for the current view
  const painter = React.useMemo(() => {
    if (view === "overview" && ovMode === "basepeak") {
      const lo = Math.min(...MZ.MZS),
        hi = Math.max(...MZ.MZS);
      return {
        paint: c => MZ.paintBasePeak(c),
        field: MZ.BASEPEAK,
        colormap: "basepeak",
        low: String(lo.toFixed(0)),
        high: String(hi.toFixed(0)),
        key: "bp"
      };
    }
    if (view === "ion") {
      return {
        paint: c => MZ.paint(c, ion.field, opt),
        field: ion.field,
        colormap: s.colormap,
        low: "0",
        high: "max",
        key: "ion|" + ion.key + "|" + JSON.stringify(opt)
      };
    }
    if (view === "multi") {
      return {
        paint: c => MZ.paintMulti(c, mcFields),
        field: mcFields.g,
        colormap: null,
        low: null,
        high: null,
        key: "multi|" + mcKey
      };
    }
    // overview TIC
    return {
      paint: c => MZ.paint(c, MZ.TIC, opt),
      field: MZ.TIC,
      colormap: s.colormap,
      low: "0",
      high: "max",
      key: "tic|" + JSON.stringify(opt)
    };
  }, [view, ovMode, s, ion, mcFields, mcKey]);
  React.useEffect(() => {
    window.setCurrentField(painter.field);
  }, [painter]);
  function onShowIon() {
    const a = parseFloat(mzStart),
      b = parseFloat(mzEnd);
    if (!isFinite(a) || !isFinite(b) || b <= a) return;
    const c = (a + b) / 2,
      tol = (b - a) / 2;
    let best = MZ.MZS[0];
    MZ.MZS.forEach(m => {
      if (Math.abs(m - c) < Math.abs(best - c)) best = m;
    });
    setIon({
      field: MZ.ION[best.toFixed(2)],
      key: "i" + c.toFixed(2),
      center: c,
      tol: Math.max(tol, 0.25)
    });
  }
  function onRenderMulti() {
    const pick = v => {
      let best = MZ.MZS[0];
      MZ.MZS.forEach(m => {
        if (Math.abs(m - parseFloat(v)) < Math.abs(best - parseFloat(v))) best = m;
      });
      return MZ.ION[best.toFixed(2)];
    };
    setMcFields({
      r: pick(mc.r),
      g: pick(mc.g),
      b: pick(mc.b)
    });
    setMcKey("mc" + Date.now());
  }
  function onExport() {
    const c = document.querySelector(".imgframe canvas");
    if (!c) return;
    const a = document.createElement("a");
    a.download = "ion-image.png";
    a.href = c.toDataURL("image/png");
    a.click();
  }
  function onPick(cell) {
    setSel(cell);
    setMean(false);
  }
  const spec = React.useMemo(() => {
    if (sel) return MZ.spectrumAt(sel.x, sel.y);
    if (meanActive) return MZ.spectrumAt(104, 75);
    return null;
  }, [sel, meanActive]);
  const heading = sel ? `Pixel (${sel.x + 1}, ${sel.y + 1})` : meanActive ? "Mean spectrum" : "Spectrum";
  const sub = spec ? `${spec.mz.length.toLocaleString()} points · MS¹ · profile` : "no pixel selected";
  const mzWindow = view === "ion" ? {
    mz: ion.center,
    tol: ion.tol
  } : null;
  const hint = view === "ion" && !ion ? "Enter an m/z range and click Show Ion Image" : null;
  return /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, /*#__PURE__*/React.createElement("div", {
    className: "shell"
  }, /*#__PURE__*/React.createElement(TopBar, {
    fileName: loaded ? MZ.META.file : null,
    railOpen: railOpen,
    onToggleRail: () => setRail(v => !v),
    onReset: () => {
      setLoaded(false);
      setSel(null);
    },
    tweaksOpen: settingsOpen,
    onTweaks: () => setSettings(v => !v)
  }), /*#__PURE__*/React.createElement("div", {
    className: "body",
    style: {
      gridTemplateColumns: showRail && isWide ? "var(--shell-rail-w) 1fr" : "1fr"
    }
  }, showRail && /*#__PURE__*/React.createElement(Rail, {
    meta: MZ.META,
    grid: true,
    view: view
  }), loaded && !isWide && railOpen && /*#__PURE__*/React.createElement("div", {
    className: "rail-backdrop",
    onClick: () => setRail(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "center"
  }, loaded ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Toolbar, {
    view: view,
    setView: setView,
    ovMode: ovMode,
    setOvMode: setOvMode,
    s: s,
    mzStart: mzStart,
    setMzStart: setMzStart,
    mzEnd: mzEnd,
    setMzEnd: setMzEnd,
    onShowIon: onShowIon,
    mc: mc,
    setMc: setMc,
    onRenderMulti: onRenderMulti,
    setColormap: v => set({
      colormap: v
    }),
    onExport: onExport
  }), /*#__PURE__*/React.createElement(IonStage, {
    paint: painter.paint,
    paintKey: painter.key,
    colormap: painter.colormap,
    low: painter.low,
    high: painter.high,
    selected: sel,
    onPick: onPick,
    hint: hint
  }), /*#__PURE__*/React.createElement(SpectrumDock, {
    spec: spec,
    heading: heading,
    sub: sub,
    mzWindow: mzWindow,
    meanActive: meanActive && !sel,
    onMean: () => {
      setMean(v => !v);
      setSel(null);
    }
  })) : /*#__PURE__*/React.createElement("div", {
    className: "stage",
    style: {
      display: "block",
      position: "relative",
      background: "var(--bg-app)",
      backgroundImage: "none"
    }
  }, /*#__PURE__*/React.createElement(Loader, {
    onOpen: () => setLoaded(true)
  })))), /*#__PURE__*/React.createElement(StatusBar, {
    meta: MZ.META,
    view: loaded ? view === "overview" ? ovMode === "basepeak" ? "basepeak" : "overview" : view : "overview",
    zoom: 1
  })), settingsOpen && /*#__PURE__*/React.createElement(SettingsPopover, {
    s: s,
    set: set,
    onClose: () => setSettings(false)
  }));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "design_handoff_mzpeakiv_redesign/prototype-reference/app.jsx", error: String((e && e.message) || e) }); }

// design_handoff_mzpeakiv_redesign/prototype-reference/engine.js
try { (() => {
/* ──────────────────────────────────────────────────────────────────────────
   mzPeak IV — UI-kit rendering engine (plain JS, no JSX)
   Mock MSI data generation + scientific-colormap canvas painting. This makes
   the recreation look like a real ion-image explorer without a backend.
   Exposes window.MZ.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  // ── Colormap LUTs (matplotlib anchors, matching the design tokens) ───────
  const VIRIDIS = [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [110, 206, 88], [253, 231, 37]];
  const INFERNO = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [249, 201, 52], [252, 255, 164]];
  const SENTINEL = [22, 28, 34]; // matches --ink-raised, reads as empty stage

  function lut(stops, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const seg = stops.length - 1,
      x = t * seg;
    const i = Math.min(Math.floor(x), seg - 1),
      f = x - i;
    const a = stops[i],
      b = stops[i + 1];
    return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
  }
  function colormap(name, t) {
    if (name === "inferno") return lut(INFERNO, t);
    if (name === "gray") {
      const v = Math.round((t < 0 ? 0 : t > 1 ? 1 : t) * 255);
      return [v, v, v];
    }
    return lut(VIRIDIS, t);
  }
  function hueRGB(t) {
    // base-peak hue cycle [0,300]deg
    const h = (t < 0 ? 0 : t > 1 ? 1 : t) * 300,
      i = Math.floor(h / 60) % 6,
      f = h / 60 - Math.floor(h / 60);
    const q = 1 - f,
      tv = f;
    let r, g, b;
    switch (i) {
      case 0:
        r = 1;
        g = tv;
        b = 0;
        break;
      case 1:
        r = q;
        g = 1;
        b = 0;
        break;
      case 2:
        r = 0;
        g = 1;
        b = tv;
        break;
      case 3:
        r = 0;
        g = q;
        b = 1;
        break;
      case 4:
        r = tv;
        g = 0;
        b = 1;
        break;
      default:
        r = 1;
        g = 0;
        b = q;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // ── Deterministic PRNG ───────────────────────────────────────────────────
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = s * 1664525 + 1013904223 >>> 0;
      return s / 4294967296;
    };
  }

  // ── Sample geometry: an organic tissue-section silhouette + mask ─────────
  const W = 208,
    H = 150;
  function inMask(x, y) {
    const nx = x / W * 2 - 1,
      ny = y / H * 2 - 1;
    // two overlapping lobes (brain-section-like)
    const a = ((nx + 0.26) / 0.62) ** 2 + (ny / 0.78) ** 2;
    const b = ((nx - 0.26) / 0.62) ** 2 + (ny / 0.78) ** 2;
    const wob = 0.06 * Math.sin(ny * 6 + nx * 3);
    return Math.min(a, b) < 1 - wob;
  }
  const MASK = function () {
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = inMask(x, y) ? 1 : 0;
    return m;
  }();
  function gauss(field, cx, cy, sx, sy, amp, rot) {
    rot = rot || 0;
    const ct = Math.cos(rot),
      st = Math.sin(rot);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x - cx,
        dy = y - cy;
      const rx = dx * ct + dy * st,
        ry = -dx * st + dy * ct;
      field[y * W + x] += amp * Math.exp(-(rx * rx) / (2 * sx * sx) - ry * ry / (2 * sy * sy));
    }
  }

  // Build a named intensity field (Float32) within the mask, normalized 0..~1
  function makeField(spec) {
    const f = new Float32Array(W * H);
    const r = rng(spec.seed);
    (spec.blobs || []).forEach(b => gauss(f, b[0], b[1], b[2], b[3], b[4], b[5] || 0));
    // texture
    for (let i = 0; i < W * H; i++) {
      if (!MASK[i]) {
        f[i] = 0;
        continue;
      }
      f[i] = Math.max(0, f[i] * (0.82 + 0.36 * r()) + (spec.base || 0) * (0.5 + 0.5 * r()));
    }
    return f;
  }

  // Datasets: TIC + a few ion channels with distinct spatial distributions
  const TIC = makeField({
    seed: 7,
    base: 0.18,
    blobs: [[70, 70, 34, 46, 0.9, 0.3], [150, 74, 30, 50, 0.78, -0.2], [104, 40, 40, 18, 0.5, 0], [104, 120, 46, 16, 0.42, 0]]
  });
  const ION = {
    "740.50": makeField({
      seed: 11,
      base: 0.02,
      blobs: [[150, 70, 22, 40, 1.0, -0.2], [150, 108, 16, 12, 0.5, 0]]
    }),
    "772.52": makeField({
      seed: 19,
      base: 0.02,
      blobs: [[68, 66, 24, 34, 1.0, 0.3], [60, 104, 15, 12, 0.45, 0]]
    }),
    "798.54": makeField({
      seed: 23,
      base: 0.04,
      blobs: [[104, 40, 52, 14, 0.9, 0], [104, 118, 52, 12, 0.7, 0]]
    }),
    "184.07": makeField({
      seed: 31,
      base: 0.05,
      blobs: [[104, 76, 70, 60, 0.5, 0]]
    })
  };
  // base-peak: argmax over channels → m/z value per pixel
  const MZS = Object.keys(ION).map(Number);
  const BASEPEAK = function () {
    const f = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (!MASK[i]) {
        f[i] = 0;
        continue;
      }
      let best = -1,
        bm = MZS[0];
      MZS.forEach(mz => {
        const v = ION[mz.toFixed(2)][i];
        if (v > best) {
          best = v;
          bm = mz;
        }
      });
      f[i] = bm;
    }
    return f;
  }();
  function percentile(field, p) {
    const v = [];
    for (let i = 0; i < field.length; i++) if (MASK[i] && field[i] > 0) v.push(field[i]);
    if (!v.length) return 1;
    v.sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(p * v.length))] || 1;
  }

  // Paint a field onto a canvas (intrinsic W×H, pixelated upscale by CSS)
  function paint(canvas, field, opts) {
    opts = opts || {};
    const name = opts.colormap || "viridis";
    const log = opts.scale === "log";
    const clip = percentile(field, opts.percentile || 0.99);
    const denom = log ? Math.log1p(clip) : clip;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (!MASK[i]) {
        img.data[o] = SENTINEL[0];
        img.data[o + 1] = SENTINEL[1];
        img.data[o + 2] = SENTINEL[2];
        img.data[o + 3] = 255;
        continue;
      }
      const raw = field[i];
      let t = denom > 0 ? log ? Math.log1p(raw) / denom : raw / denom : 0;
      const [r, g, b] = colormap(name, t);
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  function paintBasePeak(canvas) {
    const lo = Math.min(...MZS),
      hi = Math.max(...MZS);
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (!MASK[i] || BASEPEAK[i] === 0) {
        img.data[o] = SENTINEL[0];
        img.data[o + 1] = SENTINEL[1];
        img.data[o + 2] = SENTINEL[2];
        img.data[o + 3] = 255;
        continue;
      }
      const [r, g, b] = hueRGB((BASEPEAK[i] - lo) / (hi - lo || 1));
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  function paintMulti(canvas, chans) {
    // chans: {r:field,g:field,b:field}
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    const mx = {
      r: percentile(chans.r || new Float32Array(W * H), 0.99),
      g: percentile(chans.g || new Float32Array(W * H), 0.99),
      b: percentile(chans.b || new Float32Array(W * H), 0.99)
    };
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (!MASK[i]) {
        img.data[o] = SENTINEL[0];
        img.data[o + 1] = SENTINEL[1];
        img.data[o + 2] = SENTINEL[2];
        img.data[o + 3] = 255;
        continue;
      }
      const cv = (f, m) => f ? Math.round(Math.min(1, f[i] / (m || 1)) * 255) : 0;
      img.data[o] = cv(chans.r, mx.r);
      img.data[o + 1] = cv(chans.g, mx.g);
      img.data[o + 2] = cv(chans.b, mx.b);
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── Mock spectrum behind a pixel ─────────────────────────────────────────
  const PEAKS = [[184.07, 0.42], [198.05, 0.16], [369.35, 0.22], [502.30, 0.30], [703.50, 0.28], [722.51, 0.5], [740.50, 1.0], [758.57, 0.34], [772.52, 0.7], [782.57, 0.20], [798.54, 0.46], [810.60, 0.14]];
  function spectrumAt(x, y) {
    // profile spectrum: sum of gaussians, intensities modulated by local ion fields
    const i = y * W + x;
    const mod = {
      "740.50": ION["740.50"][i],
      "772.52": ION["772.52"][i],
      "798.54": ION["798.54"][i],
      "184.07": ION["184.07"][i]
    };
    const N = 900,
      mz = new Float64Array(N),
      it = new Float64Array(N);
    const lo = 150,
      hi = 850;
    for (let k = 0; k < N; k++) mz[k] = lo + (hi - lo) * k / (N - 1);
    PEAKS.forEach(([pmz, amp]) => {
      let a = amp;
      const key = pmz.toFixed(2);
      if (mod[key] != null) a = 0.15 + 1.3 * mod[key];
      const w = 0.6 + Math.random() * 0.05;
      for (let k = 0; k < N; k++) {
        const d = mz[k] - pmz;
        it[k] += a * Math.exp(-(d * d) / (2 * w * w));
      }
    });
    const peak = PEAKS.map(([pmz]) => {
      const key = pmz.toFixed(2);
      const a = mod[key] != null ? 0.15 + 1.3 * mod[key] : null;
      return {
        mz: pmz,
        base: a
      };
    });
    return {
      mz,
      it,
      peak
    };
  }
  const META = {
    file: "PXD001283_brain.mzpeak",
    instrument: "LTQ Orbitrap XL",
    analyzer: "Orbitrap",
    dims: [W, H],
    spectra: W * H,
    filled: MASK.reduce((a, b) => a + b, 0),
    mzRange: [85.81, 799.95],
    msLevels: [1],
    mode: "profile",
    pixelSize: 50
  };
  window.MZ = {
    W,
    H,
    MASK,
    TIC,
    ION,
    MZS,
    BASEPEAK,
    META,
    PEAKS,
    paint,
    paintBasePeak,
    paintMulti,
    spectrumAt,
    colormap,
    percentile,
    inMaskIdx: i => !!MASK[i]
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "design_handoff_mzpeakiv_redesign/prototype-reference/engine.js", error: String((e && e.message) || e) }); }

// design_handoff_mzpeakiv_redesign/prototype-reference/icons.js
try { (() => {
/* mzPeak IV — icon set (Lucide-style line icons, MIT). Exposed on window.Icons. */
(function () {
  const S = (paths, extra) => function Icon(props) {
    const {
      size = 16,
      ...rest
    } = props || {};
    return React.createElement("svg", Object.assign({
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, rest), paths.map((d, i) => React.createElement(d[0], Object.assign({
      key: i
    }, d[1]))));
  };
  const P = d => ["path", {
    d
  }];
  const C = (cx, cy, r) => ["circle", {
    cx,
    cy,
    r
  }];
  const R = (x, y, w, h, rx) => ["rect", {
    x,
    y,
    width: w,
    height: h,
    rx
  }];
  const L = (x1, y1, x2, y2) => ["line", {
    x1,
    y1,
    x2,
    y2
  }];
  window.Icons = {
    Upload: S([P("M12 3v12"), P("m7 8 5-5 5 5"), P("M5 21h14")]),
    Image: S([R(3, 3, 18, 18, 2), C(8.5, 8.5, 1.5), P("m21 15-5-5L5 21")]),
    Layers: S([P("m12 2 9 5-9 5-9-5 9-5Z"), P("m3 12 9 5 9-5"), P("m3 17 9 5 9-5")]),
    Grid: S([R(3, 3, 7, 7, 1), R(14, 3, 7, 7, 1), R(14, 14, 7, 7, 1), R(3, 14, 7, 7, 1)]),
    Crosshair: S([C(12, 12, 9), L(12, 2, 12, 5), L(12, 19, 12, 22), L(2, 12, 5, 12), L(19, 12, 22, 12)]),
    Download: S([P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), P("M12 3v12"), P("m7 10 5 5 5-5")]),
    ChevDown: S([P("m6 9 6 6 6-6")]),
    ChevRight: S([P("m9 6 6 6-6 6")]),
    PanelLeft: S([R(3, 3, 18, 18, 2), L(9, 3, 9, 21)]),
    Search: S([C(11, 11, 8), L(21, 21, 16.65, 16.65)]),
    Info: S([C(12, 12, 10), L(12, 16, 12, 12), L(12, 8, 12.01, 8)]),
    X: S([P("M18 6 6 18"), P("m6 6 12 12")]),
    Check: S([P("M20 6 9 17l-5-5")]),
    Sliders: S([L(4, 21, 4, 14), L(4, 10, 4, 3), L(12, 21, 12, 12), L(12, 8, 12, 3), L(20, 21, 20, 16), L(20, 12, 20, 3), L(1, 14, 7, 14), L(9, 8, 15, 8), L(17, 16, 23, 16)]),
    Sigma: S([P("M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8L12 12l-5.9 7.2a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2")]),
    Maximize: S([P("M8 3H5a2 2 0 0 0-2 2v3"), P("M21 8V5a2 2 0 0 0-2-2h-3"), P("M3 16v3a2 2 0 0 0 2 2h3"), P("M16 21h3a2 2 0 0 0 2-2v-3")]),
    Flask: S([P("M9 3h6"), P("M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.3h12.4a1.5 1.5 0 0 0 1.3-2.3L14 9.5V3"), L(8, 14, 16, 14)]),
    Link: S([P("M9 17H7A5 5 0 0 1 7 7h2"), P("M15 7h2a5 5 0 0 1 0 10h-2"), L(8, 12, 16, 12)]),
    Dot: S([C(12, 12, 3)]),
    Eye: S([P("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"), C(12, 12, 3)]),
    Ruler: S([P("M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z"), L(14, 7, 16, 9), L(11, 10, 13, 12), L(8, 13, 10, 15)])
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "design_handoff_mzpeakiv_redesign/prototype-reference/icons.js", error: String((e && e.message) || e) }); }

// design_handoff_mzpeakiv_redesign/prototype-reference/panels.jsx
try { (() => {
/* mzPeak IV — shell panels: TopBar, Rail, SpectrumDock, StatusBar. → window */
const DS = window.MzPeakDesignSystem_019e25;
const {
  Button,
  Badge,
  Panel,
  StatRow,
  SegmentedControl,
  ColormapScale
} = DS;
function TopBar({
  fileName,
  railOpen,
  onToggleRail,
  onReset,
  tweaksOpen,
  onTweaks
}) {
  const I = window.Icons;
  return /*#__PURE__*/React.createElement("header", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("button", {
    className: "iconbtn topbar__menu",
    onClick: onToggleRail,
    "aria-pressed": railOpen,
    title: "Toggle inspector"
  }, /*#__PURE__*/React.createElement(I.PanelLeft, {
    size: 17
  })), /*#__PURE__*/React.createElement("div", {
    className: "topbar__brand"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/openms-logo.png",
    alt: "OpenMS"
  }), /*#__PURE__*/React.createElement("div", {
    className: "topbar__div"
  }), /*#__PURE__*/React.createElement("div", {
    className: "topbar__prod"
  }, /*#__PURE__*/React.createElement("b", null, "mzPeak\xA0IV"), /*#__PURE__*/React.createElement("span", null, "Imaging Viewer"))), fileName && /*#__PURE__*/React.createElement("div", {
    className: "topbar__file",
    title: fileName
  }, /*#__PURE__*/React.createElement(I.Flask, {
    size: 13
  }), " ", fileName), /*#__PURE__*/React.createElement("div", {
    className: "topbar__spacer"
  }), /*#__PURE__*/React.createElement("div", {
    className: "topbar__actions"
  }, fileName && /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(I.Upload, {
      size: 14
    }),
    onClick: onReset
  }, "Open file"), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    "aria-pressed": tweaksOpen,
    onClick: onTweaks,
    title: "Display settings"
  }, /*#__PURE__*/React.createElement(I.Sliders, {
    size: 16
  })), /*#__PURE__*/React.createElement("a", {
    className: "iconbtn",
    href: "https://github.com/okohlbacher/mzPeakIV",
    target: "_blank",
    rel: "noreferrer",
    title: "About"
  }, /*#__PURE__*/React.createElement(I.Info, {
    size: 16
  }))));
}
function Rail({
  meta,
  grid,
  view
}) {
  const I = window.Icons;
  const dims = grid ? `${meta.dims[0]} × ${meta.dims[1]}` : null;
  return /*#__PURE__*/React.createElement("aside", {
    className: "rail mz-scroll"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rail__head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "rail__title"
  }, "Inspector"), /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true
  }, "Ready")), /*#__PURE__*/React.createElement(Panel, {
    title: "Image Info",
    count: grid ? "5" : "—",
    defaultOpen: true
  }, /*#__PURE__*/React.createElement(StatRow, {
    label: "Dimensions",
    value: dims ? /*#__PURE__*/React.createElement(React.Fragment, null, dims, " ", /*#__PURE__*/React.createElement("em", null, "px")) : null
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Spectra",
    value: meta.spectra.toLocaleString()
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Pixels with data",
    value: meta.filled.toLocaleString()
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "m/z range",
    value: /*#__PURE__*/React.createElement(React.Fragment, null, meta.mzRange[0], " \u2013 ", meta.mzRange[1], " ", /*#__PURE__*/React.createElement("em", null, "Da"))
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Pixel size",
    value: /*#__PURE__*/React.createElement(React.Fragment, null, meta.pixelSize, " ", /*#__PURE__*/React.createElement("em", null, "\xB5m"))
  })), /*#__PURE__*/React.createElement(Panel, {
    title: "Acquisition",
    defaultOpen: true
  }, /*#__PURE__*/React.createElement(StatRow, {
    label: "Instrument",
    value: meta.instrument
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Analyzer",
    value: meta.analyzer
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "MS levels",
    value: meta.msLevels.join(", ")
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Mode",
    value: /*#__PURE__*/React.createElement(Badge, {
      tone: "info"
    }, meta.mode)
  })), /*#__PURE__*/React.createElement(Panel, {
    title: "Capabilities",
    defaultOpen: false
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap",
      paddingTop: 4
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true
  }, "Imaging"), /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true
  }, "Coordinates"), /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true
  }, "TIC"), /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral"
  }, "Numpress n/a"))), /*#__PURE__*/React.createElement(Panel, {
    title: "Grid Diagnostics",
    defaultOpen: false
  }, /*#__PURE__*/React.createElement(StatRow, {
    label: "Orientation",
    value: "top-left \xB7 y-down"
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Coordinate base",
    value: "1-based"
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Fill",
    value: /*#__PURE__*/React.createElement(React.Fragment, null, Math.round(100 * meta.filled / meta.spectra), /*#__PURE__*/React.createElement("em", null, "%"))
  })));
}

/* ── Spectrum canvas drawing ──────────────────────────────────────────────── */
function drawSpectrum(canvas, spec, mzWindow) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const padL = 8,
    padR = 8,
    padT = 8,
    padB = 20;
  const cs = getComputedStyle(document.documentElement);
  const line = cs.getPropertyValue("--spectrum-line").trim() || "#3b54da";
  const grid = "#eceff2",
    axis = "#9aa4ad";
  if (!spec) {
    ctx.fillStyle = "#aab2ba";
    ctx.font = "12px 'IBM Plex Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Click a pixel on the ion image to inspect its spectrum", w / 2, h / 2);
    return;
  }
  const N = spec.mz.length;
  const x0 = spec.mz[0],
    x1 = spec.mz[N - 1];
  let mx = 0;
  for (let i = 0; i < N; i++) if (spec.it[i] > mx) mx = spec.it[i];
  mx = mx || 1;
  const X = mz => padL + (mz - x0) / (x1 - x0) * (w - padL - padR);
  const Y = v => h - padB - v / mx * (h - padT - padB);
  // gridlines
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const yy = padT + g * (h - padT - padB) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(w - padR, yy);
    ctx.stroke();
  }
  // selection band
  if (mzWindow) {
    ctx.fillStyle = "rgba(255,200,0,0.25)";
    const bx0 = X(mzWindow.mz - mzWindow.tol),
      bx1 = X(mzWindow.mz + mzWindow.tol);
    ctx.fillRect(bx0, padT, bx1 - bx0, h - padT - padB);
  }
  // area + line
  ctx.beginPath();
  ctx.moveTo(X(x0), Y(0));
  for (let i = 0; i < N; i++) ctx.lineTo(X(spec.mz[i]), Y(spec.it[i]));
  ctx.lineTo(X(x1), Y(0));
  ctx.closePath();
  ctx.fillStyle = "rgba(59,84,218,0.09)";
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const px = X(spec.mz[i]),
      py = Y(spec.it[i]);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // axis labels
  ctx.fillStyle = axis;
  ctx.font = "10px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  for (let t = 200; t <= 800; t += 200) {
    if (t < x0 || t > x1) continue;
    ctx.fillText(String(t), X(t), h - 6);
  }
}
function SpectrumDock({
  spec,
  heading,
  sub,
  mzWindow,
  onMean,
  meanActive
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current) return;
    drawSpectrum(ref.current, spec, mzWindow);
    const onR = () => drawSpectrum(ref.current, spec, mzWindow);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, [spec, mzWindow]);
  return /*#__PURE__*/React.createElement("section", {
    className: "dock"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dock__head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dock__title"
  }, heading), sub && /*#__PURE__*/React.createElement("span", {
    className: "dock__meta"
  }, sub), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: meanActive ? "primary" : "secondary",
    size: "sm",
    onClick: onMean
  }, "\u2300 Mean spectrum")), /*#__PURE__*/React.createElement("div", {
    className: "dock__plot"
  }, /*#__PURE__*/React.createElement("canvas", {
    ref: ref
  })));
}
function StatusBar({
  meta,
  view,
  zoom
}) {
  const names = {
    overview: "Overview · TIC",
    basepeak: "Overview · Base-peak m/z",
    ion: "Ion Image",
    multi: "Multi-channel"
  };
  return /*#__PURE__*/React.createElement("footer", {
    className: "statusbar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "statusbar__dot"
  }, /*#__PURE__*/React.createElement("b", null), " mzPeak v0.3 \xB7 client-side"), /*#__PURE__*/React.createElement("span", null, names[view] || "Overview"), /*#__PURE__*/React.createElement("span", {
    className: "statusbar__spacer"
  }), /*#__PURE__*/React.createElement("span", null, meta.dims[0], " \xD7 ", meta.dims[1], " px"), /*#__PURE__*/React.createElement("span", null, meta.filled.toLocaleString(), " / ", meta.spectra.toLocaleString(), " spectra"), /*#__PURE__*/React.createElement("span", null, Math.round(zoom * 100), "%"));
}
Object.assign(window, {
  TopBar,
  Rail,
  SpectrumDock,
  StatusBar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "design_handoff_mzpeakiv_redesign/prototype-reference/panels.jsx", error: String((e && e.message) || e) }); }

// design_handoff_mzpeakiv_redesign/prototype-reference/stage.jsx
try { (() => {
/* mzPeak IV — stage: Toolbar, SettingsPopover, IonStage, MultiInputs, Loader. → window */
const D2 = window.MzPeakDesignSystem_019e25;
const {
  Button: Btn,
  SegmentedControl: Seg,
  NumberField: NF,
  Select: Sel,
  Checkbox: Chk,
  ColormapScale: CScale,
  Badge: Bdg
} = D2;
const MZW = window.MZ.W,
  MZH = window.MZ.H;

/* Fit a W:H canvas inside its container (contain), reacting to resize. */
function useFit(ratio, pad) {
  const ref = React.useRef(null);
  const [d, setD] = React.useState({
    w: 320,
    h: 240
  });
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const calc = () => {
      const cw = Math.max(40, el.clientWidth - (pad || 0));
      const ch = Math.max(40, el.clientHeight - (pad || 0));
      let w = cw,
        h = w / ratio;
      if (h > ch) {
        h = ch;
        w = h * ratio;
      }
      setD({
        w: Math.floor(w),
        h: Math.floor(h)
      });
    };
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    calc();
    return () => ro.disconnect();
  }, [ratio, pad]);
  return [ref, d];
}
function IonStage({
  paint,
  paintKey,
  colormap,
  low,
  high,
  selected,
  onPick,
  onHover,
  hint
}) {
  const [stageRef, d] = useFit(MZW / MZH, 56);
  const canRef = React.useRef(null);
  React.useEffect(() => {
    if (canRef.current && paint) paint(canRef.current);
  }, [paintKey]);
  const [ro, setRo] = React.useState(null);
  function toCell(e) {
    const r = canRef.current.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * MZW);
    const y = Math.floor((e.clientY - r.top) / r.height * MZH);
    if (x < 0 || x >= MZW || y < 0 || y >= MZH) return null;
    return {
      x,
      y
    };
  }
  const cell = MZW ? d.w / MZW : 1;
  return /*#__PURE__*/React.createElement("div", {
    className: "stage",
    ref: stageRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "imgframe",
    style: {
      width: d.w,
      height: d.h
    }
  }, /*#__PURE__*/React.createElement("canvas", {
    ref: canRef,
    className: onPick ? "cross" : "",
    style: {
      width: d.w,
      height: d.h
    },
    onMouseMove: onPick ? e => {
      const c = toCell(e);
      setRo(c);
      onHover && onHover(c);
    } : undefined,
    onMouseLeave: () => {
      setRo(null);
      onHover && onHover(null);
    },
    onClick: onPick ? e => {
      const c = toCell(e);
      if (c && window.MZ.MASK[c.y * MZW + c.x]) onPick(c);
    } : undefined
  }), selected && window.MZ.MASK[selected.y * MZW + selected.x] && /*#__PURE__*/React.createElement("div", {
    className: "selring",
    style: {
      left: selected.x * cell,
      top: selected.y * cell,
      width: cell + 1,
      height: cell + 1
    }
  })), hint && /*#__PURE__*/React.createElement("div", {
    className: "stage__readout",
    style: {
      left: "50%",
      right: "auto",
      top: "auto",
      bottom: 24,
      transform: "translateX(-50%)",
      textAlign: "center"
    }
  }, hint), !hint && low != null && /*#__PURE__*/React.createElement("div", {
    className: "stage__legend"
  }, /*#__PURE__*/React.createElement(CScale, {
    colormap: colormap,
    low: low,
    high: high,
    onStage: true
  })), !hint && /*#__PURE__*/React.createElement("div", {
    className: "stage__readout"
  }, ro ? window.MZ.MASK[ro.y * MZW + ro.x] ? /*#__PURE__*/React.createElement(React.Fragment, null, "x ", /*#__PURE__*/React.createElement("em", null, ro.x + 1), " \xB7 y ", /*#__PURE__*/React.createElement("em", null, ro.y + 1), /*#__PURE__*/React.createElement("br", null), "intensity ", /*#__PURE__*/React.createElement("em", null, fmtCompact(currentVal(paintKey, ro)))) : /*#__PURE__*/React.createElement(React.Fragment, null, "x ", ro.x + 1, " \xB7 y ", ro.y + 1, " \u2014 no data") : /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#8b95a0"
    }
  }, "Hover the image\u2026")), /*#__PURE__*/React.createElement("div", {
    className: "stage__scalebar"
  }, /*#__PURE__*/React.createElement("i", null), window.MZ.META.pixelSize * 64, " \xB5m"));
}

// value lookup for readout (kept simple — reads the app-provided current field)
let CURRENT_FIELD = null;
function currentVal(_k, ro) {
  return CURRENT_FIELD ? CURRENT_FIELD[ro.y * MZW + ro.x] : 0;
}
function fmtCompact(v) {
  if (!isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-2) return v.toExponential(1);
  return Number(v.toPrecision(3)).toLocaleString();
}
function SettingsPopover({
  s,
  set,
  onClose
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 30
    },
    onClick: onClose
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 54,
      right: 14,
      zIndex: 31,
      width: 264,
      background: "var(--surface)",
      border: "1px solid var(--border-hairline)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-pop)",
      padding: "14px 16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-2xs)",
      fontWeight: 600,
      letterSpacing: ".06em",
      textTransform: "uppercase",
      color: "var(--text-faint)",
      marginBottom: 10
    }
  }, "Display settings"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Colormap"
  }, /*#__PURE__*/React.createElement(Seg, {
    size: "sm",
    value: s.colormap,
    onChange: v => set({
      colormap: v
    }),
    options: [{
      value: "viridis",
      label: "viridis"
    }, {
      value: "inferno",
      label: "inferno"
    }, {
      value: "gray",
      label: "gray"
    }]
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Scale"
  }, /*#__PURE__*/React.createElement(Seg, {
    size: "sm",
    value: s.scale,
    onChange: v => set({
      scale: v
    }),
    options: [{
      value: "linear",
      label: "linear"
    }, {
      value: "log",
      label: "log"
    }]
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Percentile clip"
  }, /*#__PURE__*/React.createElement(Sel, {
    size: "sm",
    value: String(s.percentile),
    onChange: v => set({
      percentile: Number(v)
    }),
    options: [{
      value: "0.9",
      label: "90th pct"
    }, {
      value: "0.95",
      label: "95th pct"
    }, {
      value: "0.99",
      label: "99th pct"
    }, {
      value: "0.999",
      label: "99.9th pct"
    }]
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Contrast"
  }, /*#__PURE__*/React.createElement(Sel, {
    size: "sm",
    value: s.contrast,
    onChange: v => set({
      contrast: v
    }),
    options: [{
      value: "none",
      label: "None"
    }, {
      value: "equalize",
      label: "Equalize"
    }, {
      value: "clahe",
      label: "CLAHE"
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Chk, {
    checked: s.ticNorm,
    onChange: v => set({
      ticNorm: v
    }),
    label: "TIC normalize"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)"
    }
  }, "\u03C3 ", /*#__PURE__*/React.createElement(NF, {
    size: "sm",
    width: "48px",
    value: s.smooth,
    onChange: v => set({
      smooth: v
    }),
    ariaLabel: "smooth"
  }))))));
}
function Field({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-2xs)",
      fontWeight: 600,
      letterSpacing: ".06em",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label), children);
}
function Loader({
  onOpen
}) {
  const I = window.Icons;
  const [over, setOver] = React.useState(false);
  const [url, setUrl] = React.useState("https://hupo-psi.github.io/…/PXD001283.mzpeak");
  return /*#__PURE__*/React.createElement("div", {
    className: "loader"
  }, /*#__PURE__*/React.createElement("div", {
    className: "loader__card"
  }, /*#__PURE__*/React.createElement("img", {
    className: "loader__logo",
    src: "../../assets/openms-logo.png",
    alt: "OpenMS"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "loader__h"
  }, "Open an imaging mzPeak file"), /*#__PURE__*/React.createElement("div", {
    className: "loader__p"
  }, "Reconstruct the pixel grid, render ion images for any m/z window, and inspect the spectrum behind any pixel \u2014 entirely in your browser.")), /*#__PURE__*/React.createElement("div", {
    className: "drop",
    "data-over": over,
    onDragOver: e => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: e => {
      e.preventDefault();
      setOver(false);
      onOpen();
    },
    onClick: onOpen
  }, /*#__PURE__*/React.createElement(I.Upload, {
    size: 22
  }), /*#__PURE__*/React.createElement("div", null, "Drop a ", /*#__PURE__*/React.createElement("strong", null, ".mzpeak"), " file here, or ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--accent)",
      textDecoration: "underline"
    }
  }, "browse"))), /*#__PURE__*/React.createElement("div", {
    className: "loader__url"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mz-input"
  }, /*#__PURE__*/React.createElement("input", {
    value: url,
    onChange: e => setUrl(e.target.value),
    "aria-label": "url",
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-xs)"
    }
  })), /*#__PURE__*/React.createElement(Btn, {
    variant: "secondary",
    onClick: onOpen
  }, "Load URL")), /*#__PURE__*/React.createElement("div", {
    className: "loader__demos"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-xs)",
      color: "var(--text-faint)",
      alignSelf: "center"
    }
  }, "Demos:"), /*#__PURE__*/React.createElement("button", {
    className: "chip",
    onClick: onOpen
  }, "brain \xB7 208\xD7150"), /*#__PURE__*/React.createElement("button", {
    className: "chip",
    onClick: onOpen
  }, "kidney \xB7 centroid"), /*#__PURE__*/React.createElement("button", {
    className: "chip",
    onClick: onOpen
  }, "small.mzpeak"))));
}
Object.assign(window, {
  IonStage,
  SettingsPopover,
  Loader,
  setCurrentField: f => {
    CURRENT_FIELD = f;
  },
  fmtCompact
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "design_handoff_mzpeakiv_redesign/prototype-reference/stage.jsx", error: String((e && e.message) || e) }); }

// ds-runtime-fallback.js
try { (() => {
/* ──────────────────────────────────────────────────────────────────────────
   mzPeak DS — runtime fallback shim
   Defines window.MzPeakDesignSystem_019e25 with plain-JS (React.createElement)
   implementations of the 9 primitives, ONLY if the compiled _ds_bundle.js did
   not already provide them. Class names + props match the .jsx sources exactly,
   so cards/kits render identically whether or not the compiled bundle is served.
   Load this AFTER <script src="…/_ds_bundle.js"> and BEFORE any consumer code.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  if (window.MzPeakDesignSystem_019e25 && window.MzPeakDesignSystem_019e25.Button) return;
  if (typeof React === "undefined") {
    console.warn("[mzPeak DS] React not loaded before fallback shim");
    return;
  }
  const h = React.createElement;
  const cx = (...a) => a.filter(Boolean).join(" ");
  const svg = (attrs, d) => h("svg", Object.assign({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  }, attrs), h("path", {
    d
  }));
  function Button({
    variant = "primary",
    size = "md",
    iconLeft,
    iconRight,
    block,
    className = "",
    children,
    ...rest
  }) {
    const cls = cx("mz-btn", variant !== "primary" && "mz-btn--" + variant, size === "sm" && "mz-btn--sm", !children && "mz-btn--icon", block && "mz-btn--block", className);
    return h("button", Object.assign({
      className: cls
    }, rest), iconLeft && h("span", {
      className: "mz-ic",
      "aria-hidden": true
    }, iconLeft), children, iconRight && h("span", {
      className: "mz-ic",
      "aria-hidden": true
    }, iconRight));
  }
  function SegmentedControl({
    options = [],
    value,
    onChange = () => {},
    size = "md",
    ariaLabel = "View",
    className = ""
  }) {
    return h("div", {
      className: cx("mz-seg", size === "sm" && "mz-seg--sm", className),
      role: "tablist",
      "aria-label": ariaLabel
    }, options.map(o => h("button", {
      key: o.value,
      role: "tab",
      type: "button",
      "aria-selected": o.value === value,
      className: "mz-seg__item",
      onClick: () => onChange(o.value)
    }, o.icon && h("span", {
      className: "mz-ic",
      "aria-hidden": true
    }, o.icon), o.label != null ? o.label : o.value)));
  }
  function NumberField({
    value,
    onChange = () => {},
    unit,
    size = "md",
    placeholder = "",
    width,
    className = "",
    ariaLabel,
    ...rest
  }) {
    return h("span", {
      className: cx("mz-input", size === "sm" && "mz-input--sm", className),
      style: width ? {
        width
      } : undefined
    }, h("input", Object.assign({
      type: "number",
      inputMode: "decimal",
      value,
      placeholder,
      "aria-label": ariaLabel,
      onChange: e => onChange(e.target.value, e)
    }, rest)), unit && h("span", {
      className: "mz-input__unit"
    }, unit));
  }
  function Select({
    value,
    onChange = () => {},
    options = [],
    size = "md",
    ariaLabel,
    className = "",
    ...rest
  }) {
    return h("span", {
      className: cx("mz-select", size === "sm" && "mz-select--sm", className)
    }, h("select", Object.assign({
      value,
      "aria-label": ariaLabel,
      onChange: e => onChange(e.target.value, e)
    }, rest), options.map(o => h("option", {
      key: o.value,
      value: o.value
    }, o.label))), svg({
      className: "mz-select__chev",
      strokeWidth: 2.2
    }, "m6 9 6 6 6-6"));
  }
  function Checkbox({
    checked,
    onChange = () => {},
    label,
    className = "",
    ...rest
  }) {
    return h("label", {
      className: cx("mz-check", className)
    }, h("input", Object.assign({
      type: "checkbox",
      checked,
      onChange: e => onChange(e.target.checked, e)
    }, rest)), h("span", {
      className: "mz-check__box"
    }, svg({
      className: "mz-ic",
      strokeWidth: 3
    }, "M20 6 9 17l-5-5")), label && h("span", null, label));
  }
  function Badge({
    tone = "neutral",
    dot,
    mono,
    className = "",
    children
  }) {
    return h("span", {
      className: cx("mz-badge", "mz-badge--" + tone, mono && "mz-badge--mono", className)
    }, dot && h("span", {
      className: "mz-badge__dot",
      "aria-hidden": true
    }), children);
  }
  function StatRow({
    label,
    value,
    className = ""
  }) {
    return h("div", {
      className: cx("mz-statrow", className)
    }, h("span", {
      className: "mz-statrow__key"
    }, label), h("span", {
      className: "mz-statrow__val"
    }, value != null ? value : h("em", null, "—")));
  }
  function ColormapScale({
    colormap = "viridis",
    low = "0",
    high = "max",
    orientation = "horizontal",
    onStage,
    className = ""
  }) {
    return h("div", {
      className: cx("mz-cmap", orientation === "vertical" && "mz-cmap--vertical", onStage && "mz-cmap--stage", className)
    }, h("div", {
      className: "mz-cmap__bar mz-cmap__bar--" + colormap
    }), h("div", {
      className: "mz-cmap__ticks"
    }, h("span", null, low), h("span", null, high)));
  }
  function Panel({
    title,
    count,
    defaultOpen = true,
    open,
    onToggle,
    className = "",
    children
  }) {
    const [internal, setInternal] = React.useState(defaultOpen);
    const isOpen = open != null ? open : internal;
    const toggle = () => onToggle ? onToggle(!isOpen) : setInternal(v => !v);
    return h("section", {
      className: cx("mz-panel", className),
      "data-open": isOpen
    }, h("button", {
      className: "mz-panel__head",
      onClick: toggle,
      "aria-expanded": isOpen
    }, svg({
      className: "mz-panel__chev",
      strokeWidth: 2.4
    }, "m6 9 6 6 6-6"), h("span", {
      className: "mz-panel__title"
    }, title), count != null && h("span", {
      className: "mz-panel__count"
    }, count)), h("div", {
      className: "mz-panel__body"
    }, children));
  }
  window.MzPeakDesignSystem_019e25 = Object.assign(window.MzPeakDesignSystem_019e25 || {}, {
    Button,
    SegmentedControl,
    NumberField,
    Select,
    Checkbox,
    Badge,
    StatRow,
    ColormapScale,
    Panel
  });
  console.info("[mzPeak DS] using runtime fallback shim (compiled bundle not served)");
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ds-runtime-fallback.js", error: String((e && e.message) || e) }); }

// ui_kits/mzpeak-iv/app.jsx
try { (() => {
/* mzPeak IV — app orchestrator + per-view toolbar. Mounts into #root. */
const DSx = window.MzPeakDesignSystem_019e25;
const {
  Button: B3,
  SegmentedControl: Seg3,
  NumberField: NF3
} = DSx;
const MZ = window.MZ;
function Toolbar(props) {
  const {
    view,
    setView,
    ovMode,
    setOvMode,
    s,
    mzStart,
    setMzStart,
    mzEnd,
    setMzEnd,
    onShowIon,
    mc,
    setMc,
    onRenderMulti,
    setColormap,
    onExport
  } = props;
  const I = window.Icons;
  return /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement(Seg3, {
    ariaLabel: "View",
    value: view,
    onChange: setView,
    options: [{
      value: "overview",
      label: "Overview",
      icon: /*#__PURE__*/React.createElement(I.Grid, {
        size: 13
      })
    }, {
      value: "optical",
      label: "Optical",
      icon: /*#__PURE__*/React.createElement(I.Eye, {
        size: 13
      })
    }, {
      value: "ion",
      label: "Ion Image",
      icon: /*#__PURE__*/React.createElement(I.Image, {
        size: 13
      })
    }, {
      value: "multi",
      label: "Multi-channel",
      icon: /*#__PURE__*/React.createElement(I.Layers, {
        size: 13
      })
    }]
  }), /*#__PURE__*/React.createElement("div", {
    className: "toolbar__sep"
  }), view === "overview" && /*#__PURE__*/React.createElement(Seg3, {
    size: "sm",
    ariaLabel: "Overview mode",
    value: ovMode,
    onChange: setOvMode,
    options: [{
      value: "tic",
      label: "TIC"
    }, {
      value: "basepeak",
      label: "Base-peak m/z"
    }]
  }), view === "ion" && /*#__PURE__*/React.createElement("div", {
    className: "toolbar__group"
  }, /*#__PURE__*/React.createElement("span", {
    className: "toolbar__lbl"
  }, "m/z"), /*#__PURE__*/React.createElement(NF3, {
    size: "sm",
    width: "84px",
    value: mzStart,
    onChange: setMzStart,
    ariaLabel: "m/z start"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-faint)"
    }
  }, "\u2013"), /*#__PURE__*/React.createElement(NF3, {
    size: "sm",
    width: "84px",
    value: mzEnd,
    onChange: setMzEnd,
    unit: "Da",
    ariaLabel: "m/z end"
  }), /*#__PURE__*/React.createElement(B3, {
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(I.Image, {
      size: 14
    }),
    onClick: onShowIon
  }, "Show Ion Image")), view === "multi" && /*#__PURE__*/React.createElement("div", {
    className: "toolbar__group"
  }, ["r", "g", "b"].map(c => /*#__PURE__*/React.createElement("span", {
    key: c,
    className: "mc-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mc-sw",
    style: {
      background: c === "r" ? "var(--channel-r)" : c === "g" ? "var(--channel-g)" : "var(--channel-b)"
    }
  }), /*#__PURE__*/React.createElement(NF3, {
    size: "sm",
    width: "78px",
    value: mc[c],
    onChange: v => setMc({
      ...mc,
      [c]: v
    }),
    ariaLabel: c + " m/z"
  }))), /*#__PURE__*/React.createElement(B3, {
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(I.Layers, {
      size: 14
    }),
    onClick: onRenderMulti
  }, "Render")), /*#__PURE__*/React.createElement("div", {
    className: "toolbar__spacer"
  }), view === "overview" && ovMode === "tic" || view === "ion" ? /*#__PURE__*/React.createElement(Seg3, {
    size: "sm",
    ariaLabel: "Colormap",
    value: s.colormap,
    onChange: setColormap,
    options: [{
      value: "viridis",
      label: "viridis"
    }, {
      value: "inferno",
      label: "inferno"
    }, {
      value: "gray",
      label: "gray"
    }]
  }) : null, (view === "ion" || view === "multi") && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "toolbar__sep"
  }), /*#__PURE__*/React.createElement(B3, {
    variant: "secondary",
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(I.Download, {
      size: 14
    }),
    onClick: onExport
  }, "TIFF")));
}
function App() {
  const [loaded, setLoaded] = React.useState(false);
  const [view, setView] = React.useState("overview");
  const [ovMode, setOvMode] = React.useState("tic");
  const [s, setS] = React.useState({
    colormap: "viridis",
    scale: "linear",
    percentile: 0.99,
    contrast: "none",
    ticNorm: false,
    smooth: "0"
  });
  const set = p => setS(o => ({
    ...o,
    ...p
  }));
  const [mzStart, setMzStart] = React.useState("740.00");
  const [mzEnd, setMzEnd] = React.useState("742.00");
  const [ion, setIon] = React.useState({
    field: MZ.ION["740.50"],
    key: "ion740",
    center: 741,
    tol: 1
  });
  const [mc, setMc] = React.useState({
    r: "772.52",
    g: "740.50",
    b: "798.54"
  });
  const [mcFields, setMcFields] = React.useState({
    r: MZ.ION["772.52"],
    g: MZ.ION["740.50"],
    b: MZ.ION["798.54"]
  });
  const [mcKey, setMcKey] = React.useState("mc0");
  const [sel, setSel] = React.useState(null);
  const [selOptical, setSelOptical] = React.useState(MZ.OPTICAL[0].archivePath);
  const [meanActive, setMean] = React.useState(false);
  const [settingsOpen, setSettings] = React.useState(false);
  const [railOpen, setRail] = React.useState(typeof window !== "undefined" && window.innerWidth > 1040);
  const [isWide, setIsWide] = React.useState(typeof window !== "undefined" && window.innerWidth > 1040);
  React.useEffect(() => {
    const f = () => setIsWide(window.innerWidth > 1040);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const showRail = loaded && (isWide || railOpen);
  const opt = {
    colormap: s.colormap,
    scale: s.scale,
    percentile: s.percentile
  };

  // Build the painter for the current view
  const painter = React.useMemo(() => {
    if (view === "overview" && ovMode === "basepeak") {
      const lo = Math.min(...MZ.MZS),
        hi = Math.max(...MZ.MZS);
      return {
        paint: c => MZ.paintBasePeak(c),
        field: MZ.BASEPEAK,
        colormap: "basepeak",
        low: String(lo.toFixed(0)),
        high: String(hi.toFixed(0)),
        key: "bp"
      };
    }
    if (view === "ion") {
      return {
        paint: c => MZ.paint(c, ion.field, opt),
        field: ion.field,
        colormap: s.colormap,
        low: "0",
        high: "max",
        key: "ion|" + ion.key + "|" + JSON.stringify(opt)
      };
    }
    if (view === "multi") {
      return {
        paint: c => MZ.paintMulti(c, mcFields),
        field: mcFields.g,
        colormap: null,
        low: null,
        high: null,
        key: "multi|" + mcKey
      };
    }
    // overview TIC
    return {
      paint: c => MZ.paint(c, MZ.TIC, opt),
      field: MZ.TIC,
      colormap: s.colormap,
      low: "0",
      high: "max",
      key: "tic|" + JSON.stringify(opt)
    };
  }, [view, ovMode, s, ion, mcFields, mcKey]);
  React.useEffect(() => {
    window.setCurrentField(painter.field);
  }, [painter]);
  function onShowIon() {
    const a = parseFloat(mzStart),
      b = parseFloat(mzEnd);
    if (!isFinite(a) || !isFinite(b) || b <= a) return;
    const c = (a + b) / 2,
      tol = (b - a) / 2;
    let best = MZ.MZS[0];
    MZ.MZS.forEach(m => {
      if (Math.abs(m - c) < Math.abs(best - c)) best = m;
    });
    setIon({
      field: MZ.ION[best.toFixed(2)],
      key: "i" + c.toFixed(2),
      center: c,
      tol: Math.max(tol, 0.25)
    });
  }
  function onRenderMulti() {
    const pick = v => {
      let best = MZ.MZS[0];
      MZ.MZS.forEach(m => {
        if (Math.abs(m - parseFloat(v)) < Math.abs(best - parseFloat(v))) best = m;
      });
      return MZ.ION[best.toFixed(2)];
    };
    setMcFields({
      r: pick(mc.r),
      g: pick(mc.g),
      b: pick(mc.b)
    });
    setMcKey("mc" + Date.now());
  }
  function onExport() {
    const c = document.querySelector(".imgframe canvas");
    if (!c) return;
    const a = document.createElement("a");
    a.download = "ion-image.png";
    a.href = c.toDataURL("image/png");
    a.click();
  }
  function onPick(cell) {
    setSel(cell);
    setMean(false);
  }
  const spec = React.useMemo(() => {
    if (sel) return MZ.spectrumAt(sel.x, sel.y);
    if (meanActive) return MZ.spectrumAt(104, 75);
    return null;
  }, [sel, meanActive]);
  const heading = sel ? `Pixel (${sel.x + 1}, ${sel.y + 1})` : meanActive ? "Mean spectrum" : "Spectrum";
  const sub = spec ? `${spec.mz.length.toLocaleString()} points · MS¹ · profile` : "no pixel selected";
  const mzWindow = view === "ion" ? {
    mz: ion.center,
    tol: ion.tol
  } : null;
  const hint = view === "ion" && !ion ? "Enter an m/z range and click Show Ion Image" : null;
  return /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, /*#__PURE__*/React.createElement("div", {
    className: "shell"
  }, /*#__PURE__*/React.createElement(TopBar, {
    fileName: loaded ? MZ.META.file : null,
    railOpen: railOpen,
    onToggleRail: () => setRail(v => !v),
    onReset: () => {
      setLoaded(false);
      setSel(null);
    },
    tweaksOpen: settingsOpen,
    onTweaks: () => setSettings(v => !v)
  }), /*#__PURE__*/React.createElement("div", {
    className: "body",
    style: {
      gridTemplateColumns: showRail && isWide ? "var(--shell-rail-w) 1fr" : "1fr"
    }
  }, showRail && /*#__PURE__*/React.createElement(Rail, {
    meta: MZ.META,
    grid: true,
    view: view,
    optical: MZ.OPTICAL,
    selectedOptical: selOptical,
    onSelectOptical: p => {
      setSelOptical(p);
      setView("optical");
    }
  }), loaded && !isWide && railOpen && /*#__PURE__*/React.createElement("div", {
    className: "rail-backdrop",
    onClick: () => setRail(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "center"
  }, loaded ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Toolbar, {
    view: view,
    setView: setView,
    ovMode: ovMode,
    setOvMode: setOvMode,
    s: s,
    mzStart: mzStart,
    setMzStart: setMzStart,
    mzEnd: mzEnd,
    setMzEnd: setMzEnd,
    onShowIon: onShowIon,
    mc: mc,
    setMc: setMc,
    onRenderMulti: onRenderMulti,
    setColormap: v => set({
      colormap: v
    }),
    onExport: onExport
  }), view === "optical" ? /*#__PURE__*/React.createElement(OpticalStage, {
    image: MZ.OPTICAL.find(o => o.archivePath === selOptical)
  }) : /*#__PURE__*/React.createElement(IonStage, {
    paint: painter.paint,
    paintKey: painter.key,
    colormap: painter.colormap,
    low: painter.low,
    high: painter.high,
    selected: sel,
    onPick: onPick,
    hint: hint
  }), /*#__PURE__*/React.createElement(SpectrumDock, {
    spec: spec,
    heading: heading,
    sub: sub,
    mzWindow: mzWindow,
    meanActive: meanActive && !sel,
    onMean: () => {
      setMean(v => !v);
      setSel(null);
    }
  })) : /*#__PURE__*/React.createElement("div", {
    className: "stage",
    style: {
      display: "block",
      position: "relative",
      background: "var(--bg-app)",
      backgroundImage: "none"
    }
  }, /*#__PURE__*/React.createElement(Loader, {
    onOpen: () => setLoaded(true)
  })))), /*#__PURE__*/React.createElement(StatusBar, {
    meta: MZ.META,
    view: loaded ? view === "overview" ? ovMode === "basepeak" ? "basepeak" : "overview" : view : "overview",
    zoom: 1
  })), settingsOpen && /*#__PURE__*/React.createElement(SettingsPopover, {
    s: s,
    set: set,
    onClose: () => setSettings(false)
  }));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mzpeak-iv/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/mzpeak-iv/engine.js
try { (() => {
/* ──────────────────────────────────────────────────────────────────────────
   mzPeak IV — UI-kit rendering engine (plain JS, no JSX)
   Mock MSI data generation + scientific-colormap canvas painting. This makes
   the recreation look like a real ion-image explorer without a backend.
   Exposes window.MZ.
   ────────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  // ── Colormap LUTs (matplotlib anchors, matching the design tokens) ───────
  const VIRIDIS = [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [110, 206, 88], [253, 231, 37]];
  const INFERNO = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [249, 201, 52], [252, 255, 164]];
  const SENTINEL = [22, 28, 34]; // matches --ink-raised, reads as empty stage

  function lut(stops, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const seg = stops.length - 1,
      x = t * seg;
    const i = Math.min(Math.floor(x), seg - 1),
      f = x - i;
    const a = stops[i],
      b = stops[i + 1];
    return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
  }
  function colormap(name, t) {
    if (name === "inferno") return lut(INFERNO, t);
    if (name === "gray") {
      const v = Math.round((t < 0 ? 0 : t > 1 ? 1 : t) * 255);
      return [v, v, v];
    }
    return lut(VIRIDIS, t);
  }
  function hueRGB(t) {
    // base-peak hue cycle [0,300]deg
    const h = (t < 0 ? 0 : t > 1 ? 1 : t) * 300,
      i = Math.floor(h / 60) % 6,
      f = h / 60 - Math.floor(h / 60);
    const q = 1 - f,
      tv = f;
    let r, g, b;
    switch (i) {
      case 0:
        r = 1;
        g = tv;
        b = 0;
        break;
      case 1:
        r = q;
        g = 1;
        b = 0;
        break;
      case 2:
        r = 0;
        g = 1;
        b = tv;
        break;
      case 3:
        r = 0;
        g = q;
        b = 1;
        break;
      case 4:
        r = tv;
        g = 0;
        b = 1;
        break;
      default:
        r = 1;
        g = 0;
        b = q;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // ── Deterministic PRNG ───────────────────────────────────────────────────
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = s * 1664525 + 1013904223 >>> 0;
      return s / 4294967296;
    };
  }

  // ── Sample geometry: an organic tissue-section silhouette + mask ─────────
  const W = 208,
    H = 150;
  function inMask(x, y) {
    const nx = x / W * 2 - 1,
      ny = y / H * 2 - 1;
    // two overlapping lobes (brain-section-like)
    const a = ((nx + 0.26) / 0.62) ** 2 + (ny / 0.78) ** 2;
    const b = ((nx - 0.26) / 0.62) ** 2 + (ny / 0.78) ** 2;
    const wob = 0.06 * Math.sin(ny * 6 + nx * 3);
    return Math.min(a, b) < 1 - wob;
  }
  const MASK = function () {
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = inMask(x, y) ? 1 : 0;
    return m;
  }();
  function gauss(field, cx, cy, sx, sy, amp, rot) {
    rot = rot || 0;
    const ct = Math.cos(rot),
      st = Math.sin(rot);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x - cx,
        dy = y - cy;
      const rx = dx * ct + dy * st,
        ry = -dx * st + dy * ct;
      field[y * W + x] += amp * Math.exp(-(rx * rx) / (2 * sx * sx) - ry * ry / (2 * sy * sy));
    }
  }

  // Build a named intensity field (Float32) within the mask, normalized 0..~1
  function makeField(spec) {
    const f = new Float32Array(W * H);
    const r = rng(spec.seed);
    (spec.blobs || []).forEach(b => gauss(f, b[0], b[1], b[2], b[3], b[4], b[5] || 0));
    // texture
    for (let i = 0; i < W * H; i++) {
      if (!MASK[i]) {
        f[i] = 0;
        continue;
      }
      f[i] = Math.max(0, f[i] * (0.82 + 0.36 * r()) + (spec.base || 0) * (0.5 + 0.5 * r()));
    }
    return f;
  }

  // Datasets: TIC + a few ion channels with distinct spatial distributions
  const TIC = makeField({
    seed: 7,
    base: 0.18,
    blobs: [[70, 70, 34, 46, 0.9, 0.3], [150, 74, 30, 50, 0.78, -0.2], [104, 40, 40, 18, 0.5, 0], [104, 120, 46, 16, 0.42, 0]]
  });
  const ION = {
    "740.50": makeField({
      seed: 11,
      base: 0.02,
      blobs: [[150, 70, 22, 40, 1.0, -0.2], [150, 108, 16, 12, 0.5, 0]]
    }),
    "772.52": makeField({
      seed: 19,
      base: 0.02,
      blobs: [[68, 66, 24, 34, 1.0, 0.3], [60, 104, 15, 12, 0.45, 0]]
    }),
    "798.54": makeField({
      seed: 23,
      base: 0.04,
      blobs: [[104, 40, 52, 14, 0.9, 0], [104, 118, 52, 12, 0.7, 0]]
    }),
    "184.07": makeField({
      seed: 31,
      base: 0.05,
      blobs: [[104, 76, 70, 60, 0.5, 0]]
    })
  };
  // base-peak: argmax over channels → m/z value per pixel
  const MZS = Object.keys(ION).map(Number);
  const BASEPEAK = function () {
    const f = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (!MASK[i]) {
        f[i] = 0;
        continue;
      }
      let best = -1,
        bm = MZS[0];
      MZS.forEach(mz => {
        const v = ION[mz.toFixed(2)][i];
        if (v > best) {
          best = v;
          bm = mz;
        }
      });
      f[i] = bm;
    }
    return f;
  }();
  function percentile(field, p) {
    const v = [];
    for (let i = 0; i < field.length; i++) if (MASK[i] && field[i] > 0) v.push(field[i]);
    if (!v.length) return 1;
    v.sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(p * v.length))] || 1;
  }

  // Paint a field onto a canvas (intrinsic W×H, pixelated upscale by CSS)
  function paint(canvas, field, opts) {
    opts = opts || {};
    const name = opts.colormap || "viridis";
    const log = opts.scale === "log";
    const clip = percentile(field, opts.percentile || 0.99);
    const denom = log ? Math.log1p(clip) : clip;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (!MASK[i]) {
        img.data[o] = SENTINEL[0];
        img.data[o + 1] = SENTINEL[1];
        img.data[o + 2] = SENTINEL[2];
        img.data[o + 3] = 255;
        continue;
      }
      const raw = field[i];
      let t = denom > 0 ? log ? Math.log1p(raw) / denom : raw / denom : 0;
      const [r, g, b] = colormap(name, t);
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  function paintBasePeak(canvas) {
    const lo = Math.min(...MZS),
      hi = Math.max(...MZS);
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (!MASK[i] || BASEPEAK[i] === 0) {
        img.data[o] = SENTINEL[0];
        img.data[o + 1] = SENTINEL[1];
        img.data[o + 2] = SENTINEL[2];
        img.data[o + 3] = 255;
        continue;
      }
      const [r, g, b] = hueRGB((BASEPEAK[i] - lo) / (hi - lo || 1));
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  function paintMulti(canvas, chans) {
    // chans: {r:field,g:field,b:field}
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    const mx = {
      r: percentile(chans.r || new Float32Array(W * H), 0.99),
      g: percentile(chans.g || new Float32Array(W * H), 0.99),
      b: percentile(chans.b || new Float32Array(W * H), 0.99)
    };
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      if (!MASK[i]) {
        img.data[o] = SENTINEL[0];
        img.data[o + 1] = SENTINEL[1];
        img.data[o + 2] = SENTINEL[2];
        img.data[o + 3] = 255;
        continue;
      }
      const cv = (f, m) => f ? Math.round(Math.min(1, f[i] / (m || 1)) * 255) : 0;
      img.data[o] = cv(chans.r, mx.r);
      img.data[o + 1] = cv(chans.g, mx.g);
      img.data[o + 2] = cv(chans.b, mx.b);
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // ── Mock spectrum behind a pixel ─────────────────────────────────────────
  const PEAKS = [[184.07, 0.42], [198.05, 0.16], [369.35, 0.22], [502.30, 0.30], [703.50, 0.28], [722.51, 0.5], [740.50, 1.0], [758.57, 0.34], [772.52, 0.7], [782.57, 0.20], [798.54, 0.46], [810.60, 0.14]];
  function spectrumAt(x, y) {
    // profile spectrum: sum of gaussians, intensities modulated by local ion fields
    const i = y * W + x;
    const mod = {
      "740.50": ION["740.50"][i],
      "772.52": ION["772.52"][i],
      "798.54": ION["798.54"][i],
      "184.07": ION["184.07"][i]
    };
    const N = 900,
      mz = new Float64Array(N),
      it = new Float64Array(N);
    const lo = 150,
      hi = 850;
    for (let k = 0; k < N; k++) mz[k] = lo + (hi - lo) * k / (N - 1);
    PEAKS.forEach(([pmz, amp]) => {
      let a = amp;
      const key = pmz.toFixed(2);
      if (mod[key] != null) a = 0.15 + 1.3 * mod[key];
      const w = 0.6 + Math.random() * 0.05;
      for (let k = 0; k < N; k++) {
        const d = mz[k] - pmz;
        it[k] += a * Math.exp(-(d * d) / (2 * w * w));
      }
    });
    const peak = PEAKS.map(([pmz]) => {
      const key = pmz.toFixed(2);
      const a = mod[key] != null ? 0.15 + 1.3 * mod[key] : null;
      return {
        mz: pmz,
        base: a
      };
    });
    return {
      mz,
      it,
      peak
    };
  }
  const META = {
    file: "PXD001283_brain.mzpeak",
    instrument: "LTQ Orbitrap XL",
    analyzer: "Orbitrap",
    dims: [W, H],
    spectra: W * H,
    filled: MASK.reduce((a, b) => a + b, 0),
    mzRange: [85.81, 799.95],
    msLevels: [1],
    mode: "profile",
    pixelSize: 50,
    // ── Human-readable acquisition (UAT-r3 "Sample & Run" panel) ───────────
    run: "run_1",
    sample: "Mouse brain · sagittal section",
    software: ["Xcalibur v2.7.0", "mzPeak v0.3.1"],
    polarity: "positive",
    sources: ["PXD001283_brain.imzML"]
  };

  // Embedded optical images (UAT-r3 / ADD-01 "Optical" panel). Microscopy /
  // histology overviews carried in metadata.imaging.images[]; some register to
  // the MSI grid via a coarse affine, some are standalone.
  const OPTICAL = [{
    archivePath: "optical/he_overview.ome.tiff",
    sourceName: "he_overview.ome.tiff",
    role: "optical",
    width: 2048,
    height: 1536,
    affine: true,
    registrationQuality: "affine (coarse)"
  }, {
    archivePath: "optical/autofluorescence.tiff",
    sourceName: "autofluorescence.tiff",
    role: "fluorescence",
    width: 1024,
    height: 768,
    affine: false,
    registrationQuality: null
  }];
  window.MZ = {
    W,
    H,
    MASK,
    TIC,
    ION,
    MZS,
    BASEPEAK,
    META,
    OPTICAL,
    PEAKS,
    paint,
    paintBasePeak,
    paintMulti,
    spectrumAt,
    colormap,
    percentile,
    inMaskIdx: i => !!MASK[i]
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mzpeak-iv/engine.js", error: String((e && e.message) || e) }); }

// ui_kits/mzpeak-iv/icons.js
try { (() => {
/* mzPeak IV — icon set (Lucide-style line icons, MIT). Exposed on window.Icons. */
(function () {
  const S = (paths, extra) => function Icon(props) {
    const {
      size = 16,
      ...rest
    } = props || {};
    return React.createElement("svg", Object.assign({
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, rest), paths.map((d, i) => React.createElement(d[0], Object.assign({
      key: i
    }, d[1]))));
  };
  const P = d => ["path", {
    d
  }];
  const C = (cx, cy, r) => ["circle", {
    cx,
    cy,
    r
  }];
  const R = (x, y, w, h, rx) => ["rect", {
    x,
    y,
    width: w,
    height: h,
    rx
  }];
  const L = (x1, y1, x2, y2) => ["line", {
    x1,
    y1,
    x2,
    y2
  }];
  window.Icons = {
    Upload: S([P("M12 3v12"), P("m7 8 5-5 5 5"), P("M5 21h14")]),
    Image: S([R(3, 3, 18, 18, 2), C(8.5, 8.5, 1.5), P("m21 15-5-5L5 21")]),
    Layers: S([P("m12 2 9 5-9 5-9-5 9-5Z"), P("m3 12 9 5 9-5"), P("m3 17 9 5 9-5")]),
    Grid: S([R(3, 3, 7, 7, 1), R(14, 3, 7, 7, 1), R(14, 14, 7, 7, 1), R(3, 14, 7, 7, 1)]),
    Crosshair: S([C(12, 12, 9), L(12, 2, 12, 5), L(12, 19, 12, 22), L(2, 12, 5, 12), L(19, 12, 22, 12)]),
    Download: S([P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), P("M12 3v12"), P("m7 10 5 5 5-5")]),
    ChevDown: S([P("m6 9 6 6 6-6")]),
    ChevRight: S([P("m9 6 6 6-6 6")]),
    PanelLeft: S([R(3, 3, 18, 18, 2), L(9, 3, 9, 21)]),
    Search: S([C(11, 11, 8), L(21, 21, 16.65, 16.65)]),
    Info: S([C(12, 12, 10), L(12, 16, 12, 12), L(12, 8, 12.01, 8)]),
    X: S([P("M18 6 6 18"), P("m6 6 12 12")]),
    Check: S([P("M20 6 9 17l-5-5")]),
    Sliders: S([L(4, 21, 4, 14), L(4, 10, 4, 3), L(12, 21, 12, 12), L(12, 8, 12, 3), L(20, 21, 20, 16), L(20, 12, 20, 3), L(1, 14, 7, 14), L(9, 8, 15, 8), L(17, 16, 23, 16)]),
    Sigma: S([P("M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8L12 12l-5.9 7.2a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2")]),
    Maximize: S([P("M8 3H5a2 2 0 0 0-2 2v3"), P("M21 8V5a2 2 0 0 0-2-2h-3"), P("M3 16v3a2 2 0 0 0 2 2h3"), P("M16 21h3a2 2 0 0 0 2-2v-3")]),
    Flask: S([P("M9 3h6"), P("M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.3h12.4a1.5 1.5 0 0 0 1.3-2.3L14 9.5V3"), L(8, 14, 16, 14)]),
    Link: S([P("M9 17H7A5 5 0 0 1 7 7h2"), P("M15 7h2a5 5 0 0 1 0 10h-2"), L(8, 12, 16, 12)]),
    Dot: S([C(12, 12, 3)]),
    Eye: S([P("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"), C(12, 12, 3)]),
    Ruler: S([P("M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z"), L(14, 7, 16, 9), L(11, 10, 13, 12), L(8, 13, 10, 15)])
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mzpeak-iv/icons.js", error: String((e && e.message) || e) }); }

// ui_kits/mzpeak-iv/panels.jsx
try { (() => {
/* mzPeak IV — shell panels: TopBar, Rail, SpectrumDock, StatusBar. → window */
const DS = window.MzPeakDesignSystem_019e25;
const {
  Button,
  Badge,
  Panel,
  StatRow,
  SegmentedControl,
  ColormapScale
} = DS;
function TopBar({
  fileName,
  railOpen,
  onToggleRail,
  onReset,
  tweaksOpen,
  onTweaks
}) {
  const I = window.Icons;
  return /*#__PURE__*/React.createElement("header", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("button", {
    className: "iconbtn topbar__menu",
    onClick: onToggleRail,
    "aria-pressed": railOpen,
    title: "Toggle inspector"
  }, /*#__PURE__*/React.createElement(I.PanelLeft, {
    size: 17
  })), /*#__PURE__*/React.createElement("div", {
    className: "topbar__brand"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/openms-logo.png",
    alt: "OpenMS"
  }), /*#__PURE__*/React.createElement("div", {
    className: "topbar__div"
  }), /*#__PURE__*/React.createElement("div", {
    className: "topbar__prod"
  }, /*#__PURE__*/React.createElement("b", null, "mzPeak\xA0IV"), /*#__PURE__*/React.createElement("span", null, "Imaging Viewer"))), fileName && /*#__PURE__*/React.createElement("div", {
    className: "topbar__file",
    title: fileName
  }, /*#__PURE__*/React.createElement(I.Flask, {
    size: 13
  }), " ", fileName), /*#__PURE__*/React.createElement("div", {
    className: "topbar__spacer"
  }), /*#__PURE__*/React.createElement("div", {
    className: "topbar__actions"
  }, fileName && /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(I.Upload, {
      size: 14
    }),
    onClick: onReset
  }, "Open file"), /*#__PURE__*/React.createElement("button", {
    className: "iconbtn",
    "aria-pressed": tweaksOpen,
    onClick: onTweaks,
    title: "Display settings"
  }, /*#__PURE__*/React.createElement(I.Sliders, {
    size: 16
  })), /*#__PURE__*/React.createElement("a", {
    className: "iconbtn",
    href: "https://github.com/okohlbacher/mzPeakIV",
    target: "_blank",
    rel: "noreferrer",
    title: "About"
  }, /*#__PURE__*/React.createElement(I.Info, {
    size: 16
  }))));
}
function Rail({
  meta,
  grid,
  view,
  optical,
  selectedOptical,
  onSelectOptical
}) {
  const I = window.Icons;
  const dims = grid ? `${meta.dims[0]} × ${meta.dims[1]}` : null;
  return /*#__PURE__*/React.createElement("aside", {
    className: "rail mz-scroll",
    "data-testid": "inspector-rail"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rail__head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "rail__title"
  }, "Inspector"), /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true
  }, "Ready")), /*#__PURE__*/React.createElement(Panel, {
    title: "Sample & Run",
    defaultOpen: true
  }, /*#__PURE__*/React.createElement(StatRow, {
    label: "Run",
    value: meta.run
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Sample",
    value: meta.sample
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Instrument",
    value: meta.instrument
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Software",
    value: meta.software.join(" · ")
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Polarity",
    value: meta.polarity
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Spectrum mode",
    value: meta.mode
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Source",
    value: meta.sources.join(", ")
  })), /*#__PURE__*/React.createElement(Panel, {
    title: "Image Info",
    count: grid ? "5" : "—",
    defaultOpen: true
  }, /*#__PURE__*/React.createElement(StatRow, {
    label: "Dimensions",
    value: dims ? /*#__PURE__*/React.createElement(React.Fragment, null, dims, " ", /*#__PURE__*/React.createElement("em", null, "px")) : null
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Spectra",
    value: meta.spectra.toLocaleString()
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Pixels with data",
    value: meta.filled.toLocaleString()
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "m/z range",
    value: /*#__PURE__*/React.createElement(React.Fragment, null, meta.mzRange[0], " \u2013 ", meta.mzRange[1], " ", /*#__PURE__*/React.createElement("em", null, "Da"))
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Pixel size",
    value: /*#__PURE__*/React.createElement(React.Fragment, null, meta.pixelSize, " ", /*#__PURE__*/React.createElement("em", null, "\xB5m"))
  })), optical && optical.length > 0 && /*#__PURE__*/React.createElement(Panel, {
    title: "Optical",
    count: String(optical.length),
    defaultOpen: true
  }, /*#__PURE__*/React.createElement("div", {
    "data-testid": "optical-list"
  }, optical.map(im => {
    const sel = im.archivePath === selectedOptical;
    return /*#__PURE__*/React.createElement("button", {
      key: im.archivePath,
      type: "button",
      "aria-pressed": sel,
      onClick: () => onSelectOptical && onSelectOptical(im.archivePath),
      className: `optical-item${sel ? " optical-item--active" : ""}`
    }, /*#__PURE__*/React.createElement("div", {
      className: "optical-item__head"
    }, /*#__PURE__*/React.createElement("span", {
      className: "optical-item__name",
      title: im.sourceName
    }, im.sourceName), /*#__PURE__*/React.createElement(Badge, {
      tone: im.role === "optical" ? "info" : "neutral"
    }, im.role)), /*#__PURE__*/React.createElement(StatRow, {
      label: "Size",
      value: /*#__PURE__*/React.createElement(React.Fragment, null, im.width.toLocaleString(), " \xD7 ", im.height.toLocaleString(), " ", /*#__PURE__*/React.createElement("em", null, "px"))
    }), /*#__PURE__*/React.createElement(StatRow, {
      label: "Registration",
      value: im.affine ? im.registrationQuality ?? "affine" : "none (standalone)"
    }));
  }))), /*#__PURE__*/React.createElement(Panel, {
    title: "Format details",
    defaultOpen: false
  }, /*#__PURE__*/React.createElement("div", {
    className: "format-details"
  }, /*#__PURE__*/React.createElement(Panel, {
    title: "Metadata",
    defaultOpen: false
  }, /*#__PURE__*/React.createElement(StatRow, {
    label: "File",
    value: meta.file
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Format",
    value: "mzPeak v0.3"
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Storage",
    value: "Parquet \xB7 3 row-groups"
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Coordinate source",
    value: "scan cvParams"
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Analyzer",
    value: meta.analyzer
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "MS levels",
    value: meta.msLevels.join(", ")
  })), /*#__PURE__*/React.createElement(Panel, {
    title: "Capabilities",
    defaultOpen: false
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap",
      paddingTop: 4
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true
  }, "Imaging"), /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true
  }, "Coordinates"), /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true
  }, "TIC"), /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral"
  }, "Numpress n/a"))), /*#__PURE__*/React.createElement(Panel, {
    title: "Grid Diagnostics",
    defaultOpen: false
  }, /*#__PURE__*/React.createElement(StatRow, {
    label: "Orientation",
    value: "top-left \xB7 y-down"
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Coordinate base",
    value: "1-based"
  }), /*#__PURE__*/React.createElement(StatRow, {
    label: "Fill",
    value: /*#__PURE__*/React.createElement(React.Fragment, null, Math.round(100 * meta.filled / meta.spectra), /*#__PURE__*/React.createElement("em", null, "%"))
  })))));
}

/* ── Spectrum canvas drawing ──────────────────────────────────────────────── */
function drawSpectrum(canvas, spec, mzWindow) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const padL = 8,
    padR = 8,
    padT = 8,
    padB = 20;
  const cs = getComputedStyle(document.documentElement);
  const line = cs.getPropertyValue("--spectrum-line").trim() || "#3b54da";
  const grid = "#eceff2",
    axis = "#9aa4ad";
  if (!spec) {
    ctx.fillStyle = "#aab2ba";
    ctx.font = "12px 'IBM Plex Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Click a pixel on the ion image to inspect its spectrum", w / 2, h / 2);
    return;
  }
  const N = spec.mz.length;
  const x0 = spec.mz[0],
    x1 = spec.mz[N - 1];
  let mx = 0;
  for (let i = 0; i < N; i++) if (spec.it[i] > mx) mx = spec.it[i];
  mx = mx || 1;
  const X = mz => padL + (mz - x0) / (x1 - x0) * (w - padL - padR);
  const Y = v => h - padB - v / mx * (h - padT - padB);
  // gridlines
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const yy = padT + g * (h - padT - padB) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(w - padR, yy);
    ctx.stroke();
  }
  // selection band
  if (mzWindow) {
    ctx.fillStyle = "rgba(255,200,0,0.25)";
    const bx0 = X(mzWindow.mz - mzWindow.tol),
      bx1 = X(mzWindow.mz + mzWindow.tol);
    ctx.fillRect(bx0, padT, bx1 - bx0, h - padT - padB);
  }
  // area + line
  ctx.beginPath();
  ctx.moveTo(X(x0), Y(0));
  for (let i = 0; i < N; i++) ctx.lineTo(X(spec.mz[i]), Y(spec.it[i]));
  ctx.lineTo(X(x1), Y(0));
  ctx.closePath();
  ctx.fillStyle = "rgba(59,84,218,0.09)";
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const px = X(spec.mz[i]),
      py = Y(spec.it[i]);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // axis labels
  ctx.fillStyle = axis;
  ctx.font = "10px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  for (let t = 200; t <= 800; t += 200) {
    if (t < x0 || t > x1) continue;
    ctx.fillText(String(t), X(t), h - 6);
  }
}
function SpectrumDock({
  spec,
  heading,
  sub,
  mzWindow,
  onMean,
  meanActive
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current) return;
    drawSpectrum(ref.current, spec, mzWindow);
    const onR = () => drawSpectrum(ref.current, spec, mzWindow);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, [spec, mzWindow]);
  return /*#__PURE__*/React.createElement("section", {
    className: "dock"
  }, /*#__PURE__*/React.createElement("div", {
    className: "dock__head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dock__title"
  }, heading), sub && /*#__PURE__*/React.createElement("span", {
    className: "dock__meta"
  }, sub), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: meanActive ? "primary" : "secondary",
    size: "sm",
    onClick: onMean
  }, "\u2300 Mean spectrum")), /*#__PURE__*/React.createElement("div", {
    className: "dock__plot"
  }, /*#__PURE__*/React.createElement("canvas", {
    ref: ref
  })));
}
function StatusBar({
  meta,
  view,
  zoom
}) {
  const names = {
    overview: "Overview · TIC",
    basepeak: "Overview · Base-peak m/z",
    optical: "Optical image",
    ion: "Ion Image",
    multi: "Multi-channel"
  };
  return /*#__PURE__*/React.createElement("footer", {
    className: "statusbar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "statusbar__dot"
  }, /*#__PURE__*/React.createElement("b", null), " mzPeak v0.3 \xB7 client-side"), /*#__PURE__*/React.createElement("span", null, names[view] || "Overview"), /*#__PURE__*/React.createElement("span", {
    className: "statusbar__spacer"
  }), /*#__PURE__*/React.createElement("span", null, meta.dims[0], " \xD7 ", meta.dims[1], " px"), /*#__PURE__*/React.createElement("span", null, meta.filled.toLocaleString(), " / ", meta.spectra.toLocaleString(), " spectra"), /*#__PURE__*/React.createElement("span", null, Math.round(zoom * 100), "%"));
}
Object.assign(window, {
  TopBar,
  Rail,
  SpectrumDock,
  StatusBar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mzpeak-iv/panels.jsx", error: String((e && e.message) || e) }); }

// ui_kits/mzpeak-iv/stage.jsx
try { (() => {
/* mzPeak IV — stage: Toolbar, SettingsPopover, IonStage, MultiInputs, Loader. → window */
const D2 = window.MzPeakDesignSystem_019e25;
const {
  Button: Btn,
  SegmentedControl: Seg,
  NumberField: NF,
  Select: Sel,
  Checkbox: Chk,
  ColormapScale: CScale,
  Badge: Bdg
} = D2;
const MZW = window.MZ.W,
  MZH = window.MZ.H;

/* Fit a W:H canvas inside its container (contain), reacting to resize. */
function useFit(ratio, pad) {
  const ref = React.useRef(null);
  const [d, setD] = React.useState({
    w: 320,
    h: 240
  });
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const calc = () => {
      const cw = Math.max(40, el.clientWidth - (pad || 0));
      const ch = Math.max(40, el.clientHeight - (pad || 0));
      let w = cw,
        h = w / ratio;
      if (h > ch) {
        h = ch;
        w = h * ratio;
      }
      setD({
        w: Math.floor(w),
        h: Math.floor(h)
      });
    };
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    calc();
    return () => ro.disconnect();
  }, [ratio, pad]);
  return [ref, d];
}
function IonStage({
  paint,
  paintKey,
  colormap,
  low,
  high,
  selected,
  onPick,
  onHover,
  hint
}) {
  const [stageRef, d] = useFit(MZW / MZH, 56);
  const canRef = React.useRef(null);
  React.useEffect(() => {
    if (canRef.current && paint) paint(canRef.current);
  }, [paintKey]);
  const [ro, setRo] = React.useState(null);
  function toCell(e) {
    const r = canRef.current.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * MZW);
    const y = Math.floor((e.clientY - r.top) / r.height * MZH);
    if (x < 0 || x >= MZW || y < 0 || y >= MZH) return null;
    return {
      x,
      y
    };
  }
  const cell = MZW ? d.w / MZW : 1;
  return /*#__PURE__*/React.createElement("div", {
    className: "stage",
    ref: stageRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "imgframe",
    style: {
      width: d.w,
      height: d.h
    }
  }, /*#__PURE__*/React.createElement("canvas", {
    ref: canRef,
    className: onPick ? "cross" : "",
    style: {
      width: d.w,
      height: d.h
    },
    onMouseMove: onPick ? e => {
      const c = toCell(e);
      setRo(c);
      onHover && onHover(c);
    } : undefined,
    onMouseLeave: () => {
      setRo(null);
      onHover && onHover(null);
    },
    onClick: onPick ? e => {
      const c = toCell(e);
      if (c && window.MZ.MASK[c.y * MZW + c.x]) onPick(c);
    } : undefined
  }), selected && window.MZ.MASK[selected.y * MZW + selected.x] && /*#__PURE__*/React.createElement("div", {
    className: "selring",
    style: {
      left: selected.x * cell,
      top: selected.y * cell,
      width: cell + 1,
      height: cell + 1
    }
  })), hint && /*#__PURE__*/React.createElement("div", {
    className: "stage__readout",
    style: {
      left: "50%",
      right: "auto",
      top: "auto",
      bottom: 24,
      transform: "translateX(-50%)",
      textAlign: "center"
    }
  }, hint), !hint && low != null && /*#__PURE__*/React.createElement("div", {
    className: "stage__legend"
  }, /*#__PURE__*/React.createElement(CScale, {
    colormap: colormap,
    low: low,
    high: high,
    onStage: true
  })), !hint && /*#__PURE__*/React.createElement("div", {
    className: "stage__readout"
  }, ro ? window.MZ.MASK[ro.y * MZW + ro.x] ? /*#__PURE__*/React.createElement(React.Fragment, null, "x ", /*#__PURE__*/React.createElement("em", null, ro.x + 1), " \xB7 y ", /*#__PURE__*/React.createElement("em", null, ro.y + 1), /*#__PURE__*/React.createElement("br", null), "intensity ", /*#__PURE__*/React.createElement("em", null, fmtCompact(currentVal(paintKey, ro)))) : /*#__PURE__*/React.createElement(React.Fragment, null, "x ", ro.x + 1, " \xB7 y ", ro.y + 1, " \u2014 no data") : /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#8b95a0"
    }
  }, "Hover the image\u2026")), /*#__PURE__*/React.createElement("div", {
    className: "stage__scalebar"
  }, /*#__PURE__*/React.createElement("i", null), window.MZ.META.pixelSize * 64, " \xB5m"));
}

// Optical-image view (UAT-r3 / ADD-01): a standalone embedded microscopy /
// histology overview rendered native-aspect on the dark stage. The kit has no
// real pixels, so the frame is a striped placeholder labelled with the source.
function OpticalStage({
  image
}) {
  const ratio = image ? image.width / image.height : 4 / 3;
  const [stageRef, d] = useFit(ratio, 56);
  return /*#__PURE__*/React.createElement("div", {
    className: "stage",
    ref: stageRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "imgframe imgframe--native",
    style: {
      width: d.w,
      height: d.h
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "optical-ph",
    style: {
      width: d.w,
      height: d.h
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "optical-ph__cap"
  }, "optical image", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("em", null, image ? image.sourceName : "—")))), image && /*#__PURE__*/React.createElement("div", {
    className: "stage__readout",
    style: {
      minWidth: 196
    }
  }, image.sourceName, /*#__PURE__*/React.createElement("br", null), image.width.toLocaleString(), " \xD7 ", image.height.toLocaleString(), " ", /*#__PURE__*/React.createElement("em", null, "px"), /*#__PURE__*/React.createElement("br", null), "registration ", /*#__PURE__*/React.createElement("em", null, image.affine ? image.registrationQuality || "affine" : "none")));
}

// value lookup for readout (kept simple — reads the app-provided current field)
let CURRENT_FIELD = null;
function currentVal(_k, ro) {
  return CURRENT_FIELD ? CURRENT_FIELD[ro.y * MZW + ro.x] : 0;
}
function fmtCompact(v) {
  if (!isFinite(v)) return "—";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-2) return v.toExponential(1);
  return Number(v.toPrecision(3)).toLocaleString();
}
function SettingsPopover({
  s,
  set,
  onClose
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 30
    },
    onClick: onClose
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 54,
      right: 14,
      zIndex: 31,
      width: 264,
      background: "var(--surface)",
      border: "1px solid var(--border-hairline)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-pop)",
      padding: "14px 16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-2xs)",
      fontWeight: 600,
      letterSpacing: ".06em",
      textTransform: "uppercase",
      color: "var(--text-faint)",
      marginBottom: 10
    }
  }, "Display settings"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Colormap"
  }, /*#__PURE__*/React.createElement(Seg, {
    size: "sm",
    value: s.colormap,
    onChange: v => set({
      colormap: v
    }),
    options: [{
      value: "viridis",
      label: "viridis"
    }, {
      value: "inferno",
      label: "inferno"
    }, {
      value: "gray",
      label: "gray"
    }]
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Scale"
  }, /*#__PURE__*/React.createElement(Seg, {
    size: "sm",
    value: s.scale,
    onChange: v => set({
      scale: v
    }),
    options: [{
      value: "linear",
      label: "linear"
    }, {
      value: "log",
      label: "log"
    }]
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Percentile clip"
  }, /*#__PURE__*/React.createElement(Sel, {
    size: "sm",
    value: String(s.percentile),
    onChange: v => set({
      percentile: Number(v)
    }),
    options: [{
      value: "0.9",
      label: "90th pct"
    }, {
      value: "0.95",
      label: "95th pct"
    }, {
      value: "0.99",
      label: "99th pct"
    }, {
      value: "0.999",
      label: "99.9th pct"
    }]
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Contrast"
  }, /*#__PURE__*/React.createElement(Sel, {
    size: "sm",
    value: s.contrast,
    onChange: v => set({
      contrast: v
    }),
    options: [{
      value: "none",
      label: "None"
    }, {
      value: "equalize",
      label: "Equalize"
    }, {
      value: "clahe",
      label: "CLAHE"
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(Chk, {
    checked: s.ticNorm,
    onChange: v => set({
      ticNorm: v
    }),
    label: "TIC normalize"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)"
    }
  }, "\u03C3 ", /*#__PURE__*/React.createElement(NF, {
    size: "sm",
    width: "48px",
    value: s.smooth,
    onChange: v => set({
      smooth: v
    }),
    ariaLabel: "smooth"
  }))))));
}
function Field({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-2xs)",
      fontWeight: 600,
      letterSpacing: ".06em",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label), children);
}
function Loader({
  onOpen
}) {
  const I = window.Icons;
  const [over, setOver] = React.useState(false);
  const [url, setUrl] = React.useState("https://hupo-psi.github.io/…/PXD001283.mzpeak");
  return /*#__PURE__*/React.createElement("div", {
    className: "loader"
  }, /*#__PURE__*/React.createElement("div", {
    className: "loader__card"
  }, /*#__PURE__*/React.createElement("img", {
    className: "loader__logo",
    src: "../../assets/openms-logo.png",
    alt: "OpenMS"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "loader__h"
  }, "Open an imaging mzPeak file"), /*#__PURE__*/React.createElement("div", {
    className: "loader__p"
  }, "Reconstruct the pixel grid, render ion images for any m/z window, and inspect the spectrum behind any pixel \u2014 entirely in your browser.")), /*#__PURE__*/React.createElement("div", {
    className: "drop",
    "data-over": over,
    onDragOver: e => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: e => {
      e.preventDefault();
      setOver(false);
      onOpen();
    },
    onClick: onOpen
  }, /*#__PURE__*/React.createElement(I.Upload, {
    size: 22
  }), /*#__PURE__*/React.createElement("div", null, "Drop a ", /*#__PURE__*/React.createElement("strong", null, ".mzpeak"), " file here, or ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--accent)",
      textDecoration: "underline"
    }
  }, "browse"))), /*#__PURE__*/React.createElement("div", {
    className: "loader__url"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mz-input"
  }, /*#__PURE__*/React.createElement("input", {
    value: url,
    onChange: e => setUrl(e.target.value),
    "aria-label": "url",
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-xs)"
    }
  })), /*#__PURE__*/React.createElement(Btn, {
    variant: "secondary",
    onClick: onOpen
  }, "Load URL")), /*#__PURE__*/React.createElement("div", {
    className: "loader__demos"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-xs)",
      color: "var(--text-faint)",
      alignSelf: "center"
    }
  }, "Demos:"), /*#__PURE__*/React.createElement("button", {
    className: "chip",
    onClick: onOpen
  }, "brain \xB7 208\xD7150"), /*#__PURE__*/React.createElement("button", {
    className: "chip",
    onClick: onOpen
  }, "kidney \xB7 centroid"), /*#__PURE__*/React.createElement("button", {
    className: "chip",
    onClick: onOpen
  }, "small.mzpeak"))));
}
Object.assign(window, {
  IonStage,
  OpticalStage,
  SettingsPopover,
  Loader,
  setCurrentField: f => {
    CURRENT_FIELD = f;
  },
  fmtCompact
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mzpeak-iv/stage.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.ColormapScale = __ds_scope.ColormapScale;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.StatRow = __ds_scope.StatRow;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.NumberField = __ds_scope.NumberField;

__ds_ns.Select = __ds_scope.Select;

})();
