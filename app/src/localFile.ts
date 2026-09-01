// Local-path handling for the start page's URL field. Browsers cannot fetch
// `file://` URLs (or bare filesystem paths) from a web page, so pasting one used to
// die with a generic "Failed to fetch". Here:
//   - localPathOf() recognizes such input (file: URL in its 1/2/3-slash spellings,
//     POSIX/Windows/UNC absolute path, ~/); adversarial inputs verified in tests,
//   - the DESKTOP app reads the path natively via the Tauri fs plugin and opens it
//     through the normal local-File path (size-capped: this path slurps the whole
//     file, unlike the picker's lazy Blob),
//   - the WEB build gets a clear, actionable error instead of a network failure.
// NOTE: deliberately no import from urlSync — its module graph pulls in the store and
// the engine Worker, which breaks plain-node unit tests of this pure helper.
function inTauri(): boolean {
  if (typeof window === "undefined") return false;
  // The runtime-injected IPC global exists in dev and production on every OS; the
  // origin check alone misses Windows production and `tauri dev`.
  return "__TAURI_INTERNALS__" in window || window.location.origin.startsWith("tauri://");
}

/**
 * A `file:` URL or bare absolute filesystem path → the filesystem path, else null
 * (meaning: treat the input as a normal URL). Handles the RFC 8089 spellings
 * `file:/p`, `file:///p` and `file://localhost/p`; a `file://` URL with any OTHER
 * non-empty host is a remote share reference we cannot read — mapped to a UNC path
 * (`//host/share/…`, which Windows resolves; elsewhere the read fails with a message
 * naming that path — far better than silently opening the wrong local file, which is
 * what using `.pathname` alone did). `~/…` is recognized so the desktop can reject it
 * with a precise message (the fs plugin does not expand `~`).
 *
 * NOT URL-parsed on purpose: filenames legally contain `%`, `#` and `?`, and users
 * paste RAW paths — `new URL()` truncated at `#`/`?` (silent wrong file) and
 * decodeURIComponent threw on a bare `%` (fell through to a bogus HTTP fetch). We
 * strip the scheme/host prefix textually and percent-decode only when the decode
 * SUCCEEDS and the input plausibly came from a URL-encoder.
 */
export function localPathOf(input: string): string | null {
  const s = input.trim();
  const m = /^file:(?:\/\/([^/\\]*))?(\/.*)$/i.exec(s);
  if (m) {
    const host = m[1] ?? "";
    let p = m[2]!;
    // Percent-decode when possible; keep the raw spelling when the decode throws
    // (a literal "%" in the filename) — the raw form is the likelier intent.
    try {
      p = decodeURIComponent(p);
    } catch {
      /* keep raw */
    }
    // Windows drive URLs parse as "/C:/…" — drop the artificial leading slash.
    if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1);
    if (host && host.toLowerCase() !== "localhost") return `//${host}${p}`; // UNC-style
    return p;
  }
  if (s.startsWith("\\\\")) return s; // Windows UNC pasted straight from Explorer
  if (s.startsWith("~/")) return s;
  if (/^[A-Za-z]:[\\/]/.test(s)) return s; // Windows drive path
  // A bare absolute POSIX path is a LOCAL path only on the desktop. On the web,
  // "/data/run.mzpeak" is a legitimate origin-relative URL (same-origin hosting) and
  // must keep flowing to the HTTP opener — blocking it there was a regression.
  if (s.startsWith("/")) return inTauri() ? s : null;
  return null;
}

/** The message shown when a local path is pasted into the WEB viewer. */
export const WEB_LOCAL_PATH_MSG =
  "Browsers can’t open local file paths from a URL — use “Open file” or drag & drop the file instead. (The desktop app can open local paths.)";

/** This path reads the WHOLE file into memory (unlike the picker's lazy Blob) — cap it. */
const MAX_PATH_OPEN_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

/**
 * Desktop only: read `path` via the Tauri fs plugin and wrap it as a File for the
 * normal local-open path. Throws with a readable message when the read fails
 * (missing file, no permission, `~` unexpanded, or too large for a whole-file read).
 */
export async function readLocalFile(path: string): Promise<File> {
  if (!inTauri()) throw new Error(WEB_LOCAL_PATH_MSG);
  if (path.startsWith("~/")) {
    throw new Error(`Paths starting with "~" aren’t expanded — use the full path (e.g. /Users/you/${path.slice(2)}).`);
  }
  const fs = await import("@tauri-apps/plugin-fs");
  // Unlike the file picker (lazy Blob.slice reads), this path slurps the whole file —
  // guard against multi-GB runs that would OOM the webview.
  try {
    const st = await fs.stat(path);
    if (typeof st.size === "number" && st.size > MAX_PATH_OPEN_BYTES) {
      throw new Error(
        `${(st.size / 2 ** 30).toFixed(1)} GB is too large to open by path — use “Open file” (it reads lazily and handles any size).`,
      );
    }
  } catch (e) {
    if (e instanceof Error && /too large/.test(e.message)) throw e;
    // stat failure falls through to readFile, whose error names the real cause.
  }
  const bytes = await fs.readFile(path);
  const name = path.split(/[\\/]/).pop() || "local.mzpeak";
  return new File([bytes], name, { type: "application/octet-stream" });
}
