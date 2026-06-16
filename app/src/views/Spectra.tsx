// Spectra view — browse list / index picker → selectSpectrum → SpectrumPlot.
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { SpectrumPlot, Select, Button, spectrumReporters, type SelectOption, type ReporterMarker, type ReporterPeak } from "@mzpeak/ui-kit";

// Categorical palette for isobaric channels — shared by the pills + the peak dots
// so a channel reads as the same colour in both places.
const CHANNEL_PALETTE = [
  "#3b54da", "#c00000", "#2e9e5b", "#b026d3", "#e8820c", "#0e9bb5",
  "#d6336c", "#5f6caf", "#7cb518", "#e0a800", "#8a3ffc", "#1098ad",
  "#c2410c", "#0b7285", "#9c36b5", "#2b8a3e", "#e64980", "#495057",
];
const channelColor = (i: number) => CHANNEL_PALETTE[i % CHANNEL_PALETTE.length]!;

export function Spectra() {
  const phase = useStore((s) => s.phase);
  const stats = useStore((s) => s.stats);
  const browse = useStore((s) => s.browse);
  const spectrum = useStore((s) => s.spectrum);
  const spectrumLoading = useStore((s) => s.spectrumLoading);
  const selector = useStore((s) => s.selector);
  const selectSpectrum = useStore((s) => s.selectSpectrum);
  const msLevelFilter = useStore((s) => s.msLevelFilter);
  const setMsLevelFilter = useStore((s) => s.setMsLevelFilter);
  const channels = useStore((s) => s.channels);

  const [inputVal, setInputVal] = useState("");
  // Clicking a channel pill zooms the plot to the reporter region + highlights that
  // channel's peak. Reset when the spectrum changes or the user double-clicks to reset.
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const spectrumIndex = spectrum?.index ?? null;
  useEffect(() => { setSelectedChannel(null); }, [spectrumIndex]);

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
        This file contains no spectra.
      </p>
    );
  }

  const currentIndex = selector?.index ?? 0;

  // MS-level filter (only levels actually present in the file populate the dropdown;
  // filled by scanBreakdown). Filtering needs the per-spectrum browse.msLevel column.
  const availableLevels = stats.msLevels ?? [];
  const allIndices = browse
    ? Array.from(browse.msLevel, (_, i) => i)
    : Array.from({ length: numSpectra }, (_, i) => i);
  const filtered = msLevelFilter != null && !!browse;
  const filteredIndices = !filtered
    ? allIndices
    : allIndices.filter((i) => browse!.msLevel[i] === msLevelFilter);

  const levelOf = (i: number): number | null => (browse ? browse.msLevel[i] ?? null : null);
  const curLevel = levelOf(currentIndex);
  // Within-level rank (1-based) of the current spectrum among all spectra of its level.
  // When a filter is active this equals the position in the filtered set; with "All" it
  // still reports the position within the spectrum's own MS level (so #2's readout holds).
  let withinLevelRank: number | null = null;
  if (browse && curLevel != null) {
    let r = 0;
    for (let j = 0; j <= currentIndex && j < browse.msLevel.length; j++) {
      if (browse.msLevel[j] === curLevel) r++;
    }
    withinLevelRank = r;
  }
  // Total spectra at the current level (for "#M of N").
  const levelTotal =
    browse && curLevel != null ? allIndices.filter((i) => browse.msLevel[i] === curLevel).length : null;

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
      const first = allIndices.find((i) => browse.msLevel[i] === level);
      if (first != null) void selectSpectrum(first);
    }
  }

  // Build select options from the (filtered) browse index, else a simple range. Cap at
  // 1000 options. When filtered the displayed index is the within-level position
  // (1-based); "All" keeps the absolute index.
  const MAX_OPTS = 1000;
  const optIndices = filteredIndices.slice(0, MAX_OPTS);
  const selectOptions: SelectOption[] = optIndices.map((i, pos) => ({
    value: String(i),
    label: !browse
      ? `Spectrum ${i}`
      : filtered
        ? `MS${msLevelFilter} #${pos + 1} · ${browse.id[i]}`
        : `#${i} ${browse.id[i]}`,
  }));

  // Prev/Next step WITHIN the filtered set.
  const filterPos = filteredIndices.indexOf(currentIndex);
  const prevIdx = filterPos > 0 ? filteredIndices[filterPos - 1]! : null;
  const nextIdx =
    filterPos >= 0 && filterPos < filteredIndices.length - 1 ? filteredIndices[filterPos + 1]! : null;

  // Large-file index input. When filtered, the input is a 1-based within-level index
  // mapped to the absolute index; with "All" it is the absolute index.
  function commitInput() {
    const v = Number(inputVal.trim());
    if (Number.isFinite(v)) {
      if (filtered) {
        const abs = filteredIndices[Math.floor(v) - 1];
        if (abs != null) void selectSpectrum(abs);
      } else if (v >= 0 && v < numSpectra) {
        void selectSpectrum(Math.floor(v));
      }
    }
    setInputVal("");
  }

  const hasLargeFile = filteredIndices.length > MAX_OPTS;

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
                ? `MS${msLevelFilter} index (1–${filteredIndices.length}):`
                : `Spectrum index (0–${numSpectra - 1}):`}
            </label>
            <input
              id="spectrum-index-input"
              data-testid="spectrum-index-input"
              type="number"
              min={0}
              max={numSpectra - 1}
              value={inputVal}
              placeholder={String(currentIndex)}
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
    </div>
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
