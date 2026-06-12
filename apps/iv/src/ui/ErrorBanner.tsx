// ErrorBanner — renders a structured StoreError with class-specific guidance.
//
// R-03b: When a load ABORTS due to unsupported encoding, ErrorBanner is the
// AUTHORITATIVE display of findings. CapabilitiesPanel is not shown (the
// file did not load successfully).
import type { StoreError } from "../state/store";

type ErrorBannerProps = {
  error: StoreError;
};

export function ErrorBanner({ error }: ErrorBannerProps) {
  const isUnsupported = error.class === "unsupported-encoding";
  const isNetwork = error.class === "network";
  // Encoding + network are recoverable / not-the-file's-fault → amber; a corrupt
  // file is a hard red.
  const soft = isUnsupported || isNetwork;

  return (
    <div
      data-testid="error-banner"
      role="alert"
      style={{
        background: soft ? "#fff3cd" : "#fdecea",
        color: soft ? "#664d03" : "#611a15",
        border: `1px solid ${soft ? "#ffc107" : "#f5c6cb"}`,
        padding: "0.75rem 1rem",
        margin: "0.5rem",
        fontWeight: 600,
      }}
    >
      {isUnsupported ? (
        <>
          <div>Unsupported encoding: this file uses an encoding the bundled reader cannot decode.</div>
          {error.findings && error.findings.length > 0 && (
            <ul style={{ margin: "0.5rem 0 0 1.25rem", fontWeight: "normal" }}>
              {error.findings.map((f) => (
                <li key={f.code}>
                  <strong>{f.code}</strong> — {f.label}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : isNetwork ? (
        <>
          <div>Couldn't reach the file — network or CORS error.</div>
          <div style={{ fontWeight: "normal", marginTop: "0.35rem" }}>
            The URL may be unreachable, or the host may not allow cross-origin range
            requests. Check the address and the server's CORS policy — it must allow
            this origin with <code>GET</code> + the <code>Range</code> header. A local
            file always loads. <em>({error.message})</em>
          </div>
        </>
      ) : (
        <div>Failed to load file: {error.message} — file could not be parsed or is not a valid mzPeak file.</div>
      )}
    </div>
  );
}
