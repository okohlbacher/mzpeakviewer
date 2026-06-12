/**
 * Vitest tests for openFile.ts — local file loading via the reader boundary.
 *
 * Uses the real Node file system + the real mzpeakts WASM reader to prove that a
 * File/Blob opened locally yields a valid reader with numSpectra > 0.
 * (R-02a Playwright test covers the browser path.)
 */
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openFile } from "./openFile";
import { fileStats } from "./fileMeta";

const FIXTURE = fileURLToPath(
  new URL("../../test/data/example.mzpeak", import.meta.url),
);

describe("openFile — local File/Blob via BlobReader", () => {
  it("opens a Blob with numSpectra > 0", async () => {
    const bytes = await readFile(FIXTURE);
    // Simulate a browser File: wrap Buffer as Blob with a .name property.
    const file = new File([bytes], "example.mzpeak", {
      type: "application/octet-stream",
    });
    const reader = await openFile(file);
    const stats = fileStats(reader);
    expect(stats.numSpectra).toBeGreaterThan(0);
  });

  it("returns a reader with a non-empty file index after openFile", async () => {
    const bytes = await readFile(FIXTURE);
    const file = new File([bytes], "example.mzpeak", {
      type: "application/octet-stream",
    });
    const reader = await openFile(file);
    // The file index is populated by ZipStorage.init() — at least one entry.
    const entries = reader.store?.fileIndex?.files ?? [];
    expect(entries.length).toBeGreaterThan(0);
  });
});
