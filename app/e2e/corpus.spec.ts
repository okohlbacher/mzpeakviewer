// DEEP CORPUS UI SWEEP — drives the BUILT viewer (real worker + WASM + Canvas) over the
// ENTIRE live corpus via HTTP range reads, exercising each file's capability surface:
// open → Summary, Spectra (plot renders, >0 pts unless chrom-only), Chromatograms (stored
// list), UV/VIS, Study design, Imaging (TIC overview canvas). OPT-IN: network-heavy and
// slow, so it only runs when CORPUS_SWEEP=1 and a URL list file is supplied:
//
//   CORPUS_SWEEP=1 CORPUS_LIST=/tmp/corpus_urls_new.txt npx playwright test e2e/corpus.spec.ts
//
// It never runs in CI (no env → every test skips).
import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

const LIST = process.env.CORPUS_LIST ?? "";
const ENABLED = process.env.CORPUS_SWEEP === "1" && existsSync(LIST);
const urls: string[] = ENABLED
  ? readFileSync(LIST, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  : [];

// Large SWATH/imaging files open in ~10-60 s over range reads; give each file headroom.
// Tests are INDEPENDENT (no serial mode — one failure must not skip the rest of the sweep).
test.describe.configure({ timeout: 300_000 });

async function openFile(page: Page, url: string): Promise<void> {
  // view=spectra via deep link — clicking right after ready races the URL hydration,
  // which re-applies the resolved view once the open settles.
  await page.goto(`/view/?file=${encodeURIComponent(url)}&view=spectra`);
  // Ready = the sidebar FILE panel shows the per-file stats; failure = the error banner.
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return (/FILE\s*\n\s*Spectra/i.test(t) && /Layout/i.test(t)) || /could ?n[o']t|corrupt|failed to fetch/i.test(t);
    },
    undefined,
    { timeout: 180_000 },
  );
}

function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

for (const url of urls) {
  const name = url.split("/v09/")[1] ?? url;
  test(`corpus: ${name}`, async ({ page }) => {
    test.skip(!ENABLED, "CORPUS_SWEEP not enabled");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

    await openFile(page, url);
    let text = await bodyText(page);
    expect(text, "open failed with an error banner").not.toMatch(/couldn.t open|corrupt file|failed to fetch/i);

    // numSpectra from the sidebar FILE panel.
    const m = /Spectra\s*\n?\s*([\d,]+)/.exec(text);
    const numSpectra = m ? Number(m[1]!.replace(/,/g, "")) : 0;

    // ── Spectra view: the plot must show >0 points for spectrum-carrying files. ──
    if (numSpectra > 0) {
      await page.getByTestId("nav-tab-spectra").click().catch(() => {}); // already there via deep link
      await page.waitForFunction(
        () => /\d+ points ·/.test(document.body.innerText) || /Loading spectrum/i.test(document.body.innerText),
        undefined,
        { timeout: 120_000 },
      );
      // Wait out a loading state; then require the points footer.
      await page.waitForFunction(() => /\d+ points ·/.test(document.body.innerText), undefined, { timeout: 180_000 });
      text = await bodyText(page);
      const pts = Number(/(\d+) points ·/.exec(text)?.[1] ?? "0");
      // Empty survey scans exist; step forward up to 3 times before judging.
      if (pts === 0) {
        for (let i = 0; i < 3; i++) await page.getByTestId("spectrum-next").click();
        await page.waitForFunction(() => /[1-9]\d* points ·/.test(document.body.innerText), undefined, { timeout: 60_000 }).catch(() => {});
        text = await bodyText(page);
      }
      expect(Number(/(\d+) points ·/.exec(text)?.[1] ?? "0"), "no spectrum points rendered").toBeGreaterThan(0);
    }

    // ── Chromatograms: stored list must enumerate when the tab exists. ──
    if (await page.getByTestId("nav-tab-chromatograms").count()) {
      await page.getByTestId("nav-tab-chromatograms").click();
      await page.waitForFunction(
        () => /Stored chromatograms \(\d+\)|add TIC/i.test(document.body.innerText),
        undefined,
        { timeout: 60_000 },
      );
    }

    // ── UV/VIS: spectrum plot must render points. ──
    if (await page.getByTestId("nav-tab-wavelength").count()) {
      await page.getByTestId("nav-tab-wavelength").click();
      await page.waitForFunction(() => /\d+ points · wavelength/i.test(document.body.innerText), undefined, { timeout: 60_000 });
    }

    // ── Study design: header strip or explicit empty state — never a blank view. ──
    if (await page.getByTestId("nav-tab-study").count()) {
      await page.getByTestId("nav-tab-study").click();
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="study-view"], [data-testid="study-empty"]');
          return !!el && (el.textContent ?? "").length > 0;
        },
        undefined,
        { timeout: 60_000 },
      );
    }

    // ── Imaging: the Overview (TIC) canvas must paint. ──
    if (await page.getByTestId("nav-tab-overview").count()) {
      await page.getByTestId("nav-tab-overview").click();
      await page.waitForFunction(() => !!document.querySelector("canvas"), undefined, { timeout: 90_000 });
    }

    expect(errors, `uncaught page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });
}
