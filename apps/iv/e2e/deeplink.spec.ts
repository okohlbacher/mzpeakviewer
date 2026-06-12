import { test, expect } from "@playwright/test";

// Absolute, same-origin URL (no CORS) of the bundled non-imaging demo. The
// deep-link allowlist only accepts http(s)://|s3://, so the param must be a full
// URL — a relative path is intentionally rejected.
const SMALL = "http://localhost:4173/mzPeakIV/static/example.mzpeak";

test("?file=<url> auto-opens, no clicks (LOAD via deep link)", async ({ page }) => {
  await page.goto(`./?file=${encodeURIComponent(SMALL)}`);
  // example.mzpeak is a small imaging file → terminal "Ready".
  await expect(page.getByTestId("stage")).toHaveText("Ready", { timeout: 30000 });
  await expect(page.getByTestId("error-banner")).toHaveCount(0);
});

test("?url= alias also auto-opens", async ({ page }) => {
  await page.goto(`./?url=${encodeURIComponent(SMALL)}`);
  await expect(page.getByTestId("stage")).toHaveText("Ready", { timeout: 30000 });
});

test("Copy link appears for a URL-sourced file and round-trips", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`./?file=${encodeURIComponent(SMALL)}`);
  await expect(page.getByTestId("stage")).toHaveText("Ready", { timeout: 30000 });
  const copy = page.getByTestId("copy-link");
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(copy).toContainText("Copied");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  // Link must encode the ORIGINAL source url and round-trip back to it.
  expect(clip).toContain(`?file=${encodeURIComponent(SMALL)}`);
  expect(new URL(clip).searchParams.get("file")).toBe(SMALL);
});

test("no param → idle loader, no auto-open, no Copy link", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("drop-zone")).toBeVisible();
  await expect(page.getByTestId("stage")).toHaveText("Idle", { timeout: 10000 });
  await expect(page.getByTestId("copy-link")).toHaveCount(0);
});

test("bad/non-existent deep link → error shown + picker recoverable", async ({ page }) => {
  // Same-origin 404 (no external network): passes the scheme allowlist, fails to load.
  await page.goto(`./?file=${encodeURIComponent("http://localhost:4173/mzPeakIV/static/does-not-exist.mzpeak")}`);
  await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 30000 });
  // The file picker is still present so the user can recover without reload.
  await expect(page.getByTestId("drop-zone")).toBeVisible();
  await expect(page.getByTestId("file-input")).toBeAttached();
});

test("javascript: URL in param is rejected (not opened)", async ({ page }) => {
  await page.goto(`./?file=${encodeURIComponent("javascript:alert(1)")}`);
  await expect(page.getByTestId("stage")).toHaveText("Idle", { timeout: 10000 });
  await expect(page.getByTestId("drop-zone")).toBeVisible();
});
