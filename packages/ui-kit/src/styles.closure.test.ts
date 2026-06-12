// Style closure test (codex Phase-2 review #6 fix). Guards the harvest-parity claim
// that the design system is self-contained: every CSS custom property referenced in
// the bundled stylesheet is defined in it, and every className a presentational
// component emits has a matching selector. This is what would have caught the
// missing `.tree-*`/`.chart-host` selectors and the undefined `--syntax-*` vars.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// The CSS that ships in @mzpeak/ui-kit/styles.css (excluding the external uPlot
// stylesheet, which defines the .u-*/.uplot classes the plot relies on).
const CSS_FILES = [
  "styles/tokens/colors.css",
  "styles/tokens/colormaps.css",
  "styles/tokens/typography.css",
  "styles/tokens/spacing.css",
  "styles/tokens/aliases.css",
  "styles/tokens/base.css",
  "styles/components.css",
  "styles/explorer-components.css",
].map((p) => readFileSync(join(here, p), "utf8"));

const css = CSS_FILES.join("\n");

// Classes provided by external stylesheets (uPlot) or applied by the host app
// shell, not by the design system itself — allowed to be emitted without a local rule.
const EXTERNAL_CLASS_PREFIXES = ["u-", "uplot", "data-stage"];

function definedVars(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:/g)) out.add(m[1]!);
  return out;
}
function referencedVars(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) out.add(m[1]!);
  return out;
}
function definedClasses(src: string): Set<string> {
  const out = new Set<string>();
  // class tokens in selectors: .foo, .foo-bar, including compound .a.b
  for (const m of src.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(m[1]!);
  return out;
}

// A token that LOOKS like a design-system class (so it must have a CSS rule). We
// scan ALL string literals — not just JSX `className=` — so `el.className = "x"`,
// concatenations (`"mz-btn " + ...`), and arrays (`["mz-seg", ...]`) are covered
// too (re-review: JSX-only extraction was unsound). External classes (uPlot `u-*`,
// the app `data-stage` context) are allow-listed separately.
const DS_CLASS = /^(mz-[\w-]*|tree(-[\w-]+)?|chart-[\w-]+|spec-[\w-]+)$/;

/** Every design-system class token a component could emit (from any string literal). */
function emittedClasses(dir: string): Map<string, string> {
  const found = new Map<string, string>(); // token -> file
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx$/.test(name) || /\.test\./.test(name)) continue;
      let src = readFileSync(p, "utf8");
      // Neutralize template interpolations so `a${x}` yields the literal token `a`.
      src = src.replace(/\$\{[^}]*\}/g, " ");
      // Every string-literal body: "...", '...', `...`.
      const bodies: string[] = [];
      for (const m of src.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
        bodies.push(m[1] ?? m[2] ?? m[3] ?? "");
      }
      for (const body of bodies) {
        for (const tok of body.split(/\s+/)) {
          if (DS_CLASS.test(tok) && !found.has(tok)) found.set(tok, p);
        }
      }
    }
  };
  walk(join(here, dir));
  return found;
}

describe("ui-kit style closure", () => {
  it("every var() referenced in the bundled CSS is defined in it", () => {
    const defined = definedVars(css);
    const dangling = [...referencedVars(css)].filter((v) => !defined.has(v));
    expect(dangling, `undefined CSS variables: ${dangling.join(", ")}`).toEqual([]);
  });

  it("every className a component emits has a matching selector (or is external)", () => {
    const defined = definedClasses(css);
    const emitted = emittedClasses("."); // all of src/
    const definedArr = [...defined];
    const missing: string[] = [];
    for (const [tok, file] of emitted) {
      if (defined.has(tok)) continue;
      if (EXTERNAL_CLASS_PREFIXES.some((pre) => tok === pre || tok.startsWith(pre))) continue;
      // A token ending in `-` is a dynamic-modifier PREFIX (e.g. `mz-cmap__bar--`
      // from `mz-cmap__bar--${colormap}`): accept if any defined class extends it.
      if (tok.endsWith("-") && definedArr.some((d) => d.startsWith(tok))) continue;
      missing.push(`${tok} (${file.replace(here, "src")})`);
    }
    expect(missing, `classNames with no CSS rule: ${missing.join("; ")}`).toEqual([]);
  });
});
