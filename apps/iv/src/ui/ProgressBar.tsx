import type { LoadStage } from "../reader/types";
// Single source of truth shared with App.tsx's hidden `stage` sentinel — the two
// must never drift (the e2e suite gates on the sentinel's exact text).
import { STAGE_LABEL, PROGRESS_STAGES as STAGES } from "./stageLabels";

interface Props {
  stage: LoadStage;
}

/**
 * Horizontal step-progress bar showing the current load stage so there is never a
 * silent long pause during a real file open (LOAD-03).
 */
export function ProgressBar({ stage }: Props) {
  const isLoading =
    stage === "zip-index" ||
    stage === "manifest" ||
    stage === "metadata" ||
    stage === "grid" ||
    stage === "tic";
  const isError = stage === "error";
  const isIdle = stage === "idle";

  if (isIdle) return null;

  const currentIndex = STAGES.indexOf(stage as (typeof STAGES)[number]);

  return (
    <div
      data-testid="progress-bar"
      role="status"
      aria-live="polite"
      aria-label={`Load stage: ${STAGE_LABEL[stage]}`}
      style={{
        padding: "0.5rem 1rem",
        background: isError ? "#fdecea" : "#f5f5f5",
        borderBottom: "1px solid #ddd",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}
    >
      {STAGES.map((s, i) => {
        const active = s === stage;
        const done = currentIndex > i;
        return (
          <div
            key={s}
            data-testid={`stage-step-${s}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
              opacity: done || active ? 1 : 0.4,
              fontWeight: active ? 700 : 400,
              fontSize: "0.8rem",
              color: active ? "#1565c0" : done ? "#2e7d32" : "#666",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: "0.65rem",
                height: "0.65rem",
                borderRadius: "50%",
                background: done ? "#2e7d32" : active ? "#1565c0" : "#bbb",
              }}
            />
            <span data-testid={`stage-label-${s}`}>{STAGE_LABEL[s]}</span>
            {i < STAGES.length - 1 && (
              <span style={{ marginLeft: "0.35rem", color: "#bbb" }}>›</span>
            )}
          </div>
        );
      })}
      {isLoading && (
        <span
          data-testid="loading-spinner"
          aria-hidden="true"
          style={{ marginLeft: "auto", color: "#1565c0" }}
        >
          ⟳
        </span>
      )}
    </div>
  );
}
