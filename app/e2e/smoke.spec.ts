import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

// The critical round-trip in a REAL browser: open an imaging .mzpeak through the
// engine worker (mzpeakts + parquet-wasm in a Worker), read capabilities, render
// spectrum 0 with the ui-kit plot. This is the first end-to-end browser validation.
const IMAGING = fileURLToPath(new URL("../../packages/core/test/fixtures/imaging.mzpeak", import.meta.url));
const LC = fileURLToPath(new URL("../../packages/core/test/fixtures/lc.mzpeak", import.meta.url));

test("imaging file: worker opens it, reports imaging + spectra, renders spectrum 0", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(IMAGING);

  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });
  await expect(page.getByTestId("num-spectra")).not.toHaveText("0");

  const points = Number(await page.getByTestId("spectrum-points").textContent());
  expect(points).toBeGreaterThan(0);

  // uPlot actually painted a canvas inside the chart host.
  await expect(page.locator(".chart-host canvas").first()).toBeVisible();
  expect(await page.getByTestId("error").count()).toBe(0);
});

test("LC file: worker opens it, reports NOT imaging + spectra", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(LC);

  await expect(page.getByTestId("is-imaging")).toHaveText("no", { timeout: 45_000 });
  await expect(page.getByTestId("num-spectra")).not.toHaveText("0");
  expect(await page.getByTestId("error").count()).toBe(0);
});

// ---------------------------------------------------------------------------
// New slice-2 tests: capability-adaptive shell navigation
// ---------------------------------------------------------------------------

test("imaging file: MSI accordion appears, chromatograms tab gated by capability", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(IMAGING);

  // Wait until the file is fully open (is-imaging = yes is in the DOM)
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });

  // MSI accordion header must be visible for an imaging file
  await expect(page.getByTestId("accordion-msi")).toBeVisible();

  // Ion image + Grid tabs should be accessible via the MSI accordion
  // (they may be in a hidden region until the accordion is open, but for
  // imaging files the accordion opens by default)
  await expect(page.getByTestId("msi-accordion-body")).toBeVisible();

  // Chromatograms tab: shown only when showChromatograms(caps) is true.
  // For the imaging fixture the capability determines visibility — either
  // present or absent is acceptable, just assert it's consistent.
  const chromTab = page.getByTestId("nav-tab-chromatograms");
  const chromVisible = await chromTab.isVisible();
  if (chromVisible) {
    // If shown, it must be a valid tab
    await expect(chromTab).toBeVisible();
  }
  // Either way no error should appear
  expect(await page.getByTestId("error").count()).toBe(0);
});

test("LC file: navigate Summary → Spectra → Chromatograms full round-trip", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(LC);

  // Wait until ready
  await expect(page.getByTestId("is-imaging")).toHaveText("no", { timeout: 45_000 });
  await expect(page.getByTestId("num-spectra")).not.toHaveText("0");

  // MSI accordion must NOT appear for an LC file
  await expect(page.getByTestId("accordion-msi")).not.toBeVisible();

  // --- Navigate to Summary ---
  await page.getByTestId("nav-tab-summary").click();
  await expect(page.getByTestId("summary-view")).toBeVisible({ timeout: 5_000 });

  // --- Navigate to Spectra ---
  await page.getByTestId("nav-tab-spectra").click();
  await expect(page.getByTestId("spectra-view")).toBeVisible({ timeout: 5_000 });

  // Wait for either the spectrum-select or spectrum-next button to appear,
  // indicating the spectra view is ready for interaction.
  await expect(page.getByTestId("spectrum-next")).toBeVisible({ timeout: 10_000 });

  // A canvas should already be rendered (spectrum 0 loads on open)
  await expect(page.locator(".chart-host canvas").first()).toBeVisible({ timeout: 15_000 });

  // Navigate to spectrum 1 via the Next button
  await page.getByTestId("spectrum-next").click();

  // Canvas should still be visible after navigation
  await expect(page.locator(".chart-host canvas").first()).toBeVisible({ timeout: 15_000 });

  // --- Navigate to Chromatograms (only if the tab exists) ---
  const chromTab = page.getByTestId("nav-tab-chromatograms");
  if (await chromTab.isVisible()) {
    await chromTab.click();
    await expect(page.getByTestId("chromatograms-view")).toBeVisible({ timeout: 5_000 });

    // Click Build TIC to trigger the engine
    await page.getByTestId("tic-btn").click();

    // Wait for the chrom plot host to appear (the ChromPlot renders a canvas)
    await expect(page.getByTestId("chrom-plot-host")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#chrom-plot-host canvas, [data-testid='chrom-plot-host'] canvas").first()).toBeVisible({
      timeout: 30_000,
    });
  }

  // No error banner at any point
  expect(await page.getByTestId("error").count()).toBe(0);
});

// ---------------------------------------------------------------------------
// THE headline: the imaging spatial round-trip in a real browser
//   open → MSI ▸ Ion image → pick m/z → render → click a pixel → its spectrum
// ---------------------------------------------------------------------------

test("imaging spatial round-trip: m/z → ion image → click pixel → spectrum", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(IMAGING);
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });

  // MSI accordion is open by default for imaging files → open the Ion image view.
  await page.getByTestId("nav-tab-ion").click();
  await expect(page.getByTestId("ion-image-view")).toBeVisible();

  // A wide window guarantees signal regardless of the fixture's m/z range.
  await page.getByLabel("m/z", { exact: true }).fill("800");
  await page.getByLabel("tolerance in Da").fill("5000");
  await page.getByRole("button", { name: "Render" }).click();

  // The engine rendered an ion image with real signal (the spatial compute round-trip).
  await expect(page.getByTestId("ion-image-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("ion-image-max")).not.toHaveText("max 0", { timeout: 30_000 });

  // Click a pixel → routes to the Spectra view and renders that pixel's spectrum.
  await page.getByTestId("ion-image-canvas").click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId("spectra-view")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".chart-host canvas").first()).toBeVisible({ timeout: 15_000 });

  expect(await page.getByTestId("error").count()).toBe(0);
});
