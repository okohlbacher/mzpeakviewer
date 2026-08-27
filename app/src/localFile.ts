// Local-path handling for the start page's URL field. Browsers cannot fetch
// `file://` URLs (or bare filesystem paths) from a web page, so pasting one used to
// die with a generic "Failed to fetch". Here:
//   - localPathOf() recognizes such input (file:// URL, POSIX/Windows absolute path, ~/),
//   - the DESKTOP app reads the path natively via the Tauri fs plugin and opens it
//     through the normal local-File path,
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
 * A `file://` URL or bare absolute filesystem path → the filesystem path, else null
 * (meaning: treat the input as a normal URL). `~/…` is recognized so the desktop can
 * reject it with a precise message (the fs plugin does not expand `~`).
 */
export function localPathOf(input: string): string | null {
  const s = input.trim();
  if (/^file:\/\//i.test(s)) {
    try {
      const p = decodeURIComponent(new URL(s).pathname);
      // Windows file URLs parse as "/C:/…" — drop the artificial leading slash.
      return /^\/[A-Za-z]:[\\/]/.test(p) ? p.slice(1) : p;
    } catch {
      return null;
    }
  }
  if (s.startsWith("/") || s.startsWith("~/")) return s;
  if (/^[A-Za-z]:[\\/]/.test(s)) return s; // Windows drive path
  return null;
}

/** The message shown when a local path is pasted into the WEB viewer. */
export const WEB_LOCAL_PATH_MSG =
  "Browsers can’t open local file paths from a URL — use “Open file” or drag & drop the file instead. (The desktop app can open local paths.)";

/**
 * Desktop only: read `path` via the Tauri fs plugin and wrap it as a File for the
 * normal local-open path. Throws with a readable message when the read fails
 * (missing file, no permission, `~` unexpanded).
 */
export async function readLocalFile(path: string): Promise<File> {
  if (!inTauri()) throw new Error(WEB_LOCAL_PATH_MSG);
  if (path.startsWith("~/")) {
    throw new Error(`Paths starting with "~" aren’t expanded — use the full path (e.g. /Users/you/${path.slice(2)}).`);
  }
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(path);
  const name = path.split(/[\\/]/).pop() || "local.mzpeak";
  return new File([bytes], name, { type: "application/octet-stream" });
}
