import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { ChromPlot } from "./ChromPlot";
import { Button, PlotSpinner, TextField } from "./components";

/** The Chromatograms view: the total-ion chromatogram and extracted-ion
 *  chromatograms (XIC). Clicking a point selects the spectrum at that retention
 *  time, which is then viewable in the Spectra tab. */
export function ChromatogramsTab() {
  const initBrowse = useStore((s) => s.initBrowse);
  useEffect(() => {
    void initBrowse();
  }, [initBrowse]);

  const numSpectra = useStore((s) => s.summary?.numSpectra ?? 0);
  const spectra = useStore((s) => s.spectra);
  const selectedIndex = useStore((s) => s.selectedIndex);
  const selectedSpectrum = useStore((s) => s.selectedSpectrum);
  const selectByTime = useStore((s) => s.selectByTime);
  const setTab = useStore((s) => s.setTab);

  const chrom = useStore((s) => s.chrom);
  const chromMode = useStore((s) => s.chromMode);
  const chromLoading = useStore((s) => s.chromLoading);
  const xicParams = useStore((s) => s.xicParams);
  const chromStoredId = useStore((s) => s.chromStoredId);
  const runXic = useStore((s) => s.runXic);
  const showTic = useStore((s) => s.showTic);

  const [mz, setMz] = useState("");
  const [tol, setTol] = useState("0.01");

  if (numSpectra === 0) {
    return <p className="hint">This file contains no spectra.</p>;
  }

  const selRow = selectedIndex != null ? spectra[selectedIndex] : undefined;
  const selTime = selectedSpectrum?.time ?? selRow?.time ?? null;

  // Trim binary-float noise (e.g. 0.150000…0568) from displayed m/z values without
  // losing real precision.
  const fmtMz = (x: number) => String(Number(x.toFixed(6)));
  const chromTitle =
    chromMode === "stored"
      ? `Chromatogram — ${chromStoredId ?? "stored"}`
      : chromMode === "xic" && xicParams
        ? `XIC — m/z ${fmtMz(xicParams.mz)} ± ${fmtMz(xicParams.tolDa)}`
        : "Total ion chromatogram (MS1)";

  function submitXic() {
    const m = Number(mz);
    const t = Number(tol);
    if (Number.isFinite(m) && m > 0 && Number.isFinite(t) && t > 0) {
      void runXic(m, t);
    }
  }

  return (
    <div className="browse view-narrow">
      <div className="browse-controls">
        <div className="control-row">
          <TextField
            label="XIC m/z"
            type="number"
            step="0.001"
            width="6rem"
            placeholder="e.g. 445.12"
            value={mz}
            onChange={(e) => setMz(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitXic()}
          />
          <TextField
            label="± tol"
            type="number"
            step="0.001"
            width="4rem"
            suffix="Da"
            value={tol}
            onChange={(e) => setTol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitXic()}
          />
          <Button size="sm" variant="primary" disabled={!mz} onClick={submitXic}>
            Extract
          </Button>
          {(chromMode !== "tic" || !chrom) && (
            <Button size="sm" disabled={chromLoading} onClick={() => void showTic()}>
              {chromMode === "tic" ? "Build TIC" : "Show TIC"}
            </Button>
          )}
        </div>

        {selRow && (
          <div className="control-row" style={{ marginLeft: "auto" }}>
            <Button size="sm" onClick={() => setTab("spectra")}>
              View spectrum #{selRow.index}
              {selRow.time != null ? ` · RT ${selRow.time.toFixed(2)} s` : ""} ›
            </Button>
          </div>
        )}
      </div>

      <div className="data-stage">
        <div className="stage-plot">
          <h4 className="stage-h">
            {chromTitle}
            <span className="stage-meta">
              {chromLoading
                ? "computing…"
                : chrom
                  ? `${chrom.length} points · click to select a spectrum`
                  : "not computed"}
            </span>
          </h4>
          {chrom || chromLoading ? (
            <>
              <div style={{ position: "relative" }}>
                <ChromPlot
                  points={chrom ?? []}
                  onPick={(t) => void selectByTime(t)}
                  selectedTime={selTime}
                />
                {chromLoading && <PlotSpinner label="Loading chromatogram…" />}
              </div>
              <p className="stage-hint" style={{ marginTop: "0.25rem" }}>
                Click a point to select the nearest spectrum · scroll to zoom ·
                drag to box-zoom RT
              </p>
            </>
          ) : (
            <p className="stage-hint" style={{ padding: "1.2rem 0.2rem" }}>
              <strong style={{ color: "var(--text-heading)" }}>Build TIC</strong>{" "}
              scans the per-spectrum index (metadata only) and shows the MS1
              total-ion chromatogram; if the file has no precomputed TIC column it
              sums every MS1 spectrum. Or extract an XIC for a specific m/z window
              above.
            </p>
          )}
        </div>
      </div>

      <p className="hint">
        Click a point on the chromatogram to select the spectrum at that
        retention time, then open the <strong>Spectra</strong> tab to view it.
      </p>
    </div>
  );
}
