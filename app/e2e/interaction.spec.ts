import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

// REAL user interactions — actual button clicks + the native file chooser, NOT
// setInputFiles (which bypasses the click flow and hid a double-open bug).
const IMAGING = fileURLToPath(new URL("../../packages/core/test/fixtures/imaging.mzpeak", import.meta.url));

test("Load demo button returns to the start page to pick an example dataset", async ({ page }) => {
  await page.goto("/");
  // Open a file first so the viewer (not the start page) is showing.
  await page.getByTestId("file-input").setInputFiles(IMAGING);
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });
  // "Load demo" in the header → back to the start page with the example datasets.
  await page.getByTestId("load-demo-btn").click();
  await expect(page.getByTestId("idle-view")).toBeVisible();
  await expect(page.locator('[data-testid^="demo-"][data-testid$="-cloud"]')).toHaveCount(3);
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
  await page.getByTestId("file-input").setInputFiles(IMAGING);
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });

  // Spectra (real nav click) — spectrum 0 already loaded on open.
  await page.getByTestId("nav-tab-spectra").click();
  await expect(page.getByTestId("spectra-view")).toBeVisible();
  await expect(page.locator(".chart-host canvas").first()).toBeVisible({ timeout: 15_000 });

  // Ion image (real clicks) → render → click a pixel → spectrum fills the in-place dock.
  await page.getByTestId("nav-tab-ion").click();
  await page.getByLabel("m/z", { exact: true }).fill("800");
  await page.getByLabel("tolerance in Da").fill("5000");
  await page.getByRole("button", { name: "Render" }).click();
  await expect(page.getByTestId("imaging-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("ion-image-max")).not.toHaveText("max 0", { timeout: 30_000 });
  await page.getByTestId("imaging-canvas").click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId("imaging-spectrum-dock")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="imaging-spectrum-dock"] canvas').first()).toBeVisible({ timeout: 15_000 });

  expect(await page.getByTestId("error").count()).toBe(0);
});

test("Structure (real clicks): list members → inspect a parquet footer", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(IMAGING);
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });

  // Open Advanced accordion → Structure.
  await page.getByTestId("accordion-advanced").click();
  await page.getByTestId("nav-tab-structure").click();
  await expect(page.getByTestId("structure-view")).toBeVisible();
  // Members listed; click the first PARQUET member → its footer columns render.
  // (mzpeak_index.json is now also clickable — a redirect, not a footer — so target
  //  parquet members explicitly via data-parquet.)
  const parquetBtn = page.locator('[data-testid="structure-members"] button[data-parquet="true"]').first();
  await expect(parquetBtn).toBeVisible({ timeout: 15_000 });
  await parquetBtn.click();
  await expect(page.getByTestId("structure-footer")).toBeVisible({ timeout: 20_000 });
  expect(await page.getByTestId("structure-error").count()).toBe(0);
});

test("Structure: index.json first, then the Parquet payload, then embedded files", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(IMAGING);
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });
  await page.getByTestId("accordion-advanced").click();
  await page.getByTestId("nav-tab-structure").click();
  await expect(page.getByTestId("structure-view")).toBeVisible();
  // archiveList populates the member list asynchronously — wait for it before reading.
  await expect(page.locator('[data-testid="structure-members"] button').first()).toBeVisible({ timeout: 15_000 });

  // Category of each member row, in render order.
  const cats = await page
    .locator('[data-testid="structure-members"] button')
    .evaluateAll((btns) => btns.map((b) => b.getAttribute("data-category")));
  expect(cats.length).toBeGreaterThan(1);
  expect(cats[0]).toBe("manifest"); // index.json pinned first
  expect(cats).toContain("parquet");

  // Non-decreasing category rank → embedded files (image/other) only AFTER the parquet payload.
  const rank: Record<string, number> = { manifest: 0, parquet: 1, image: 2, other: 3 };
  for (let i = 1; i < cats.length; i++) {
    expect(rank[cats[i] ?? "other"]!).toBeGreaterThanOrEqual(rank[cats[i - 1] ?? "other"]!);
  }
});

test("local file: Share view is disabled (no shareable URL off this machine)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(IMAGING);
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });
  const shareBtn = page.getByTestId("share-btn");
  await expect(shareBtn).toBeVisible();
  await expect(shareBtn).toBeDisabled(); // local file → sourceUrl null → can't share
});

test("Structure → mzpeak_index.json redirects to the Metadata manifest (+ download enabled)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(IMAGING);
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });

  await page.getByTestId("accordion-advanced").click();
  await page.getByTestId("nav-tab-structure").click();
  await expect(page.getByTestId("structure-view")).toBeVisible();

  // Click the pinned manifest entry → lands on the Metadata view's Manifest section.
  await page.getByTestId("structure-manifest").click();
  await expect(page.getByTestId("metadata-view")).toBeVisible();
  await expect(page.getByTestId("metadata-manifest")).toBeVisible();
  // The raw mzpeak_index.json loaded → Download is enabled and the JSON tree renders.
  await expect(page.getByTestId("manifest-download")).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId("metadata-manifest").locator(".tree").first()).toBeVisible();
  expect(await page.getByTestId("manifest-error").count()).toBe(0);

  // Advanced sub-tabs switch between Metadata and Structure.
  await page.getByTestId("advanced-subtab-structure").click();
  await expect(page.getByTestId("structure-view")).toBeVisible();
  await page.getByTestId("advanced-subtab-metadata").click();
  await expect(page.getByTestId("metadata-view")).toBeVisible();

  // Metadata search filters the trees without error.
  await page.getByTestId("metadata-search").fill("run");
  await expect(page.getByTestId("metadata-view")).toBeVisible();
});

test("idle start page: example datasets (cloud + download), dropzone, URL field; file opens", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("idle-view")).toBeVisible();
  // Three curated example datasets, each offering both open modes.
  for (const id of ["bruker", "imaging", "tmt"]) {
    await expect(page.getByTestId(`demo-${id}`)).toBeVisible();
    await expect(page.getByTestId(`demo-${id}-cloud`)).toBeVisible();      // ☁ stream from S3/CDN
    await expect(page.getByTestId(`demo-${id}-download`)).toBeVisible();   // ⤓ download + open local
  }
  await expect(page.getByTestId("idle-dropzone")).toBeVisible();
  await expect(page.getByTestId("idle-url")).toBeVisible();

  // The open flow itself, exercised offline via the file picker (the demo datasets
  // are large remote CDN objects, unsuitable for a fast e2e click).
  await page.getByTestId("file-input").setInputFiles(IMAGING);
  await expect(page.getByTestId("is-imaging")).toHaveText("yes", { timeout: 45_000 });
  await expect(page.getByTestId("idle-view")).toHaveCount(0);
  expect(await page.getByTestId("error").count()).toBe(0);
});
