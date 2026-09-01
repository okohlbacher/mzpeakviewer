// Canonical guard for the start-page URL field's local-path detection. Every case here
// is an ADVERSARIAL input from the 2026-09-01 review that previously opened the wrong
// file (silent truncation at #/?, host dropped) or fell through to a bogus HTTP fetch
// (%, single-slash file:, UNC). Runs in node — NOT Tauri — so the desktop-only bare-"/"
// branch resolves to null here (web contract: origin-relative URLs keep flowing).
import { describe, it, expect } from "vitest";
import { localPathOf } from "./localFile";

describe("localPathOf — file: URL spellings", () => {
  it("triple-slash and localhost forms", () => {
    expect(localPathOf("file:///Users/k/a.mzpeak")).toBe("/Users/k/a.mzpeak");
    expect(localPathOf("file://localhost/Users/k/a.mzpeak")).toBe("/Users/k/a.mzpeak");
    expect(localPathOf("file:/Users/k/a.mzpeak")).toBe("/Users/k/a.mzpeak"); // RFC 8089 single-slash
  });
  it("filenames with #, ? and % survive VERBATIM (URL parsing truncated/threw)", () => {
    expect(localPathOf("file:///Users/k/a#1.mzpeak")).toBe("/Users/k/a#1.mzpeak");
    expect(localPathOf("file:///Users/k/a?x=1.mzpeak")).toBe("/Users/k/a?x=1.mzpeak");
    expect(localPathOf("file:///Users/k/100%.mzpeak")).toBe("/Users/k/100%.mzpeak");
    expect(localPathOf("file:///tmp/with%20space.mzpeak")).toBe("/tmp/with space.mzpeak"); // valid encoding decodes
  });
  it("a non-localhost host is NOT silently dropped — mapped to a UNC-style path", () => {
    expect(localPathOf("file://nas-server/share/a.mzpeak")).toBe("//nas-server/share/a.mzpeak");
  });
  it("Windows drive URLs and paths", () => {
    expect(localPathOf("file:///C:/data/run.mzpeak")).toBe("C:/data/run.mzpeak");
    expect(localPathOf("C:\\data\\run.mzpeak")).toBe("C:\\data\\run.mzpeak");
    expect(localPathOf("\\\\server\\share\\run.mzpeak")).toBe("\\\\server\\share\\run.mzpeak"); // Explorer UNC
  });
});

describe("localPathOf — bare paths and URLs", () => {
  it("~ is recognized (desktop rejects it with a precise message)", () => {
    expect(localPathOf("~/run.mzpeak")).toBe("~/run.mzpeak");
  });
  it("outside Tauri, a bare absolute POSIX path stays a URL (origin-relative hosting)", () => {
    expect(localPathOf("/data/run.mzpeak")).toBeNull();
  });
  it("real URLs and relative names pass through as null", () => {
    expect(localPathOf("https://example.org/a.mzpeak")).toBeNull();
    expect(localPathOf("http://127.0.0.1:8901/a.mzpeak")).toBeNull();
    expect(localPathOf("a-relative-name.mzpeak")).toBeNull();
    expect(localPathOf("")).toBeNull();
  });
});
