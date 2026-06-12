import type { LoadStage } from "../reader/types";

/**
 * SINGLE SOURCE OF TRUTH for load-stage labels.
 *
 * Consumed by BOTH the hidden `data-testid="stage"` sentinel in App.tsx AND the
 * visible ProgressBar, so the two can never drift. The e2e suite asserts the
 * sentinel's text via EXACT `toHaveText(...)` — these strings are a frozen
 * contract; changing any value breaks `e2e/{skeleton,local-file,remote-url}`.
 */
export const STAGE_LABEL: Record<LoadStage, string> = {
  idle: "Idle",
  "zip-index": "Reading ZIP index…",
  manifest: "Parsing manifest…",
  metadata: "Loading metadata…",
  grid: "Building imaging grid…",
  tic: "Building TIC image…",
  ready: "Ready",
  "no-imaging": "No Imaging Data",
  error: "Error",
};

/** Ordered stages for the step-progress display. */
export const PROGRESS_STAGES: LoadStage[] = [
  "zip-index",
  "manifest",
  "metadata",
  "grid",
  "tic",
  "ready",
];
