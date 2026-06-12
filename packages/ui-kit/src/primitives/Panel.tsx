import { useId, useState, type ReactNode } from "react";

export interface PanelProps {
  title: ReactNode;
  /** Optional trailing count chip. */
  count?: ReactNode;
  /** @default true */
  defaultOpen?: boolean;
  /** Controlled open state (pair with onToggle). */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  /** Forwarded to the section element (preserves e2e panel testids). */
  testid?: string;
  children?: ReactNode;
}

/**
 * Collapsible titled inspector section. `.mz-panel`.
 * Uncontrolled by default (defaultOpen); pass open + onToggle to control.
 * A11y: header button carries aria-expanded + aria-controls.
 */
export function Panel({
  title,
  count = null,
  defaultOpen = true,
  open,
  onToggle,
  className,
  testid,
  children,
}: PanelProps) {
  const [internal, setInternal] = useState(defaultOpen);
  const bodyId = useId();
  const isOpen = open ?? internal;
  const toggle = () =>
    onToggle ? onToggle(!isOpen) : setInternal((v) => !v);
  return (
    <section
      className={["mz-panel", className ?? ""].filter(Boolean).join(" ")}
      data-open={isOpen}
      data-testid={testid}
    >
      <button
        type="button"
        className="mz-panel__head"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={bodyId}
      >
        <svg
          className="mz-panel__chev"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span className="mz-panel__title">{title}</span>
        {count != null ? <span className="mz-panel__count">{count}</span> : null}
      </button>
      <div className="mz-panel__body" id={bodyId} hidden={!isOpen}>
        {children}
      </div>
    </section>
  );
}
