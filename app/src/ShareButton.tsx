// "Share view" button (MERGE-ROADMAP §3 Phase 5). Builds the shortest canonical
// deep link for the current store state via currentShareUrl(), copies it to the
// clipboard, mirrors it into the address bar (history.replaceState) so a manual
// refresh round-trips, and flashes a transient "Copied" state.
//
// Testability: the produced URL is exposed via data-testid="share-url" (text)
// AND written to location via replaceState, so an e2e can read either the
// element text or location.href.

import { useState, useCallback } from "react";
import { Button } from "@mzpeak/ui-kit";
import { useStore } from "./store";
import { currentShareUrl } from "./urlSync";

export function ShareButton() {
  const phase = useStore((s) => s.phase);
  const sourceUrl = useStore((s) => s.sourceUrl);
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // A share link must reference the dataset by URL. A LOCAL file has no shareable URL, so
  // sharing is disabled — a `?spectrum=N`-style link with no `file=` is useless off this machine.
  const canShare = phase === "ready" && sourceUrl != null;
  const localOnly = phase === "ready" && sourceUrl == null;

  const onShare = useCallback(async () => {
    const url = currentShareUrl();
    setShareUrl(url);

    // Mirror into the address bar so a refresh re-hydrates the same view.
    try {
      window.history.replaceState(null, "", url);
    } catch {
      // replaceState can throw for cross-origin/file:// — non-fatal.
    }

    // Copy to clipboard (best-effort; clipboard API may be unavailable/denied).
    try {
      await navigator.clipboard?.writeText(url);
    } catch {
      // Clipboard denied — the URL is still shown + in the address bar.
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, []);

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
      title={localOnly ? "Local files can't be shared — open the dataset from a URL for a shareable link." : undefined}
    >
      <Button
        data-testid="share-btn"
        variant="secondary"
        size="sm"
        disabled={!canShare}
        onClick={() => void onShare()}
        iconLeft={
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ width: "0.9rem", height: "0.9rem" }}
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
          </svg>
        }
      >
        {copied ? "Copied" : "Share view"}
      </Button>
      {/* Hidden-but-present readout of the last produced URL for e2e assertions. */}
      {shareUrl != null && (
        <span
          data-testid="share-url"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
            whiteSpace: "nowrap",
          }}
        >
          {shareUrl}
        </span>
      )}
    </span>
  );
}
