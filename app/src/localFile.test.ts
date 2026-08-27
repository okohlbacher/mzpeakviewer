// Canonical guard for the start-page URL field's local-path detection: a pasted
// file:// URL or bare filesystem path must be recognized (desktop reads it natively,
// web explains) and never be handed to the HTTP opener, which dies with an opaque
// "Failed to fetch".
import { describe, it, expect } from "vitest";
import { localPathOf } from "./localFile";

describe("localPathOf", () => {
  it("recognizes file:// URLs and decodes percent-escapes", () => {
    expect(
      localPathOf("file:///Users/kohlbach/data/HEK_PosOAD1.native.mzpeak"),
    ).toBe("/Users/kohlbach/data/HEK_PosOAD1.native.mzpeak");
    expect(localPathOf("file:///tmp/with%20space.mzpeak")).toBe("/tmp/with space.mzpeak");
  });

  it("recognizes Windows file URLs and drive paths (no artificial leading slash)", () => {
    expect(localPathOf("file:///C:/data/run.mzpeak")).toBe("C:/data/run.mzpeak");
    expect(localPathOf("C:\\data\\run.mzpeak")).toBe("C:\\data\\run.mzpeak");
  });

  it("recognizes bare POSIX and ~ paths", () => {
    expect(localPathOf("/Users/me/run.mzpeak")).toBe("/Users/me/run.mzpeak");
    expect(localPathOf("~/run.mzpeak")).toBe("~/run.mzpeak");
    expect(localPathOf("  /padded/path.mzpeak  ")).toBe("/padded/path.mzpeak");
  });

  it("passes real URLs (and other non-paths) through as null", () => {
    expect(localPathOf("https://example.org/a.mzpeak")).toBeNull();
    expect(localPathOf("http://127.0.0.1:8901/a.mzpeak")).toBeNull();
    expect(localPathOf("a-relative-name.mzpeak")).toBeNull();
    expect(localPathOf("")).toBeNull();
  });
});
