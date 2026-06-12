import type { SelectHTMLAttributes } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<
    SelectHTMLAttributes<HTMLSelectElement>,
    "onChange" | "value" | "size"
  > {
  value: string;
  onChange?: (value: string) => void;
  options: SelectOption[];
  /** @default "md" */
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}

/** Styled native dropdown. `.mz-select`. */
export function Select({
  value,
  onChange,
  options,
  size = "md",
  ariaLabel,
  className,
  ...rest
}: SelectProps) {
  const cls = [
    "mz-select",
    size === "sm" ? "mz-select--sm" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        className="mz-select__chev"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}
