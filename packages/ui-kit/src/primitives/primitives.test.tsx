/**
 * Design-system primitive contract tests.
 *
 * The vitest environment is "node" (no jsdom), so we assert the rendered markup
 * via react-dom/server's renderToStaticMarkup — enough to lock the class +
 * aria + structure contract each primitive promises, with no DOM toolchain.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Button,
  Select,
  Badge,
  StatRow,
  Panel,
} from "./index";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el);

describe("Button", () => {
  it("renders primary by default with .mz-btn", () => {
    const m = html(<Button>Go</Button>);
    expect(m).toContain('class="mz-btn"');
    expect(m).toContain("Go");
    expect(m).toContain('type="button"');
  });
  it("applies variant + size + block + icon modifiers", () => {
    const m = html(
      <Button variant="secondary" size="sm" block>
        X
      </Button>,
    );
    expect(m).toContain("mz-btn--secondary");
    expect(m).toContain("mz-btn--sm");
    expect(m).toContain("mz-btn--block");
  });
});

describe("Select", () => {
  it("renders native select + chevron with options", () => {
    const m = html(
      <Select
        value="viridis"
        ariaLabel="Colormap"
        options={[
          { value: "viridis", label: "viridis" },
          { value: "inferno", label: "inferno" },
        ]}
      />,
    );
    expect(m).toContain("mz-select");
    expect(m).toContain("mz-select__chev");
    expect(m).toContain("viridis");
    expect(m).toContain("inferno");
  });
});

describe("Badge", () => {
  it("applies tone + dot + mono", () => {
    const m = html(
      <Badge tone="success" dot mono>
        yes
      </Badge>,
    );
    expect(m).toContain("mz-badge--success");
    expect(m).toContain("mz-badge--mono");
    expect(m).toContain("mz-badge__dot");
    expect(m).toContain("yes");
  });
});

describe("StatRow", () => {
  it("renders key + value, forwards testid, em-dashes empty value", () => {
    const m = html(<StatRow label="Dimensions" value="260 × 134" testid="x" />);
    expect(m).toContain("mz-statrow__key");
    expect(m).toContain("Dimensions");
    expect(m).toContain('data-testid="x"');
    expect(m).toContain("260");
    const empty = html(<StatRow label="m/z" value={null} />);
    expect(empty).toContain("—");
  });
});

describe("Panel", () => {
  it("renders collapsible header with aria-expanded + count", () => {
    const m = html(
      <Panel title="Image Info" count={5}>
        body
      </Panel>,
    );
    expect(m).toContain("mz-panel");
    expect(m).toContain('aria-expanded="true"');
    expect(m).toContain("Image Info");
    expect(m).toContain("mz-panel__count");
    expect(m).toContain("body");
  });
  it("collapsed when defaultOpen=false (body hidden, chev rotated via data-open)", () => {
    const m = html(
      <Panel title="X" defaultOpen={false}>
        body
      </Panel>,
    );
    expect(m).toContain('data-open="false"');
    expect(m).toContain('aria-expanded="false"');
    expect(m).toContain("hidden");
  });
});
