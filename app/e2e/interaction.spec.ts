import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

// REAL user interactions — actual button clicks + the native file chooser, NOT
// setInputFiles (which bypasses the click flow and hid a double-open bug).
const IMAGING = fileURLToPath(new URL("../../packages/core/test/fixtures/imaging.mzpeak", import.meta.url));

test("Load demo button opens the bundled file (real click → openUrl)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("load-demo-btn").click();
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });
  await expect(page.getByTestId("num-spectra")).not.toHaveText("0");
  expect(await page.getByTestId("error").count()).toBe(0);
});

test("Open file button: one click opens the dialog EXACTLY once and loads the file", async ({ page }) => {
  await page.goto("/");
  let chooserOpens = 0;
  page.on("filechooser", async (chooser) => {
    chooserOpens += 1;
    await chooser.setFiles(IMAGING);
  });
  await page.getByTestId("open-file-btn").click();

  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });
  // Settle, then assert the native dialog opened ONCE — not twice / re-opening
  // (the label-wrapped-input double-fire bug).
  await page.waitForTimeout(1500);
  expect(chooserOpens).toBe(1);
  expect(await page.getByTestId("error").count()).toBe(0);
});

test("full real-click flow: demo → Spectra → Ion image → pixel → spectrum", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("load-demo-btn").click();
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });

  // Spectra (real nav click) — spectrum 0 already loaded on open.
  await page.getByTestId("nav-tab-spectra").click();
  await expect(page.getByTestId("spectra-view")).toBeVisible();
  await expect(page.locator(".chart-host canvas").first()).toBeVisible({ timeout: 15_000 });

  // Ion image (real clicks) → render → click a pixel → routes back to Spectra.
  await page.getByTestId("nav-tab-ion").click();
  await page.getByLabel("m/z", { exact: true }).fill("800");
  await page.getByLabel("tolerance in Da").fill("5000");
  await page.getByRole("button", { name: "Render" }).click();
  await expect(page.getByTestId("ion-image-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("ion-image-max")).not.toHaveText("max 0", { timeout: 30_000 });
  await page.getByTestId("ion-image-canvas").click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId("spectra-view")).toBeVisible({ timeout: 15_000 });

  expect(await page.getByTestId("error").count()).toBe(0);
});

test("Structure (real clicks): list members → inspect a parquet footer", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("load-demo-btn").click();
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });

  // Open Advanced accordion → Structure.
  await page.getByTestId("accordion-advanced").click();
  await page.getByTestId("nav-tab-structure").click();
  await expect(page.getByTestId("structure-view")).toBeVisible();
  // Members listed; click the first parquet member → its footer columns render.
  const parquetBtn = page.locator('[data-testid="structure-members"] button:not([disabled])').first();
  await expect(parquetBtn).toBeVisible({ timeout: 15_000 });
  await parquetBtn.click();
  await expect(page.getByTestId("structure-footer")).toBeVisible({ timeout: 20_000 });
  expect(await page.getByTestId("structure-error").count()).toBe(0);
});
