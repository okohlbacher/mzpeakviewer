import type { ReactNode } from "react";

export interface CheckboxProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label?: ReactNode;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

/** Compact labelled checkbox. `.mz-check`. */
export function Checkbox({
  checked,
  onChange,
  label,
  className,
  disabled,
  ariaLabel,
}: CheckboxProps) {
  return (
    <label className={["mz-check", className ?? ""].filter(Boolean).join(" ")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="mz-check__box">
        <svg
          className="mz-ic"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      {label != null ? <span>{label}</span> : null}
    </label>
  );
}
