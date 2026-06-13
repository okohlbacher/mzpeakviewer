// Spectra view — browse list / index picker → selectSpectrum → SpectrumPlot.
import { useState } from "react";
import { useStore } from "../store";
import { SpectrumPlot, Select, Button, type SelectOption } from "@mzpeak/ui-kit";

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

  const [inputVal, setInputVal] = useState("");

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
  const filteredIndices =
    msLevelFilter == null || !browse
      ? allIndices
      : allIndices.filter((i) => browse.msLevel[i] === msLevelFilter);

  // When the active filter excludes the current spectrum, jump to the first match.
  function applyFilter(level: number | null) {
    setMsLevelFilter(level);
    if (level != null && browse && browse.msLevel[currentIndex] !== level) {
      const first = allIndices.find((i) => browse.msLevel[i] === level);
      if (first != null) void selectSpectrum(first);
    }
  }

  // Build select options from the (filtered) browse index, else a simple range.
  // Cap at 1000 options to avoid huge dropdowns on large files.
  const MAX_OPTS = 1000;
  const optIndices = filteredIndices.slice(0, MAX_OPTS);
  const selectOptions: SelectOption[] = optIndices.map((i) => ({
    value: String(i),
    label: browse ? `#${i} ${browse.id[i]}` : `Spectrum ${i}`,
  }));

  // Prev/Next step WITHIN the filtered set.
  const filterPos = filteredIndices.indexOf(currentIndex);
  const prevIdx = filterPos > 0 ? filteredIndices[filterPos - 1]! : null;
  const nextIdx =
    filterPos >= 0 && filterPos < filteredIndices.length - 1 ? filteredIndices[filterPos + 1]! : null;

  function commitInput() {
    const v = Number(inputVal.trim());
    if (Number.isFinite(v) && v >= 0 && v < numSpectra) {
      void selectSpectrum(Math.floor(v));
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
              Spectrum index (0–{numSpectra - 1}):
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

        {spectrum && (
          <span
            data-testid="spectrum-meta"
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-muted)",
              marginLeft: "auto",
            }}
          >
            {[
              `#${spectrum.index}`,
              spectrum.id ? `id: ${spectrum.id}` : null,
              spectrum.representation ?? null,
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
