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
