// OpenMS design-system primitives (typed recreation of the handoff's
// reference-prototype/primitives.jsx). Inline, token-driven styles keep each
// primitive self-contained and faithful to the spec.
import {
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { LoaderCircle } from "lucide-react";

/** Centered spinner overlay for a plot host while its data is being fetched.
 *  The parent must be position:relative. */
export function PlotSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        color: "var(--text-secondary)",
        background: "rgba(255, 255, 255, 0.66)",
        fontSize: "var(--text-sm)",
        zIndex: 5,
      }}
    >
      <LoaderCircle size={18} className="spin" /> {label}
    </div>
  );
}

const LOGO_SRC = `${import.meta.env.BASE_URL}openms-logo.png`;

export function Logo({
  product,
  size = 30,
}: {
  product?: string;
  size?: number;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem" }}>
      <img
        src={LOGO_SRC}
        alt="OpenMS"
        height={size}
        style={{ display: "block", height: size, width: "auto", flexShrink: 0 }}
      />
      {product && (
        <>
          <span
            aria-hidden="true"
            style={{ width: 1, height: size * 0.72, background: "var(--border-strong)" }}
          />
          <span
            style={{
              fontSize: size * 0.5,
              fontWeight: "var(--weight-title)",
              color: "var(--text-heading)",
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {product}
          </span>
        </>
      )}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "quiet";

export function Button({
  children,
  variant = "secondary",
  size = "md",
  iconLeft,
  iconRight,
  disabled,
  onClick,
  style,
  type = "button",
  title,
}: {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  type?: "button" | "submit";
  title?: string;
}) {
  const [hover, setHover] = useState(false);
  const sizes = {
    sm: { padding: "0.28rem 0.6rem", fontSize: "var(--text-sm)", gap: "0.3rem" },
    md: { padding: "0.4rem 0.85rem", fontSize: "var(--text-body)", gap: "0.4rem" },
  } as const;
  const hv = hover && !disabled;
  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: hv ? "var(--accent-hover)" : "var(--accent)",
      color: "var(--text-on-accent)",
      borderColor: hv ? "var(--accent-hover)" : "var(--accent)",
    },
    secondary: {
      background: "var(--surface-card)",
      color: hv ? "var(--accent)" : "var(--text-body)",
      borderColor: hv ? "var(--accent)" : "var(--border-default)",
    },
    ghost: {
      background: hv ? "var(--surface-panel)" : "transparent",
      color: "var(--text-body)",
      borderColor: "transparent",
    },
    quiet: {
      background: "var(--surface-card)",
      color: hv ? "var(--accent-secondary)" : "var(--text-body)",
      borderColor: hv ? "var(--accent-secondary)" : "var(--border-default)",
    },
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: sizes[size].gap,
        padding: sizes[size].padding,
        fontFamily: "var(--font-sans)",
        fontSize: sizes[size].fontSize,
        fontWeight: "var(--weight-medium)",
        lineHeight: 1.1,
        border: "1px solid",
        borderRadius: "var(--radius-sm)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "var(--transition-ui)",
        whiteSpace: "nowrap",
        ...variants[variant],
        ...style,
      }}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

type BadgeTone = "neutral" | "accent" | "slate" | "success" | "muted";

export function Badge({
  children,
  tone = "slate",
  shape = "pill",
  mono,
  style,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  shape?: "pill" | "sm";
  mono?: boolean;
  style?: CSSProperties;
}) {
  const tones: Record<BadgeTone, { background: string; color: string; border: string }> = {
    neutral: { background: "var(--surface-panel)", color: "var(--text-secondary)", border: "var(--border-default)" },
    accent: { background: "var(--surface-accent-soft)", color: "var(--accent-active)", border: "transparent" },
    slate: { background: "var(--surface-slate-soft)", color: "var(--accent-secondary)", border: "transparent" },
    success: { background: "#e7f3e8", color: "var(--green-700)", border: "transparent" },
    muted: { background: "transparent", color: "var(--text-muted)", border: "var(--border-default)" },
  };
  const t = tones[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.15rem 0.5rem",
        fontSize: "var(--text-sm)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontWeight: "var(--weight-medium)",
        lineHeight: 1.4,
        color: t.color,
        background: t.background,
        border: `1px solid ${t.border}`,
        borderRadius: shape === "pill" ? "var(--radius-pill)" : "var(--radius-sm)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export interface NavItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export function SideNav({
  items,
  activeId,
  onSelect,
}: {
  items: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  return (
    <nav
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.15rem",
        padding: "0.5rem",
      }}
    >
      {items.map((it) => {
        const active = it.id === activeId;
        const hovered = it.id === hoverId && !active && !it.disabled;
        const bg = active
          ? "var(--accent-soft)"
          : hovered
            ? "var(--surface-panel)"
            : "transparent";
        return (
          <button
            key={it.id}
            type="button"
            disabled={it.disabled}
            onClick={() => !it.disabled && onSelect(it.id)}
            onMouseEnter={() => setHoverId(it.id)}
            onMouseLeave={() => setHoverId(null)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
              width: "100%",
              padding: "0.46rem 0.6rem",
              border: "none",
              borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
              borderRadius: "var(--radius-sm)",
              background: bg,
              color: active
                ? "var(--accent-active)"
                : it.disabled
                  ? "var(--text-muted)"
                  : "var(--text-secondary)",
              font: "inherit",
              fontSize: "var(--text-body)",
              fontWeight: active ? "var(--weight-semibold)" : "var(--weight-medium)",
              cursor: it.disabled ? "not-allowed" : "pointer",
              opacity: it.disabled ? 0.55 : 1,
              textAlign: "left",
              transition: "var(--transition-ui)",
            }}
          >
            {it.icon && (
              <span style={{ display: "inline-flex", width: 17, height: 17, flexShrink: 0 }}>
                {it.icon}
              </span>
            )}
            <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {it.label}
            </span>
            {it.badge != null && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                {it.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function TextField({
  label,
  value,
  onChange,
  onKeyDown,
  onBlur,
  type = "text",
  placeholder,
  suffix,
  width,
  min,
  max,
  step,
  disabled,
  style,
}: {
  label?: string;
  value: string | number;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  type?: "text" | "number";
  placeholder?: string;
  suffix?: ReactNode;
  width?: string;
  min?: number;
  max?: number;
  step?: number | string;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <label style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem", opacity: disabled ? 0.5 : 1, ...style }}>
      {label && <span style={{ fontSize: "var(--text-label)", color: "var(--text-muted)" }}>{label}</span>}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          background: "var(--surface-card)",
          border: `1px solid ${focus ? "var(--accent)" : "var(--border-default)"}`,
          boxShadow: focus ? "0 0 0 2px var(--accent-soft)" : "none",
          borderRadius: "var(--radius-sm)",
          padding: "0 0.5rem",
          transition: "var(--transition-ui)",
          height: "var(--control-h)",
        }}
      >
        <input
          type={type}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onFocus={() => setFocus(true)}
          onBlur={(e) => {
            setFocus(false);
            onBlur?.(e);
          }}
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            font: "inherit",
            fontSize: "var(--text-body)",
            color: "var(--text-body)",
            width: width || "auto",
            minWidth: 0,
          }}
        />
        {suffix && (
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

const SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b757e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")";

export function Select({
  label,
  value,
  onChange,
  options,
  style,
}: {
  label?: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  style?: CSSProperties;
}) {
  return (
    <label style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem", ...style }}>
      {label && <span style={{ fontSize: "var(--text-label)", color: "var(--text-muted)" }}>{label}</span>}
      <select
        value={value}
        onChange={onChange}
        style={{
          font: "inherit",
          fontSize: "var(--text-body)",
          color: "var(--text-body)",
          background: "var(--surface-card)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-sm)",
          padding: "0 1.6rem 0 0.5rem",
          height: "var(--control-h)",
          cursor: "pointer",
          appearance: "none",
          backgroundImage: SELECT_CHEVRON,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 0.5rem center",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AppHeader({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        height: 52,
        padding: "0 1rem",
        background: "var(--surface-page)",
        borderBottom: "1px solid var(--border-default)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", minWidth: 0 }}>
        {left}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
        {right}
      </div>
    </header>
  );
}
