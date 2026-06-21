import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { gunzipBytes, decompressedName, isGzip } from "./gunzip";

describe("gunzipBytes", () => {
  it("round-trips a gzip buffer back to the original bytes", async () => {
    const original = new TextEncoder().encode("sample\tvalue\nA\t1\nB\t2\n".repeat(50));
    const gz = new Uint8Array(gzipSync(Buffer.from(original))); // produced by an INDEPENDENT zlib impl
    const out = await gunzipBytes(gz);
    expect(out).toEqual(original);
  });

  it("rejects non-gzip input", async () => {
    await expect(gunzipBytes(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});

describe("decompressedName / isGzip", () => {
  it("strips a single trailing .gz (case-insensitive)", () => {
    expect(decompressedName("sample_metadata/sdrf.tsv.gz")).toBe("sample_metadata/sdrf.tsv");
    expect(decompressedName("data.GZ")).toBe("data");
    expect(decompressedName("plain.parquet")).toBe("plain.parquet"); // no .gz → unchanged
  });
  it("detects gzip members by suffix", () => {
    expect(isGzip("a/b.tsv.gz")).toBe(true);
    expect(isGzip("a/b.parquet")).toBe(false);
  });
});
