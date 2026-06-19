// Spectra view — browse list / index picker → selectSpectrum → SpectrumPlot.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useStore } from "../store";
import { buildLevelIndex, activeSet, rankOf, absoluteOf } from "../levelIndex";
import { SpectrumPlot, Select, Button, TreeView, spectrumReporters, type SelectOption, type ReporterMarker, type ReporterPeak } from "@mzpeak/ui-kit";

// Categorical palette for isobaric channels — shared by the pills + the peak dots
// so a channel reads as the same colour in both places.
const CHANNEL_PALETTE = [
  "#3b54da", "#c00000", "#2e9e5b", "#b026d3", "#e8820c", "#0e9bb5",
  "#d6336c", "#5f6caf", "#7cb518", "#e0a800", "#8a3ffc", "#1098ad",
  "#c2410c", "#0b7285", "#9c36b5", "#2b8a3e", "#e64980", "#495057",
];
const channelColor = (i: number) => CHANNEL_PALETTE[i % CHANNEL_PALETTE.length]!;

// The picker numbers spectra by their 1-based position within the selected MS level
// (so a level with 1000 spectra runs 1..1000, never the native scan number); "All"
// numbers 1..numSpectra by absolute index + 1. The relative↔absolute mapping is the
// per-level array set built by buildLevelIndex (../levelIndex), memoized on `browse`.
// (Native scan numbers still drive the ?scan= deep link via ../scan + urlSync — that
// resolves to an absolute index and is independent of how the picker numbers things.)

export function Spectra() {
  const phase = useStore((s) => s.phase);
  const stats = useStore((s) => s.stats);
  const hasWavelength = useStore((s) => s.hasWavelength);
  const browse = useStore((s) => s.browse);
  const spectrum = useStore((s) => s.spectrum);
  const spectrumLoading = useStore((s) => s.spectrumLoading);
  const selector = useStore((s) => s.selector);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const msLevelFilter = useStore((s) => s.msLevelFilter);
  const setMsLevelFilter = useStore((s) => s.setMsLevelFilter);
  const channels = useStore((s) => s.channels);
  const setIonRequest = useStore((s) => s.setIonRequest);
  const setView = useStore((s) => s.setView);
  const addXic = useStore((s) => s.addXic);
  const settings = useStore((s) => s.settings);

  // Right-click-a-peak → "create chromatogram" popover (m/z resolved by SpectrumPlot,
  // RT pre-filled to the shown spectrum's RT ± the Settings half-window, MS level limited
  // to the shown spectrum). Anchored at the cursor.
  // Snapshot mz + RT + MS level AT RIGHT-CLICK TIME — reading them live later would use a
  // since-changed spectrum (codex review).
  const [peakMenu, setPeakMenu] = useState<
    { mz: number; x: number; y: number; msLevel: number | null; spectrumRtSec: number | null; rtBounds: [number, number] | null } | null
  >(null);

  // BL-09: clicking a peak (in the plot or the centroid peak table) prefills the
  // ion view with that m/z (±0.05 Da) and navigates there. The user then clicks
  // "Render" on the ion view — auto-render is a deferred follow-up.
  const goToIonImage = (mz: number) => {
    setIonRequest({ mz, tolDa: 0.05 });
    setView("ion");
  };

  const [inputVal, setInputVal] = useState("");
  // Clicking a channel pill zooms the plot to the reporter region + highlights that
  // channel's peak. Reset when the spectrum changes or the user double-clicks to reset.
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const spectrumIndex = spectrum?.index ?? null;
  useEffect(() => { setSelectedChannel(null); }, [spectrumIndex]);
  // Dismiss any open peak→chrom popover when the file/spectrum changes — a stale popover
  // would otherwise carry mz/RT/MS level from a since-replaced spectrum (review).
  const closePeakMenu = useCallback(() => setPeakMenu(null), []);
  // Clear on BOTH the displayed spectrum changing (spectrumIndex) AND a new selection being
  // requested (selector.index) — the latter changes first, during the load, so without it the
  // popover stays usable against a spectrum that's already being replaced (review).
  useEffect(() => { closePeakMenu(); }, [spectrumIndex, selector?.index, phase, closePeakMenu]);

  // Per-MS-level relative↔absolute mapping, built once per file (rebuilds only when
  // `browse` changes — switching MS levels just selects a different prebuilt array).
  const levelIndex = useMemo(() => buildLevelIndex(browse), [browse]);

  if (phase !== "ready" || !stats) {
    return (
      <p
        data-testid="spectra-empty"
        style={{ color: "var(--text-muted)", padding: "1rem 0" }}
      >
        Open a file to browse spectra.
      </p>
    );
  }

  const numSpectra = stats.numSpectra;
  if (numSpectra === 0) {
    return (
      <p data-testid="spectra-empty" style={{ color: "var(--text-muted)" }}>
        {hasWavelength
          ? "This file has no MS spectra — see the UV/VIS tab for its wavelength spectra."
          : "This file contains no spectra."}
      </p>
    );
  }

  const currentIndex = selector?.index ?? 0;

  // MS-level filter (only levels actually present in the file populate the dropdown;
  // filled by scanBreakdown). Filtering reads the prebuilt per-level mapping arrays.
  const availableLevels = stats.msLevels ?? [];
  // The active set of absolute indices for the current filter: a level's prebuilt
  // array, or every index in order for "All". Before `browse` arrives (the brief
  // window after open, or if scanBreakdown failed) fall back to a plain 0..n-1 range
  // and ignore any level filter — without msLevel data we can't honour it.
  const active = browse
    ? activeSet(levelIndex, msLevelFilter)
    : Array.from({ length: numSpectra }, (_, i) => i);
  const filtered = msLevelFilter != null && !!browse;
  // 1-based position of the current spectrum in the active set (what the picker shows
  // and what users type). Null only if the current spectrum isn't in the active set
  // (e.g. mid-filter-switch before applyFilter jumps to the first match).
  const currentRank = rankOf(active, currentIndex);

  // Current spectrum's own MS level + its rank/total WITHIN that level — shown in the
  // meta readout regardless of the active filter, straight off the mapping arrays.
  // `?? null` guards an out-of-range currentIndex (TypedArray → undefined); an
  // in-bounds spectrum with no MS level is -1 (MSLEVEL_ABSENT), not null.
  const curLevel = browse ? (browse.msLevel[currentIndex] ?? null) : null;
  const levelSet = curLevel != null ? activeSet(levelIndex, curLevel) : null;
  const withinLevelRank = levelSet ? rankOf(levelSet, currentIndex) : null;

  // Peak→chrom snapshot reads the DISPLAYED spectrum (spectrumIndex), not the requested
  // selector — during a load the selector leads, so its RT/MS level wouldn't match the m/z
  // the right-click resolves off the drawn spectrum (codex review).
  const shownLevel = browse && spectrumIndex != null ? (browse.msLevel[spectrumIndex] ?? null) : null;
  const shownRtSec = browse && spectrumIndex != null && Number.isFinite(browse.rt[spectrumIndex] ?? NaN) ? (browse.rt[spectrumIndex] as number) : null;
  const levelTotal = levelSet ? levelSet.length : null;

  // Isobaric reporter ions (TMT/iTRAQ): if the run carries SDRF channels and the
  // current spectrum is MSn≥2, match each channel's reporter m/z to a peak. Pills
  // + plot dots share a per-channel colour (assigned by channel order).
  const specForReporters = spectrum
    ? {
        index: spectrum.index,
        id: spectrum.id,
        mz: spectrum.mz,
        intensity: spectrum.intensity,
        representation: spectrum.representation,
        msLevel: curLevel,
        time: null,
      }
    : null;
  const { reporters, matched } = spectrumReporters(
    channels.length ? channels.map((c) => ({ ...c, tag: null })) : undefined,
    specForReporters,
  );
  const reporterMarkers: ReporterMarker[] =
    matched > 0
      ? reporters.map((r, i) => ({
          mz: r.reporterMz,
          label: r.channelLabel ?? "",
          matched: r.intensity != null,
          color: channelColor(i),
          peakMz: r.matchedMz,
          peakInt: r.intensity,
          active: i === selectedChannel,
        }))
      : [];

  // Zoom window over the whole reporter-ion cluster (so all channels are visible with
  // the clicked one emphasized). Null = full view.
  const channelZoom: [number, number] | null =
    selectedChannel != null && reporterMarkers.length > 0
      ? [
          Math.min(...reporterMarkers.map((m) => m.mz)) - 0.6,
          Math.max(...reporterMarkers.map((m) => m.mz)) + 0.6,
        ]
      : null;

  // When the active filter excludes the current spectrum, jump to the first match.
  function applyFilter(level: number | null) {
    setMsLevelFilter(level);
    if (level != null && browse && browse.msLevel[currentIndex] !== level) {
      const first = levelIndex.byLevel.get(level)?.[0];
      if (first != null) void selectSpectrum(first);
    }
  }

  // Build select options from the active set. Cap at 1000 options. The displayed
  // number is always the 1-based position within the active set: within a level it is
  // the within-level index (1..count); in "All" it is absolute index + 1.
  const MAX_OPTS = 1000;
  const optIndices = active.slice(0, MAX_OPTS);
  const selectOptions: SelectOption[] = optIndices.map((i, pos) => ({
    value: String(i),
    label: !browse
      ? `Spectrum ${pos + 1}`
      : filtered
        ? `MS${msLevelFilter} #${pos + 1} · ${browse.id[i]}`
        : `#${pos + 1} · ${browse.id[i]}`,
  }));

  // Prev/Next step WITHIN the active set, using the current 1-based rank.
  const prevIdx = currentRank != null && currentRank > 1 ? active[currentRank - 2]! : null;
  const nextIdx =
    currentRank != null && currentRank < active.length ? active[currentRank]! : null;

  // Large-file index input: the typed number is the 1-based position within the active
  // set (within-level for a level, absolute+1 for "All"); absoluteOf maps it back to
  // the absolute index to select. Out-of-range input is ignored.
  function commitInput() {
    const v = Number(inputVal.trim());
    if (Number.isFinite(v)) {
      const abs = absoluteOf(active, Math.floor(v));
      if (abs != null) void selectSpectrum(abs);
    }
    setInputVal("");
  }

  const hasLargeFile = active.length > MAX_OPTS;

  return (
    <div
      data-testid="spectra-view"
      style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
    >
      {/* Spectrum picker */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        {/* MS-level filter — only levels present in the file appear (filled by scanBreakdown). */}
        {availableLevels.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            MS level
            <Select
              data-testid="ms-level-filter"
              value={msLevelFilter == null ? "all" : String(msLevelFilter)}
              onChange={(val) => applyFilter(val === "all" ? null : Number(val))}
              options={[
                { value: "all", label: "All" },
                ...availableLevels.map((l) => ({ value: String(l), label: `MS${l}` })),
              ]}
              ariaLabel="Filter spectra by MS level"
              size="sm"
            />
          </label>
        )}

        {hasLargeFile ? (
          <>
            <label
              htmlFor="spectrum-index-input"
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {filtered
                ? `MS${msLevelFilter} index (1–${active.length}):`
                : `Spectrum index (1–${active.length}):`}
            </label>
            <input
              id="spectrum-index-input"
              data-testid="spectrum-index-input"
              type="number"
              min={1}
              max={active.length}
              value={inputVal}
              placeholder={currentRank != null ? String(currentRank) : ""}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitInput();
              }}
              style={{
                width: "6rem",
                padding: "0.3rem 0.4rem",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-sm)",
                background: "var(--surface-input)",
                color: "var(--text-heading)",
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={commitInput}
              data-testid="spectrum-go-btn"
            >
              Go
            </Button>
          </>
        ) : (
          <Select
            data-testid="spectrum-select"
            value={String(currentIndex)}
            onChange={(val) => void selectSpectrum(Number(val))}
            options={selectOptions}
            ariaLabel="Select spectrum"
            size="sm"
          />
        )}

        <Button
          variant="ghost"
          size="sm"
          disabled={prevIdx == null || spectrumLoading}
          onClick={() => prevIdx != null && void selectSpectrum(prevIdx)}
          aria-label="Previous spectrum"
          data-testid="spectrum-prev"
        >
          ‹ Prev
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={nextIdx == null || spectrumLoading}
          onClick={() => nextIdx != null && void selectSpectrum(nextIdx)}
          aria-label="Next spectrum"
          data-testid="spectrum-next"
        >
          Next ›
        </Button>

        {spectrum && spectrum.representation && (
          <span
            data-testid="spectrum-representation"
            title={
              spectrum.representation === "centroid"
                ? "Centroid (stick) spectrum"
                : "Profile (continuous) spectrum"
            }
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              padding: "0.1rem 0.5rem",
              border: `1px solid ${
                spectrum.representation === "centroid"
                  ? "var(--blue-600, #3b54da)"
                  : "var(--green-600, #2e9e5b)"
              }`,
              borderRadius: "var(--radius-pill, 999px)",
              background: "var(--surface-card, #fff)",
              color:
                spectrum.representation === "centroid"
                  ? "var(--blue-600, #3b54da)"
                  : "var(--green-600, #2e9e5b)",
              fontSize: "var(--text-xs, 0.72rem)",
              fontWeight: "var(--weight-semibold, 600)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
            }}
          >
            {spectrum.representation}
          </span>
        )}
        {spectrum && (
          <span
            data-testid="spectrum-meta"
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-muted)",
              marginLeft: spectrum.representation ? "0" : "auto",
            }}
          >
            {[
              `abs #${spectrum.index}`,
              curLevel != null ? `MS${curLevel}` : null,
              curLevel != null && withinLevelRank != null
                ? `#${withinLevelRank}${levelTotal != null ? `/${levelTotal}` : ""} in level`
                : null,
              spectrum.id ? `id: ${spectrum.id}` : null,
              `${spectrum.mz.length} pts`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        {spectrumLoading && (
          <span
            style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}
          >
            loading…
          </span>
        )}
      </div>

      {/* Spectrum plot */}
      <div
        data-testid="spectrum-plot-host"
        className="chart-host"
        style={{ height: 320, position: "relative" }}
      >
        <SpectrumPlot
          spectrum={spectrum}
          xicWindow={null}
          reporters={reporterMarkers}
          zoom={channelZoom}
          onZoomChange={(range) => { if (range == null) setSelectedChannel(null); }}
          onPeakClick={goToIonImage}
          onPeakContextMenu={(mz, x, y) => setPeakMenu({
            mz, x, y,
            msLevel: shownLevel != null && shownLevel >= 1 ? shownLevel : null,
            spectrumRtSec: shownRtSec,
            rtBounds: stats.rtRange,
          })}
        />
        {spectrumLoading && !spectrum && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: "var(--text-sm)",
            }}
          >
            Loading spectrum…
          </div>
        )}
      </div>

      {/* Isobaric channel pills — color-coded to the reporter-peak dots above.
          Click a pill to zoom the plot to the reporter region + highlight its peak. */}
      {matched > 0 && (
        <ChannelPills
          reporters={reporters}
          selected={selectedChannel}
          onSelect={(i) => setSelectedChannel((cur) => (cur === i ? null : i))}
        />
      )}

      {spectrum && (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          <span data-testid="spectrum-points">{spectrum.mz.length}</span>
          {" points · "}
          {spectrum.representation === "centroid"
            ? "centroid (stick spectrum)"
            : "profile (line)"}
          {" · scroll to zoom · double-click to reset"}
        </p>
      )}

      {/* Per-spectrum metadata tree (scan time, polarity, base peak, TIC, m/z range,
          precursor / selected-ion, promoted CV columns). Restored from mzPeakExplorer's
          collapsible "Spectrum metadata" panel (dropped in the engine harvest). The
          CV-aware TreeView resolves accession-named keys to human labels. */}
      {spectrum && spectrum.meta != null && (
        <details data-testid="spectrum-metadata-panel" style={{ marginTop: "0.1rem" }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: "var(--text-sm)",
              color: "var(--text-muted)",
              userSelect: "none",
            }}
          >
            Spectrum metadata
          </summary>
          <div style={{ marginTop: "0.5rem", maxWidth: 820 }}>
            <TreeView label="spectrum" value={spectrum.meta} defaultOpen={2} />
          </div>
        </details>
      )}

      {/* BL-08: centroid peak table. Only for centroid (stick) spectra — profile
          spectra are continuous traces and have no discrete peak list. Rows are
          sorted by descending intensity and capped (the cap is noted in the UI).
          Clicking a row drives BL-09 (jump to ion image) via the shared handler. */}
      {spectrum && spectrum.representation === "centroid" && (
        <PeakTable spectrum={spectrum} onPeakClick={goToIonImage} />
      )}

      {peakMenu && (
        <PeakChromMenu
          key={`${peakMenu.mz}:${peakMenu.x}:${peakMenu.y}`}
          mz={peakMenu.mz}
          x={peakMenu.x}
          y={peakMenu.y}
          defaultTolDa={settings.xicTolDa}
          rtHalfSec={settings.xicRtHalfMin * 60}
          spectrumRtSec={peakMenu.spectrumRtSec}
          rtBounds={peakMenu.rtBounds}
          msLevel={peakMenu.msLevel}
          onClose={closePeakMenu}
          onCreate={(tolDa, rt) => {
            addXic({ mz: peakMenu.mz, tolDa, ...(rt ? { rt } : {}), ...(peakMenu.msLevel != null ? { msLevel: peakMenu.msLevel } : {}) });
            setPeakMenu(null);
            setView("chromatograms");
          }}
        />
      )}
    </div>
  );
}

/** Collapsible centroid peak table (BL-08): m/z + intensity rows, sorted by
 *  descending intensity, capped at the top PEAK_TABLE_CAP. Collapsed by default to
 *  match the metadata panel. A row click jumps to the ion image (BL-09). */
const PEAK_TABLE_CAP = 200;
function PeakTable({
  spectrum,
  onPeakClick,
}: {
  spectrum: NonNullable<ReturnType<typeof useStore.getState>["spectrum"]>;
  onPeakClick: (mz: number) => void;
}) {
  const n = spectrum.mz.length;
  // Rank peak indices by descending intensity, then keep the top cap.
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => spectrum.intensity[b]! - spectrum.intensity[a]!);
  const top = order.slice(0, PEAK_TABLE_CAP);
  const numRight = {
    fontFamily: "var(--font-mono, monospace)",
    textAlign: "right" as const,
    padding: "0.15rem 0.6rem",
    whiteSpace: "nowrap" as const,
  };
  const headCell = {
    textAlign: "right" as const,
    padding: "0.2rem 0.6rem",
    color: "var(--text-muted)",
    fontWeight: "var(--weight-semibold, 600)",
    borderBottom: "1px solid var(--border-default, #e2e8f0)",
    position: "sticky" as const,
    top: 0,
    background: "var(--surface-card, #fff)",
  };
  return (
    <details data-testid="peak-table" style={{ marginTop: "0.1rem" }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: "var(--text-sm)",
          color: "var(--text-muted)",
          userSelect: "none",
        }}
      >
        Peak table — top {Math.min(PEAK_TABLE_CAP, n)} of {n} (by intensity) · click a row to view ion image
      </summary>
      <div style={{ marginTop: "0.5rem", maxWidth: 420, maxHeight: 360, overflow: "auto" }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            fontSize: "var(--text-sm)",
          }}
        >
          <thead>
            <tr>
              <th style={headCell}>m/z</th>
              <th style={headCell}>intensity</th>
            </tr>
          </thead>
          <tbody>
            {top.map((i) => (
              <tr
                key={i}
                data-testid={`peak-row-${i}`}
                onClick={() => onPeakClick(spectrum.mz[i]!)}
                title={`Click to view ion image at m/z ${spectrum.mz[i]!.toFixed(4)}`}
                style={{ cursor: "pointer" }}
              >
                <td style={numRight}>{spectrum.mz[i]!.toFixed(4)}</td>
                <td style={{ ...numRight, color: "var(--text-muted)" }}>
                  {spectrum.intensity[i]!.toExponential(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Slim row of isobaric channel pills under the spectrum, color-coded to the reporter
 *  peak dots. Each pill shows the channel label, its intensity RELATIVE TO THE STRONGEST
 *  channel (the max reporter = 100%), and the sample name; undetected channels are
 *  dimmed. Clicking a pill zooms the plot to the reporter region + highlights its peak. */
function ChannelPills({
  reporters,
  selected,
  onSelect,
}: {
  reporters: ReporterPeak[];
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  const maxInt = Math.max(0, ...reporters.map((r) => r.intensity ?? 0)); // highest = 100%
  const matched = reporters.filter((r) => r.intensity != null).length;
  return (
    <div data-testid="channel-pills" style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        Reporter ions — {matched}/{reporters.length} channels detected (±5 mDa) · relative to strongest · click to zoom
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        {reporters.map((r, i) => {
          const color = channelColor(i);
          const has = r.intensity != null;
          const pct = has && maxInt > 0 ? (100 * (r.intensity ?? 0)) / maxInt : 0;
          const isSel = selected === i;
          return (
            <button
              type="button"
              key={`${r.channelLabel ?? ""}:${i}`}
              data-testid={`channel-pill-${i}`}
              aria-pressed={isSel}
              onClick={() => onSelect(i)}
              title={`${r.channelLabel ?? ""}${r.sampleName ? ` · ${r.sampleName}` : ""} · reporter m/z ${r.reporterMz.toFixed(4)}${has ? ` · ${pct.toFixed(1)}% of max` : " · not detected"} — click to zoom + highlight`}
              style={{
                display: "flex", alignItems: "center", gap: "0.35rem",
                padding: "0.15rem 0.45rem 0.15rem 0.35rem",
                border: `1px solid ${isSel ? color : has ? color : "var(--border-default, #e2e8f0)"}`,
                borderLeft: `3px solid ${color}`,
                borderRadius: "var(--radius-pill, 999px)",
                background: isSel ? "var(--surface-panel, #f1f5f9)" : "var(--surface-card, #fff)",
                boxShadow: isSel ? `0 0 0 2px ${color}40` : "none",
                opacity: has ? 1 : 0.45,
                fontSize: "var(--text-xs, 0.72rem)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: "var(--text-heading, #1e293b)" }}>{r.channelLabel}</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-muted, #64748b)" }}>
                {has ? `${pct.toFixed(0)}%` : "—"}
              </span>
              {r.sampleName && (
                <span style={{ color: "var(--text-muted, #94a3b8)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.sampleName}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}


/** Cursor popover for "right-click a peak → create chromatogram": shows the resolved m/z,
 *  an m/z tolerance (default from Settings), an RT range (default = the shown spectrum's RT
 *  ± the Settings half-window, clamped to the run), and the MS level the XIC is limited to.
 *  Dismisses on backdrop click or Esc. */
function PeakChromMenu({
  mz, x, y, defaultTolDa, rtHalfSec, spectrumRtSec, rtBounds, msLevel, onCreate, onClose,
}: {
  mz: number;
  x: number;
  y: number;
  defaultTolDa: number;
  rtHalfSec: number;
  spectrumRtSec: number | null;
  rtBounds: [number, number] | null;
  msLevel: number | null;
  onCreate: (tolDa: number, rt: [number, number] | undefined) => void;
  onClose: () => void;
}) {
  const seedLo =
    spectrumRtSec != null ? Math.max(spectrumRtSec - rtHalfSec, rtBounds ? rtBounds[0] : -Infinity) : null;
  const seedHi =
    spectrumRtSec != null ? Math.min(spectrumRtSec + rtHalfSec, rtBounds ? rtBounds[1] : Infinity) : null;
  const [tol, setTol] = useState(String(defaultTolDa));
  const [rtMin, setRtMin] = useState(seedLo != null && Number.isFinite(seedLo) ? seedLo.toFixed(1) : "");
  const [rtMax, setRtMax] = useState(seedHi != null && Number.isFinite(seedHi) ? seedHi.toFixed(1) : "");

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tolNum = Number(tol);
  const tolValid = Number.isFinite(tolNum) && tolNum > 0;
  const lo = Number(rtMin);
  const hi = Number(rtMax);
  const rtBlank = rtMin.trim() === "" && rtMax.trim() === "";
  const rtFilled = rtMin.trim() !== "" && rtMax.trim() !== "" && Number.isFinite(lo) && Number.isFinite(hi) && lo < hi;
  const rtValid = rtBlank || rtFilled; // partial / lo>=hi → invalid, don't silently fall back to full-range run
  const valid = tolValid && rtValid;
  function create() {
    if (!valid) return;
    onCreate(tolNum, rtFilled ? [lo, hi] : undefined);
  }
  const left = Math.max(8, Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1024) - 280));
  const top = Math.max(8, Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 768) - 220));
  const inp: CSSProperties = { width: "5.5rem", padding: "0.25rem 0.4rem", border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)", fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", background: "var(--surface-input)", color: "var(--text-heading)" };

  return (
    <>
      <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 40 }} aria-hidden />
      <div
        data-testid="peak-chrom-menu"
        role="dialog"
        aria-label="Create chromatogram from peak"
        style={{ position: "fixed", left, top, zIndex: 41, minWidth: 250, padding: "0.7rem 0.8rem", display: "flex", flexDirection: "column", gap: "0.5rem", background: "var(--surface-panel, #fff)", border: "1px solid var(--border-subtle, #e2e8f0)", borderRadius: "var(--radius-md, 8px)", boxShadow: "var(--shadow-md, 0 8px 24px rgba(15,23,42,0.16))" }}
      >
        <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-heading, #0f172a)" }}>
          Chromatogram for m/z {mz.toFixed(4)}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          {msLevel != null ? `Limited to MS${msLevel} spectra` : "All spectra (MS level unknown)"}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          m/z ±
          <input data-testid="peak-chrom-tol" type="number" step="any" value={tol} onChange={(e) => setTol(e.target.value)} style={inp} />
          Da
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "var(--text-sm)", color: "var(--text-muted)", flexWrap: "wrap" }}>
          RT (s)
          <input data-testid="peak-chrom-rtmin" type="number" step="any" placeholder="min" value={rtMin} onChange={(e) => setRtMin(e.target.value)} style={inp} />
          –
          <input data-testid="peak-chrom-rtmax" type="number" step="any" placeholder="max" value={rtMax} onChange={(e) => setRtMax(e.target.value)} style={inp} />
        </label>
        {!rtValid && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-danger, #dc2626)" }}>
            Enter both min &lt; max, or leave both blank for full range.
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.1rem" }}>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" size="sm" onClick={create} disabled={!valid} data-testid="peak-chrom-create">Create</Button>
        </div>
      </div>
    </>
  );
}
