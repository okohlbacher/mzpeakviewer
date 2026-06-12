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

  // Build select options from browse index if available, else a simple range.
  // Cap at 1000 options to avoid huge dropdowns on large files.
  const MAX_OPTS = 1000;
  let selectOptions: SelectOption[];
  if (browse && browse.id.length <= MAX_OPTS) {
    selectOptions = browse.id.map((id, i) => ({
      value: String(i),
      label: `#${i} ${id}`,
    }));
  } else {
    const cap = Math.min(numSpectra, MAX_OPTS);
    selectOptions = Array.from({ length: cap }, (_, i) => ({
      value: String(i),
      label: `Spectrum ${i}`,
    }));
  }

  function commitInput() {
    const v = Number(inputVal.trim());
    if (Number.isFinite(v) && v >= 0 && v < numSpectra) {
      void selectSpectrum(Math.floor(v));
    }
    setInputVal("");
  }

  const hasLargeFile = numSpectra > MAX_OPTS;

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
          disabled={currentIndex <= 0 || spectrumLoading}
          onClick={() => void selectSpectrum(currentIndex - 1)}
          aria-label="Previous spectrum"
          data-testid="spectrum-prev"
        >
          ‹ Prev
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={currentIndex >= numSpectra - 1 || spectrumLoading}
          onClick={() => void selectSpectrum(currentIndex + 1)}
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
