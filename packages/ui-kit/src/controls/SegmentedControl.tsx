import { useRef, type KeyboardEvent } from "react";

export interface SegmentedControlOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the group (announced by screen readers). */
  ariaLabel?: string;
  className?: string;
}

/**
 * Accessible segmented control for subtabs (e.g. MS / UV-VIS view switch).
 * Token-driven `.mz-seg` look, but with **radio-group** semantics:
 *  - the container is `role="radiogroup"`, each segment a `role="radio"` with
 *    `aria-checked`;
 *  - roving tabindex (only the selected radio is tabbable) so Tab lands once on
 *    the group, then Arrow keys move + select within it;
 *  - ArrowLeft/Up → previous, ArrowRight/Down → next (wrapping), Home/End jump
 *    to the ends — matching the WAI-ARIA radio-group pattern;
 *  - `:focus-visible` shows the design-system focus ring (`.mz-seg__radio`).
 *
 * Distinct from the primitives `SegmentedControl` (tablist semantics); use this
 * one when the segments select a value rather than reveal a tab panel.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel = "View",
  className,
}: SegmentedControlProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const cls = ["mz-seg", className ?? ""].filter(Boolean).join(" ");

  function select(i: number) {
    const opt = options[i];
    if (!opt) return;
    onChange(opt.value);
    refs.current[i]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        select(i === last ? 0 : i + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        select(i === 0 ? last : i - 1);
        break;
      case "Home":
        e.preventDefault();
        select(0);
        break;
      case "End":
        e.preventDefault();
        select(last);
        break;
      default:
        break;
    }
  }

  return (
    <div className={cls} role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt, i) => {
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // Roving tabindex: the selected radio is the single tab stop. When
            // nothing matches `value`, fall back to making the first focusable.
            tabIndex={checked || (i === 0 && !options.some((o) => o.value === value)) ? 0 : -1}
            className="mz-seg__item mz-seg__radio"
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
