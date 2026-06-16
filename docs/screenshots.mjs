// Capture user-manual screenshots from the running preview (localhost:4173) against the
// public demo datasets on data.mzpeak.org. Run: node docs/screenshots.mjs
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.env.PREVIEW_URL || "http://localhost:4173";
const D = "https://data.mzpeak.org/v09";
// file= takes the raw URL (commas pre-encoded as %2C); do NOT double-encode.
const BRUKER = `${D}/mzML-examples/bruker-microtof-q2/neg_01_Fistax_1-A%2C2_01_5715.mzpeak`;
const IMG = `${D}/imzml-examples/PXD001283-HR2MSI-urinary-bladder/HR2MSImouseurinarybladderS096.mzpeak`;
const TMT = `${D}/sdrf-examples/PXD011799/mzpeak/20170131_Lumos_RSLC4_Maurer_Hartl_UW_MFPL_TiO2_TMT_fr8.mzpeak`;
const OUT = "docs/images";
const T = 90_000;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.setDefaultTimeout(T);

const shots = [];
async function shot(name, url, prep) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await prep();
    await page.waitForTimeout(700); // settle paints/animations
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(`  ✓ ${name}`);
    shots.push(name);
  } catch (e) {
    console.log(`  ✗ ${name}: ${(e.message || e).split("\n")[0]}`);
  }
}
const see = (tid) => page.getByTestId(tid).first().waitFor({ state: "visible", timeout: T });

// 1) Start page — demo datasets, URL bar, dropzone
await shot("start-page", `${BASE}/`, async () => { await see("idle-view"); await see("demo-tmt"); });

// 2) Overview (Summary) — file overview, tiles, capabilities
await shot("overview", `${BASE}/?file=${BRUKER}&view=summary`, async () => {
  await see("summary-view"); await see("summary-tiles");
});

// 3) Deep link into a spectrum
await shot("spectra", `${BASE}/?file=${BRUKER}&spectrum=120`, async () => {
  await see("spectra-view"); await see("spectrum-points");
});

// 4) TMT reporter channels — open TMT, filter to MS2 so a reporter-bearing spectrum is shown
await shot("tmt-channels", `${BASE}/?file=${TMT}&view=spectra`, async () => {
  await see("spectra-view"); await see("spectrum-points");
  // filter to MS2 (native <select>); then step until the channel pills appear
  await page.getByTestId("ms-level-filter").selectOption("2").catch(() => {});
  for (let i = 0; i < 25; i++) {
    if (await page.getByTestId("channel-pills").isVisible().catch(() => false)) break;
    await page.getByTestId("spectrum-next").click().catch(() => {});
    await page.waitForTimeout(350);
  }
  await see("channel-pills");
});

// 5) Imaging — TIC overview heatmap (auto-renders for imaging files)
await shot("imaging-overview", `${BASE}/?file=${IMG}&view=overview`, async () => {
  await see("nav-tab-overview");
  await page.waitForTimeout(2500); // let the heatmap paint
});

// 6) Imaging — single-ion image (deep link sets m/z+tol; click Render if not auto)
await shot("imaging-ion", `${BASE}/?file=${IMG}&ion=798.5,0.25&view=ion`, async () => {
  await see("nav-tab-ion");
  const render = page.getByRole("button", { name: /render/i }).first();
  if (await render.isVisible().catch(() => false)) await render.click().catch(() => {});
  await page.waitForTimeout(6000); // cold ion render
});

// 7) Structure — parquet inspection: open a data parquet, expand a column
await shot("structure", `${BASE}/?file=${BRUKER}&view=structure`, async () => {
  await see("structure-view");
  const member = page.locator('[data-testid="structure-members"] button[data-parquet="true"]')
    .filter({ hasText: "spectra_metadata" });
  await member.first().click().catch(() => {});
  await see("structure-footer");
  await see("structure-rowgroups");
  // expand the first column row for the deep-stats panel
  await page.locator('[data-testid^="structure-col-"]').first().click().catch(() => {});
  await page.waitForTimeout(800);
});

await browser.close();
console.log(`\n[screenshots] ${shots.length}/7 captured → ${OUT}/`);
