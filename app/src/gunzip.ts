// Decompress a gzip member on the fly using the platform's native zlib-backed
// DecompressionStream (no bundled inflate code). Used by the Structure view to offer
// the UNCOMPRESSED contents of any `.gz` archive member for download.

/** Gunzip a gzip byte buffer → the decompressed bytes. Throws if the input isn't gzip.
 *  Accepts an ArrayBuffer or any typed-array view (the worker hands back an ArrayBuffer). */
export async function gunzipBytes(bytes: BufferSource): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Strip a single trailing `.gz` (case-insensitive) — the decompressed file's name. */
export function decompressedName(name: string): string {
  return name.replace(/\.gz$/i, "");
}

/** Whether an archive member is a gzip file (by suffix, as the user requested). */
export function isGzip(path: string): boolean {
  return /\.gz$/i.test(path);
}
