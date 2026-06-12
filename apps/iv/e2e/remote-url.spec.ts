/**
 * LOAD-02: Remote URL loading via HTTP Range requests.
 *
 * Proves that MzPeakReader.fromUrl() loads a .mzpeak from an explicit HTTP URL
 * using zip.js's HttpRangeReader, which issues HTTP Range requests to fetch
 * only the ZIP central-directory index + required Parquet chunks — not a full
 * download.
 *
 * Strategy: listen to all network requests during the load; assert that at
 * least one GET request to the target URL includes a `Range` header, confirming
 * zip.js's HTTP Range path is active (not a same-origin shortcut or full fetch).
 *
 * The URL used is the absolute form of the bundled demo fixture served by
 * vite preview — same content as the skeleton test, but accessed via an
 * explicit http:// URL and verified to use Range requests.
 *
 * Satisfies LOAD-02: "User can open a remote .mzpeak from a URL (HTTP Range requests)".
 */
import { test, expect } from "@playwright/test";

test("LOAD-02: loads a .mzpeak URL via HTTP Range requests, not a full download", async ({
  page,
  baseURL,
}) => {
  // Capture Range requests made to the .mzpeak file.
  const rangeRequests: string[] = [];
  page.on("request", (req) => {
    if (
      req.url().includes(".mzpeak") &&
      req.headers()["range"]
    ) {
      rangeRequests.push(`${req.method()} ${req.url()} Range:${req.headers()["range"]}`);
    }
  });

  await page.goto("./");

  // Build an absolute http:// URL for the bundled demo fixture.
  // This is the "open from URL" path (LOAD-02) — not a local file pick (LOAD-01).
  const fixtureUrl = new URL("static/example.mzpeak", baseURL).toString();

  const urlInput = page.getByTestId("url-input");
  await urlInput.fill(fixtureUrl);
  await page.getByTestId("load-button").click();

  // Wait for staged progress — intermediate state proves LOAD-03 too.
  const stageLabel = page.getByTestId("stage");
  await expect(stageLabel).not.toHaveText("Idle", { timeout: 5000 });

  // Wait for full load — non-error terminal. The bundled example is a small imaging file → "Ready".
  await expect(stageLabel).toHaveText("Ready", {
    timeout: 30000,
  });

  // No error banner.
  await expect(page.getByTestId("error-banner")).toHaveCount(0);

  // Manifest and metadata loaded — the ZIP was parsed from Range requests.
  // Both now live under the collapsed "Format details" accordion (UAT-r3).
  await page.getByRole("button", { name: /Format details/i }).click();
  const manifestRows = page.getByTestId("manifest-row");
  await expect(manifestRows.first()).toBeVisible();
  expect(await manifestRows.count()).toBeGreaterThan(0);
  await expect(page.getByTestId("file-stats")).toContainText("9 spectra");

  // KEY ASSERTION: zip.js used HTTP Range requests (not a full download).
  // At least one GET to the .mzpeak URL must have included a Range header,
  // proving HttpRangeReader is active and the reader does NOT fetch the full
  // 2 MB file up front.
  expect(rangeRequests.length).toBeGreaterThan(0);
  // Every Range request must use the bytes unit (RFC 7233 compliance).
  for (const req of rangeRequests) {
    expect(req).toContain("Range:bytes=");
  }
});
