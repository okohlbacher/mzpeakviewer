import { test, expect } from "@playwright/test";

// Phase-5 deep-link / Share / legacy-shim end-to-end coverage.
//
// These exercise the URL grammar WIRED into the running app:
//   - ?file=…&view=…  auto-opens a remote .mzpeak and lands on the right view.
//   - ?file=…&spectrum=N  opens + selects a spectrum (Spectra view renders).
//   - /IV/?…  legacy shim redirects with the scan→spectrum + ion+tol→ion,tol
//     value rewrites applied.
//   - Share button produces a canonical link for the current view.
//
// The fixture is served same-origin as /demo.mzpeak (app/public/demo.mzpeak),
// so the engine opens it via HTTP range reads — the real WASM path. Timeouts
// are generous because parquet-wasm + the worker boot on first navigation.
//
// NOTE: these depend on App/main wiring (hydrateFromLocation on boot + a mounted
// <ShareButton/>). Until that wiring lands they may fail at the auto-open /
// share-btn steps; the modules themselves are build-clean.

const DEMO = "/demo.mzpeak";

// ---------------------------------------------------------------------------
// Deep-link: ?file + ?view=summary auto-loads the file and shows Summary.
// ---------------------------------------------------------------------------
test("deep link: ?file + view=summary auto-loads the file", async ({ page }) => {
  await page.goto(`/?file=${encodeURIComponent(DEMO)}&view=summary`);

  // The file auto-opens → capabilities readout appears (imaging fixture → yes).
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 60_000 });
  await expect(page.getByTestId("num-spectra")).not.toHaveText("0");

  // Summary view is active.
  await expect(page.getByTestId("summary-view")).toBeVisible({ timeout: 10_000 });
  expect(await page.getByTestId("error").count()).toBe(0);
});

// ---------------------------------------------------------------------------
// Deep-link: ?file + ?spectrum=0 auto-loads + selects a spectrum (Spectra view).
// ---------------------------------------------------------------------------
test("deep link: ?file + spectrum=0 lands on the Spectra view with a rendered spectrum", async ({
  page,
}) => {
  await page.goto(`/?file=${encodeURIComponent(DEMO)}&spectrum=0`);

  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 60_000 });

  // spectrum=N infers the Spectra view; a spectrum must render (uPlot canvas).
  await expect(page.getByTestId("spectra-view")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".chart-host canvas").first()).toBeVisible({ timeout: 20_000 });
  expect(await page.getByTestId("error").count()).toBe(0);
});

// ---------------------------------------------------------------------------
// Legacy /IV/ shim: scan=N → spectrum=N-1 and ion=mz + &tol=Da → ion=mz,Da.
// The shim is a static page that redirects to the app root (../) with the
// translated query, so after navigation location.search carries the rewrites.
// ---------------------------------------------------------------------------
test("legacy /IV/ shim redirects with scan→spectrum and ion+tol→ion,tol", async ({ page }) => {
  await page.goto("/IV/?ion=445.1&tol=0.1&scan=2");

  // Wait until the shim has redirected away from /IV/.
  await page.waitForURL((url) => !url.pathname.includes("/IV/"), { timeout: 15_000 });

  const search = new URL(page.url()).search;
  // scan=2 (1-based) → spectrum=1
  expect(search).toContain("spectrum=1");
  // ion=445.1 + tol=0.1 → ion=445.1,0.1 (comma URL-encoded as %2C)
  expect(decodeURIComponent(search)).toContain("ion=445.1,0.1");
  // The original scan/tol params must NOT survive verbatim.
  expect(search).not.toContain("scan=2");
  expect(search).not.toContain("tol=0.1");
});

// ---------------------------------------------------------------------------
// Share round-trip: open via ?file, click Share, assert the produced URL
// carries the file + (inferred) view/selection params.
// ---------------------------------------------------------------------------
test("share button produces a canonical deep link for the current view", async ({ page }) => {
  await page.goto(`/?file=${encodeURIComponent(DEMO)}&spectrum=0`);
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 60_000 });
  await expect(page.getByTestId("spectra-view")).toBeVisible({ timeout: 20_000 });

  const shareBtn = page.getByTestId("share-btn");
  await expect(shareBtn).toBeVisible({ timeout: 10_000 });
  await shareBtn.click();

  // The produced URL is mirrored into the address bar (replaceState) AND exposed
  // via the share-url readout. Assert on the address bar (most robust).
  await page.waitForFunction(() => window.location.search.includes("file="), { timeout: 5_000 });
  const search = decodeURIComponent(new URL(page.url()).search);
  expect(search).toContain("file=");
  expect(search).toContain(DEMO);
  // spectrum=0 selection round-trips as the spectrum form.
  expect(search).toContain("spectrum=0");
});
