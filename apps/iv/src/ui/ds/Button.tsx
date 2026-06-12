import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual emphasis. @default "primary" */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** @default "md" */
  size?: "sm" | "md";
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  /** Stretch to fill the container width. */
  block?: boolean;
  /** Render as an icon-only button (square). Requires `aria-label`. */
  icon?: boolean;
  children?: ReactNode;
}

/** Primary action control. Token-driven `.mz-btn`. */
export function Button({
  variant = "primary",
  size = "md",
  iconLeft,
  iconRight,
  block,
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = [
    "mz-btn",
    variant !== "primary" ? `mz-btn--${variant}` : "",
    size === "sm" ? "mz-btn--sm" : "",
    block ? "mz-btn--block" : "",
    icon ? "mz-btn--icon" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {iconLeft ? (
        <span className="mz-ic" aria-hidden="true">
          {iconLeft}
        </span>
      ) : null}
      {children}
      {iconRight ? (
        <span className="mz-ic" aria-hidden="true">
          {iconRight}
        </span>
      ) : null}
    </button>
  );
}
