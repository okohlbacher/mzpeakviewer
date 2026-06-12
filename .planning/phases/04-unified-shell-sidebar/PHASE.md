# Phase 4 — Unified Shell + Capability Sidebar

**Depends on:** Phases 2, 3 · **Requirements:** NAV-01…NAV-08 · **Risk:** medium · **UI:** yes

**Goal:** Build the single app shell (Explorer base) with the capability-adaptive
sidebar:

```
▸ Summary            (always)
▸ Spectra            (always)
▸ Chromatograms      (gated on numChromatograms>0 / hasTicColumn — INDEPENDENT of imaging)
▾ Advanced           (collapsed default; auto-expand on deep link)
    • Metadata       (deep JSON / CV-aware tree)
    • Structure      (parquet inspection)
▾ Imaging (MSI)      (gated on isImaging; expanded default; LAZY-loaded chunk)
    • Ion image      (default = TIC spatial overview; single + multi-channel)
    • Optical        (when hasOptical)
    • Overlay        (when hasOptical)
    • Grid           (diagnostics + imaging-detection override)
```

Merge the two zustand stores into the Phase-1 shape; wire pixel→spectrum and
ROI→spectrum routing; implement the a11y acceptance criteria (`tablist`/accordion,
roving focus, keyboard, deep-link auto-expand) and the detection-override UI.

**Deliverable:** one app adapting nav to capabilities; imaging UI lazy-loaded;
both demo files navigable; a11y tests pass; non-imaging users don't download
imaging code.

Full detail: [../../ROADMAP.md](../../ROADMAP.md) → Phase 4. Run `/gsd:plan-phase 04`.
