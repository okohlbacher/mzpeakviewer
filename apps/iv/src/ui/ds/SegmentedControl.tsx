import { useRef, type ReactNode, type KeyboardEvent } from "react";

export interface SegmentOption {
  value: string;
  label?: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps {
  options: SegmentOption[];
  value: string;
  onChange?: (value: string) => void;
  /** @default "md" */
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}

/**
 * Connected single-select tab/toggle group. `.mz-seg`.
 * A11y: role=tablist + aria-selected; ArrowLeft/Right roving selection.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel = "View",
  className,
}: SegmentedControlProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const cls = ["mz-seg", size === "sm" ? "mz-seg--sm" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % options.length
        : (i - 1 + options.length) % options.length;
    onChange?.(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className={cls} role="tablist" aria-label={ariaLabel}>
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="mz-seg__item"
            onClick={() => onChange?.(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {opt.icon ? (
              <span className="mz-ic" aria-hidden="true">
                {opt.icon}
              </span>
            ) : null}
            {opt.label ?? opt.value}
          </button>
        );
      })}
    </div>
  );
}
