import type { ReactNode } from "react";

export interface BadgeProps {
  /** @default "neutral" */
  tone?: "neutral" | "accent" | "info" | "success" | "warning" | "danger";
  /** Show a leading status dot. */
  dot?: boolean;
  /** Render the label in monospace (counts / values). */
  mono?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Compact status / metadata pill. `.mz-badge`. */
export function Badge({
  tone = "neutral",
  dot,
  mono,
  className,
  children,
}: BadgeProps) {
  const cls = [
    "mz-badge",
    `mz-badge--${tone}`,
    mono ? "mz-badge--mono" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      {dot ? <span className="mz-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
