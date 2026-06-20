// Shared sub-tab strip for the Advanced area — presents Metadata + Structure as
// sibling sub-tabs. They remain real sidebar tabs too (keeps deep-links +
// roving-tabindex a11y intact); this strip is an additive, in-content way to
// switch between the two without leaving the Advanced context.
import { useStore } from "../store";
import type { View } from "@mzpeak/contracts";

const TABS: { id: Extract<View, "metadata" | "structure">; label: string }[] = [
  { id: "metadata", label: "Metadata" },
  { id: "structure", label: "Structure" },
];

export function AdvancedTabs() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  return (
    <div
      role="tablist"
      aria-label="Advanced sections"
      data-testid="advanced-subtabs"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        marginBottom: "1rem",
        border: "1px solid var(--border-strong, #c5ccd3)",
        borderRadius: "var(--radius-sm, 4px)",
        background: "var(--surface-sunken, #f4f6f8)",
      }}
    >
      {TABS.map((t) => {
        const active = view === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`advanced-subtab-${t.id}`}
            onClick={() => setView(t.id)}
            style={{
              padding: "0.25rem 0.8rem",
              border: "none",
              borderRadius: "var(--radius-xs, 3px)",
              fontSize: "var(--text-sm, 0.8rem)",
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
              background: active ? "var(--accent, #3b54da)" : "transparent",
              color: active ? "var(--text-on-accent, #fff)" : "var(--text-body, #353c43)",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
