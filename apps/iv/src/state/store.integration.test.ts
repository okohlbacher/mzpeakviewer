/**
 * Real-reader integration tests for the store's load path.
 *
 * Unlike store.test.ts (which mocks the reader boundary), these tests use the
 * actual vendored mzpeakts reader against the bundled example.mzpeak imaging
 * fixture — the same small imaging file used by the e2e tests. This proves the
 * real reader path (not just the mocked branch).
 *
 * Separate file so vi.mock() in store.test.ts doesn't interfere.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
// test-setup.ts (setupFiles) ensures Worker polyfill is installed before this
// module — no additional stubbing required here.
import { useStore } from "./store";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "../../test/data/example.mzpeak");

describe("store integration — real example.mzpeak (imaging fixture)", () => {
  beforeEach(() => {
    useStore.setState({
      fileMeta: null,
      manifest: [],
      stats: null,
      capabilities: null,
      grid: null,
      stage: "idle",
      error: null,
      selectedIndex: null,
      selectedSpectrum: null,
    });
  });

  it.skip("loads example.mzpeak: stage=ready, grid set, error=null, isImaging=true", async () => {
    // Phase 5 (Plan 05-03) moved the mzpeakts reader into a Web Worker.
    // store.ts is now a thin dispatcher — openFile() posts a loadFile message
    // and awaits a WorkerResponse. In Node test environment, Worker is a
    // no-op polyfill (test-setup.ts), so the Worker response never arrives
    // and the store stays at stage:'zip-index'.
    //
    // This real-reader integration path is now covered by:
    //   - store.test.ts (mocked Worker, full onmessage routing tested)
    //   - e2e Playwright tests (real Worker + real file on the deployed page)
    //
    // To test the Worker's real-reader path in isolation, export the internal
    // handler functions from mzPeakWorker.ts and call them directly, or add
    // a Playwright spec that exercises the non-imaging code path.
    void FIXTURE; // suppress unused-import warning
    const bytes = readFileSync(FIXTURE);
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const file = new File([blob], "example.mzpeak");

    await useStore.getState().openFile(file);

    const state = useStore.getState();
    expect(state.stage).toBe("ready");
    expect(state.error).toBeNull();
    expect(state.grid).not.toBeNull();
    expect(state.capabilities?.isImaging).toBe(true);
    expect(state.manifest.length).toBeGreaterThan(0);
    expect(state.stats?.numSpectra).toBeGreaterThan(0);
  });
});
