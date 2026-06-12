import { useState } from "react";
import "@mzpeak/ui-kit/styles.css";
import { SpectrumPlot, type SpectrumArrays } from "@mzpeak/ui-kit";
import type { CapabilityModel, FileStats } from "@mzpeak/contracts";
import { engine } from "./engine";

/**
 * Phase-4 slice 1 — the minimal end-to-end app: open a .mzpeak through the engine
 * worker (real mzpeakts + parquet-wasm in the browser), read its capabilities, and
 * render spectrum 0 with the ui-kit plot. Proves the whole stack runs in a browser.
 */
export function App() {
  const [status, setStatus] = useState("Open a .mzpeak file to begin.");
  const [caps, setCaps] = useState<CapabilityModel | null>(null);
  const [stats, setStats] = useState<FileStats | null>(null);
  const [spectrum, setSpectrum] = useState<SpectrumArrays | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSpectrum(null);
    setCaps(null);
    setStats(null);
    setBusy(true);
    setStatus(`Opening ${file.name}…`);
    try {
      const bytes = await file.arrayBuffer();
      const opened = await engine.open({ kind: "file", bytes, name: file.name });
      setCaps(opened.capabilities);
      setStats(opened.stats);
      setStatus(`Opened ${file.name}`);
      if (opened.stats && opened.stats.numSpectra > 0) {
        setSpectrum(await engine.selectSpectrum(0));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Open failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "2rem auto", padding: "0 1rem", fontFamily: "var(--font-sans, sans-serif)" }}>
      <h1 style={{ marginBottom: "0.25rem" }}>mzPeak Viewer</h1>
      <p style={{ color: "var(--text-muted, #666)", marginTop: 0 }}>Unified viewer — engine worker + ui-kit, end to end.</p>

      <p>
        <input data-testid="file-input" type="file" accept=".mzpeak" onChange={onFile} disabled={busy} />
      </p>

      <p data-testid="status">{status}</p>
      {error && (
        <p data-testid="error" style={{ color: "var(--danger, #c00)" }}>
          {error}
        </p>
      )}

      {caps && stats && (
        <dl data-testid="file-readout" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "0.25rem 1rem" }}>
          <dt>Spectra</dt>
          <dd data-testid="num-spectra">{stats.numSpectra}</dd>
          <dt>Imaging</dt>
          <dd data-testid="is-imaging">{caps.imaging.isImaging ? "yes" : "no"}</dd>
          <dt>Chromatograms</dt>
          <dd>{caps.chromatograms.numChromatograms}</dd>
          <dt>Optical images</dt>
          <dd>{caps.optical.count}</dd>
        </dl>
      )}

      {spectrum && (
        <section>
          <h2 style={{ fontSize: "1rem" }}>
            Spectrum 0 · {spectrum.representation ?? "unknown"} · <span data-testid="spectrum-points">{spectrum.mz.length}</span> points
          </h2>
          <div className="chart-host" style={{ height: 320 }}>
            <SpectrumPlot spectrum={spectrum} />
          </div>
        </section>
      )}
    </div>
  );
}
