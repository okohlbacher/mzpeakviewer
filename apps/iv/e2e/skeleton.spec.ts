import { test, expect } from "@playwright/test";

// Walking-skeleton end-to-end proof: open a REAL demo .mzpeak from a URL with the
// REAL WASM reader, see real metadata + manifest, select a spectrum index, and
// see the uPlot chart render. Proves file -> metadata -> select -> plotted arrays
// with no COOP/COEP (served by `vite preview`).
test("loads a real .mzpeak by URL, shows manifest + stats, plots a spectrum", async ({
  page,
}) => {
  await page.goto("./");

  // Loader zone: the default demo URL now points at a remote imaging dataset, so
  // load the committed offline fixture explicitly to keep this test fast + hermetic.
  await page.getByTestId("url-input").fill("/mzPeakIV/static/example.mzpeak");
  await page.getByTestId("load-button").click();

  // Wait for the staged load to reach a non-error TERMINAL state. The bundled
  // example (example.mzpeak) is a small imaging file, so it reaches
  // "Ready".
  // The walking-skeleton proof (metadata + manifest + spectrum) still holds.
  await expect(page.getByTestId("stage")).toHaveText(
    "Ready",
    { timeout: 30000 },
  );

  // No error banner.
  await expect(page.getByTestId("error-banner")).toHaveCount(0);

  // Manifest + raw metadata now live under the collapsed "Format details"
  // accordion (UAT-r3) — expand it before asserting their content.
  await page.getByRole("button", { name: /Format details/i }).click();

  // Left panel: manifest has at least one real entity row.
  const manifestRows = page.getByTestId("manifest-row");
  await expect(manifestRows.first()).toBeVisible();
  expect(await manifestRows.count()).toBeGreaterThan(0);

  await expect(page.getByTestId("file-stats")).toContainText("9 spectra");

  // Right panel: spectrum index selector + uPlot canvas.
  const indexInput = page.getByTestId("spectrum-index");
  await expect(indexInput).toBeVisible();
  await indexInput.fill("0");
  await indexInput.dispatchEvent("change");

  // uPlot renders a <canvas> inside the plot container.
  const canvas = page.getByTestId("spectrum-plot").locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 15000 });
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);
});
