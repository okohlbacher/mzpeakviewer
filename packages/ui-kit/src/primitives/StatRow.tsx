import type { ReactNode } from "react";

export interface StatRowProps {
  label: ReactNode;
  /** Value; falls back to an em-dash when null/undefined. */
  value?: ReactNode;
  className?: string;
  /** Optional testid forwarded to the value cell (preserves e2e contracts). */
  testid?: string;
}

/** Key/value inspector row; value in mono tabular numerals. `.mz-statrow`. */
export function StatRow({ label, value, className, testid }: StatRowProps) {
  return (
    <div className={["mz-statrow", className ?? ""].filter(Boolean).join(" ")}>
      <span className="mz-statrow__key">{label}</span>
      <span className="mz-statrow__val" data-testid={testid}>
        {value == null || value === "" ? "—" : value}
      </span>
    </div>
  );
}
