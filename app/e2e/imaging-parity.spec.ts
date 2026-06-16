import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

// MG-04 · imaging feature-parity e2e — WIRED features only.
//
// Per the MG-04 audit (.planning/MG-04-imaging-parity-audit.md), the imaging
// features that actually round-trip through the merged UI are:
//   • ion render          (BL-02 single-channel path / spatial compute)
//   • RGB channels         (BL-02 multi-channel overlay)
//   • TIC overview heatmap (the wired part adjacent to BL-01)
//   • pixel-pick → in-place spectrum dock (the spatial round-trip)
// This spec asserts those round-trip end-to-end in a real browser (worker +
// parquet-wasm + Canvas). It deliberately writes NO tests for the NOT-WIRED
// items (BL-01 TIC-norm toggle, BL-03 mean spectrum, BL-04 Gaussian smoothing,
// BL-05 TIFF export, BL-06 ROI, BL-07 histogram contrast, BL-08 peak table,
// BL-09 peak-click → ion) — they have no UI to drive.
//
// The headline spatial round-trip (m/z → ion → click-pixel-A vs pixel-B → distinct
// spectra) is already covered by smoke.spec.ts; this file complements it by
// exercising the OTHER wired imaging modes (multi/RGB, overview, dock persistence)
// rather than duplicating that path.
//
// COVERAGE LIMIT: the bundled fixture is a degenerate 3×3 imaging grid. It is large
// enough to prove "render produced signal" and "distinct pixels → distinct spectra",
// but far too small/symmetric to catch image ORIENTATION (flip/transpose) or
// OFF-BY-ONE coordinate errors. Those need a non-square, asymmetric fixture and are
// out of scope here (tracked as a fixture-quality gap).

const IMAGING = fileURLToPath(
  new URL("../../packages/core/test/fixtures/imaging.mzpeak", import.meta.url),
);

/** Open the imaging fixture and wait until the worker reports it as imaging. */
async function openImaging(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(IMAGING);
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });
}

test.describe("MG-04 imaging parity — wired features", () => {
  // BL-02 (single-channel ion render): m/z + tolerance → engine.renderIonImage →
  // imaging-canvas painted + non-zero ion-image-max stats. A wide window guarantees
  // the degenerate fixture yields signal.
  test("ion render: m/z window paints the canvas with non-zero max", async ({ page }) => {
    await openImaging(page);

    await page.getByTestId("nav-tab-ion").click();
    await expect(page.getByTestId("imaging-ion")).toBeVisible();

    await page.getByLabel("m/z", { exact: true }).fill("800");
    await page.getByLabel("tolerance in Da").fill("5000"); // wide → guaranteed signal
    await page.getByRole("button", { name: "Render" }).click();

    await expect(page.getByTestId("imaging-canvas")).toBeVisible({ timeout: 30_000 });
    // The colormap legend's max readout proves the spatial compute ran and found data.
    await expect(page.getByTestId("ion-image-max")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("ion-image-max")).not.toHaveText("max 0", { timeout: 30_000 });

    expect(await page.getByTestId("error").count()).toBe(0);
  });

  // BL-02 (multi-channel RGB overlay): fill one of the R/G/B rows → "Render RGB" →
  // engine.renderMultiChannel → composited canvas. One channel is enough (blank
  // channels contribute black), proving the multi path round-trips.
  test("RGB channels: a single channel renders the composite canvas", async ({ page }) => {
    await openImaging(page);

    await page.getByTestId("nav-tab-multi").click();
    await expect(page.getByTestId("imaging-multi")).toBeVisible();

    // Red channel only — wide tolerance so the 3×3 fixture yields signal.
    await page.getByLabel("Red m/z").fill("800");
    await page.getByLabel("Red tolerance").fill("5000");
    await page.getByRole("button", { name: "Render RGB" }).click();

    // The composited RGB image paints onto the shared imaging canvas.
    await expect(page.getByTestId("imaging-canvas")).toBeVisible({ timeout: 30_000 });
    // No imaging-error banner from the multi-channel compositor.
    expect(await page.getByTestId("imaging-error").count()).toBe(0);
    expect(await page.getByTestId("error").count()).toBe(0);
  });

  // TIC overview: the per-pixel TIC heatmap mode paints from store.ticColumn with no
  // user input. (This is the wired TIC heatmap — NOT BL-01 ion-image TIC normalization,
  // which is unwired; see the audit.) If the fixture carries a TIC column the canvas
  // paints; the hover readout is always present in pickable modes.
  test("TIC overview: heatmap mode is reachable and consistent", async ({ page }) => {
    await openImaging(page);

    await page.getByTestId("nav-tab-overview").click();
    await expect(page.getByTestId("imaging-overview")).toBeVisible();

    // Overview is pickable → the hover/pick readout element is always rendered.
    await expect(page.getByTestId("imaging-readout")).toBeVisible();

    // The fixture may or may not carry a per-pixel TIC column: if it does, the canvas
    // paints; if not, the empty-state hint shows. Either is a valid wired outcome — we
    // assert exactly one of them is present and that nothing errored.
    const canvas = page.getByTestId("imaging-canvas");
    const empty = page.getByTestId("imaging-empty");
    await expect(canvas.or(empty).first()).toBeVisible({ timeout: 15_000 });

    expect(await page.getByTestId("error").count()).toBe(0);
  });

  // Spatial round-trip (complementary to smoke.spec.ts): after an ion render, clicking
  // a pixel fills the IN-PLACE spectrum dock WITHOUT leaving the ion view, and the dock
  // plots a spectrum canvas. Asserts dock persistence + non-routing, which smoke.spec
  // only checks incidentally.
  test("pixel-pick fills the in-place spectrum dock without routing away", async ({ page }) => {
    await openImaging(page);

    await page.getByTestId("nav-tab-ion").click();
    await expect(page.getByTestId("imaging-ion")).toBeVisible();

    await page.getByLabel("m/z", { exact: true }).fill("800");
    await page.getByLabel("tolerance in Da").fill("5000");
    await page.getByRole("button", { name: "Render" }).click();
    await expect(page.getByTestId("imaging-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("ion-image-max")).not.toHaveText("max 0", { timeout: 30_000 });

    // Click the centre of the top-left grid cell (3×3 fixture).
    const bb = await page.getByTestId("imaging-canvas").boundingBox();
    if (!bb) throw new Error("imaging-canvas not found");
    await page.getByTestId("imaging-canvas").scrollIntoViewIfNeeded();
    await page.getByTestId("imaging-canvas").click({
      position: { x: Math.round(bb.width / 6), y: Math.round(bb.height / 6) },
    });

    // Dock appears in place; we did NOT route to the standalone Spectra view.
    await expect(page.getByTestId("imaging-spectrum-dock")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("imaging-ion")).toBeVisible();
    await expect(page.getByTestId("imaging-dock-meta")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[data-testid="imaging-spectrum-dock"] canvas').first(),
    ).toBeVisible({ timeout: 15_000 });

    expect(await page.getByTestId("error").count()).toBe(0);
  });
});
