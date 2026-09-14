import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

// CANONICAL GUARD — stored representations (2026-09-14 regression report).
//
// A dual-stored mzPeak file keeps EVERY spectrum twice: profile in spectra_data and
// centroid in spectra_peaks. Reported against v0.9.4 on a Shimadzu LCMS-9030 run
// (13,200 scans, all declared "profile", all stored as both):
//   1. the Summary did NOT show that centroid spectra are present,
//   2. the Spectra view did NOT permit selecting centroid vs profile,
//   3. only 13,200 spectra could be clicked through, not 2×13,200.
// Root cause: stored representations were never computed at open — the viewer counted the
// DECLARED representation and navigated scans. These tests drive the BUILT viewer (real
// worker + WASM) so the rendered Summary and navigator are what is asserted, on both the
// local-file path and the HTTP range-read (deep link) path.
//
// Fixtures: dual.mzpeak — 3 scans, each stored as profile (40 points) AND centroid
// (5 peaks); scans 0–1 declare profile, scan 2 declares centroid (so an "auto" selection
// of scan 2 displays centroid). chunked-numpress.mzpeak — 3 scans, centroid-only: the
// negative control, whose navigation must stay one record per scan with no filter.

const FIX = (n: string) => fileURLToPath(new URL(`../../packages/core/test/fixtures/${n}`, import.meta.url));
const DUAL = FIX("dual.mzpeak");
const SINGLE = FIX("chunked-numpress.mzpeak");
const PROFILE_PTS = "40";
const CENTROID_PTS = "5";

async function openLocal(page: Page, file: string) {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(file);
  await expect(page.getByTestId("num-spectra")).not.toHaveText("0", { timeout: 45_000 });
}

/** Waits until the displayed spectrum is scan `index` in representation `rep`. */
async function expectShown(page: Page, index: number, rep: "profile" | "centroid") {
  const meta = page.getByTestId("spectrum-meta");
  await expect(meta).toContainText(`abs #${index} `, { timeout: 30_000 });
  await expect(meta).toContainText(` ${rep} `);
  await expect(page.getByTestId("spectrum-points")).toHaveText(rep === "profile" ? PROFILE_PTS : CENTROID_PTS);
  await expect(page.getByTestId("spectrum-representation")).toHaveText(rep, { ignoreCase: true });
}

test.describe("stored representations — dual-stored file", () => {
  test("Summary shows that BOTH profile and centroid spectra are stored (issue 1)", async ({ page }) => {
    await openLocal(page, DUAL);
    await expect(page.getByTestId("summary-view")).toBeVisible();
    // Counts are records: 3 scans × 2 stored representations.
    await expect(page.getByTestId("num-spectra")).toHaveText("6", { timeout: 30_000 });
    await expect(page.getByTestId("stored-representations")).toHaveText("profile + centroid");
    await expect(page.getByTestId("summary-spectra")).toHaveText("6");
    const reps = page.getByTestId("summary-representations");
    await expect(reps).toContainText("3 profile");
    await expect(reps).toContainText("3 centroid");
    await expect(reps).toContainText("each of 3 scans stored as both");
    const ms1 = page.getByTestId("summary-ms-level-1");
    await expect(ms1).toContainText("6 spectra");
    await expect(ms1).toContainText("3 profile");
    await expect(ms1).toContainText("3 centroid");
    expect(await page.getByTestId("error").count()).toBe(0);
  });

  test("Spectra navigator pages through 2×N records, profile then centroid per scan (issue 3)", async ({ page }) => {
    await openLocal(page, DUAL);
    await page.getByTestId("nav-tab-spectra").click();
    await expectShown(page, 0, "profile");

    // Six records to click through — not three.
    const picker = page.getByTestId("spectrum-select");
    await expect(picker.locator("option")).toHaveCount(6);
    const labels = await picker.locator("option").allTextContents();
    expect(labels.map((l) => l.split(" · ").pop())).toEqual(["profile", "centroid", "profile", "centroid", "profile", "centroid"]);

    const order: [number, "profile" | "centroid"][] = [[0, "centroid"], [1, "profile"], [1, "centroid"], [2, "profile"], [2, "centroid"]];
    for (const [index, rep] of order) {
      await page.getByTestId("spectrum-next").click();
      await expectShown(page, index, rep);
    }
    await expect(page.getByTestId("spectrum-next")).toBeDisabled(); // record 6 of 6
    expect(await page.getByTestId("error").count()).toBe(0);
  });

  test("Representation filter selects profile vs centroid and keeps the scan (issue 2)", async ({ page }) => {
    await openLocal(page, DUAL);
    await page.getByTestId("nav-tab-spectra").click();
    await expectShown(page, 0, "profile");

    const filter = page.getByTestId("signal-source-select");
    await expect(filter).toBeVisible(); // known at open — no spectrum read decides this
    await expect(filter.locator("option")).toHaveText(["All (6)", "Profile (3)", "Centroid (3)"]);

    // Move to scan 1 (record 3), then filter — the same scan must stay selected.
    await page.getByTestId("spectrum-select").selectOption({ index: 2 });
    await expectShown(page, 1, "profile");

    await filter.selectOption("centroid");
    await expectShown(page, 1, "centroid");
    await expect(page.getByTestId("spectrum-select").locator("option")).toHaveCount(3);

    await filter.selectOption("profile");
    await expectShown(page, 1, "profile");
    await expect(page.getByTestId("spectrum-select").locator("option")).toHaveCount(3);

    await filter.selectOption("auto");
    await expectShown(page, 1, "profile");
    await expect(page.getByTestId("spectrum-select").locator("option")).toHaveCount(6);
    expect(await page.getByTestId("error").count()).toBe(0);
  });

  test.describe("deep links over HTTP range reads", () => {
    let server: Server;
    let base: string;
    test.beforeAll(async () => {
      const bytes = readFileSync(DUAL);
      server = createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "Range");
        res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
        res.setHeader("Accept-Ranges", "bytes");
        if (req.method === "OPTIONS") return void res.writeHead(204).end();
        const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
        if (!m) {
          res.writeHead(200, { "Content-Length": bytes.length });
          return void res.end(req.method === "HEAD" ? undefined : bytes);
        }
        let start = m[1] === "" ? bytes.length - Number(m[2]) : Number(m[1]);
        let end = m[1] === "" || m[2] === "" ? bytes.length - 1 : Math.min(Number(m[2]), bytes.length - 1);
        start = Math.max(0, start);
        end = Math.max(start, end);
        res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": end - start + 1 });
        res.end(req.method === "HEAD" ? undefined : bytes.subarray(start, end + 1));
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/dual.mzpeak`;
    });
    test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

    test("?sig=centroid&spectrum=1 opens that scan's centroid record with the filter set", async ({ page }) => {
      await page.goto(`/?file=${encodeURIComponent(base)}&view=spectra&spectrum=1&sig=centroid`);
      await expectShown(page, 1, "centroid");
      await expect(page.getByTestId("signal-source-select")).toHaveValue("centroid");
      await expect(page.getByTestId("spectrum-select").locator("option")).toHaveCount(3);
      expect(await page.getByTestId("error").count()).toBe(0);
    });

    test("an auto selection of a centroid-declared scan is identified as its centroid record", async ({ page }) => {
      // scan 2 declares centroid → auto displays centroid → the picker must sit on record
      // key 2·2+1 = 5 (record 6 of 6), not on the profile record of the same scan.
      await page.goto(`/?file=${encodeURIComponent(base)}&view=spectra&spectrum=2`);
      await expectShown(page, 2, "centroid");
      await expect(page.getByTestId("spectrum-select")).toHaveValue("5");
      await expect(page.getByTestId("spectrum-next")).toBeDisabled();
    });
  });
});

test("negative control: a single-representation file keeps one record per scan and no filter", async ({ page }) => {
  await openLocal(page, SINGLE);
  await expect(page.getByTestId("num-spectra")).toHaveText("3", { timeout: 30_000 });
  await expect(page.getByTestId("stored-representations")).toHaveCount(0);
  await expect(page.getByTestId("summary-representations")).toHaveCount(0);
  await page.getByTestId("nav-tab-spectra").click();
  await expect(page.getByTestId("spectrum-meta")).toContainText("abs #0 ", { timeout: 30_000 });
  await expect(page.getByTestId("signal-source-select")).toHaveCount(0);
  await expect(page.getByTestId("spectrum-select").locator("option")).toHaveCount(3);
  expect(await page.getByTestId("error").count()).toBe(0);
});
