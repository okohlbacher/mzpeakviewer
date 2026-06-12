import type { InputHTMLAttributes } from "react";

export interface NumberFieldProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "value" | "size"
  > {
  value: string | number;
  onChange?: (value: string) => void;
  /** Trailing unit chip, e.g. "Da", "µm", "ppm". */
  unit?: string | null;
  /** @default "md" */
  size?: "sm" | "md";
  /** Explicit CSS width (e.g. "92px"). */
  width?: string | number;
  ariaLabel?: string;
  /**
   * Native input type. @default "text". NOTE: the loader URL field passes
   * "text" (a "number" type would reject a URL string). Numeric controls pass
   * "number". Either way the value is surfaced as a string to onChange.
   */
  type?: string;
}

/** Monospace value input with optional unit chip. `.mz-input`. */
export function NumberField({
  value,
  onChange,
  unit,
  size = "md",
  width,
  ariaLabel,
  className,
  type = "text",
  ...rest
}: NumberFieldProps) {
  const cls = [
    "mz-input",
    size === "sm" ? "mz-input--sm" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} style={width != null ? { width } : undefined}>
      <input
        type={type}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      />
      {unit ? <span className="mz-input__unit">{unit}</span> : null}
    </span>
  );
}
