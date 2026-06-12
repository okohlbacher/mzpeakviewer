import { describe, it, expect } from "vitest";
import { resolveLoadUrl, DEFAULT_S3_HTTPS_ENDPOINT } from "./resolveUrl";

describe("resolveLoadUrl", () => {
  it("rewrites s3://bucket/key to the default HTTPS endpoint (path-style)", () => {
    expect(resolveLoadUrl("s3://v09/demo/file.mzpeak")).toBe(
      `${DEFAULT_S3_HTTPS_ENDPOINT}/v09/demo/file.mzpeak`,
    );
  });

  it("is case-insensitive on the scheme and trims whitespace", () => {
    expect(resolveLoadUrl("  S3://v09/x.mzpeak  ")).toBe(
      `${DEFAULT_S3_HTTPS_ENDPOINT}/v09/x.mzpeak`,
    );
  });

  it("strips extra leading slashes after the scheme", () => {
    expect(resolveLoadUrl("s3:///v09/x.mzpeak")).toBe(
      `${DEFAULT_S3_HTTPS_ENDPOINT}/v09/x.mzpeak`,
    );
  });

  it("honors an endpoint override (and trims its trailing slash)", () => {
    expect(resolveLoadUrl("s3://b/k.mzpeak", "https://host.example/")).toBe(
      "https://host.example/b/k.mzpeak",
    );
  });

  it("passes http(s) and relative URLs through unchanged (trimmed)", () => {
    expect(resolveLoadUrl("https://example.com/f.mzpeak")).toBe(
      "https://example.com/f.mzpeak",
    );
    expect(resolveLoadUrl("  /mzPeakIV/static/example.mzpeak ")).toBe(
      "/mzPeakIV/static/example.mzpeak",
    );
  });

  it("leaves a malformed s3:// (no bucket) for the reader to reject", () => {
    expect(resolveLoadUrl("s3://")).toBe("s3://");
  });
});
