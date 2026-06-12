import { useStore } from "../state/store";
import { Panel, SegmentedControl, Select, Checkbox, NumberField } from "./ds";
import type { Colormap } from "./rasterize";
import type { HistogramMode } from "../compute/histogram";

/**
 * Global settings — a collapsible Panel in the inspector rail (left sidebar).
 * All values are GLOBAL and persisted in localStorage by the store:
 *  - interaction: peak-click Δm/z (half-window used when clicking a peak in the
 *    spectrum to render that mass's ion image)
 *  - rendering: colormap, scale, percentile clip, TIC-normalize, smooth σ, contrast
 */
export function SettingsView({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const colormap = useStore((s) => s.colormap);
  const scale = useStore((s) => s.scale);
  const percentile = useStore((s) => s.percentile);
  const setColormapSettings = useStore((s) => s.setColormapSettings);
  const ticNorm = useStore((s) => s.ticNorm);
  const setTicNorm = useStore((s) => s.setTicNorm);
  const smoothSigma = useStore((s) => s.smoothSigma);
  const setSmoothSigma = useStore((s) => s.setSmoothSigma);
  const histogramMode = useStore((s) => s.histogramMode);
  const setHistogramMode = useStore((s) => s.setHistogramMode);
  const peakDeltaMass = useStore((s) => s.peakDeltaMass);
  const setPeakDeltaMass = useStore((s) => s.setPeakDeltaMass);
  const preloadEnabled = useStore((s) => s.preloadEnabled);
  const setPreloadEnabled = useStore((s) => s.setPreloadEnabled);
  const cacheLimitMB = useStore((s) => s.cacheLimitMB);
  const setCacheLimitMB = useStore((s) => s.setCacheLimitMB);

  return (
    <Panel title="Settings" testid="settings-view" defaultOpen={defaultOpen}>
      <div className="settings-card__group">
        <div className="mz-overline">Interaction</div>
        <div className="popover__row">
          <span className="popover__lbl">Peak-click Δm/z</span>
          <NumberField
            size="sm"
            type="number"
            width="92px"
            unit="Da"
            value={String(peakDeltaMass)}
            onChange={(v) => {
              const n = Number(v);
              if (Number.isFinite(n) && n > 0) setPeakDeltaMass(n);
            }}
            ariaLabel="peak click delta mass"
          />
        </div>
        <p className="settings-card__hint">
          Half-window applied when clicking a peak in the spectrum to render its
          ion image (m/z ± Δ).
        </p>
      </div>

      <div className="settings-card__group">
        <div className="mz-overline">Rendering</div>
        <div className="popover__row">
          <span className="popover__lbl">Colormap</span>
          <SegmentedControl
            size="sm"
            ariaLabel="colormap"
            value={colormap}
            onChange={(v) => setColormapSettings(v as Colormap, scale, percentile)}
            options={[
              { value: "viridis", label: "viridis" },
              { value: "inferno", label: "inferno" },
              { value: "gray", label: "gray" },
            ]}
          />
        </div>
        <div className="popover__row">
          <span className="popover__lbl">Scale</span>
          <SegmentedControl
            size="sm"
            ariaLabel="scale"
            value={scale}
            onChange={(v) =>
              setColormapSettings(colormap as Colormap, v as "linear" | "log", percentile)
            }
            options={[
              { value: "linear", label: "linear" },
              { value: "log", label: "log" },
            ]}
          />
        </div>
        <div className="popover__row">
          <span className="popover__lbl">Percentile clip</span>
          <Select
            size="sm"
            ariaLabel="percentile clip"
            value={String(percentile)}
            onChange={(v) => setColormapSettings(colormap as Colormap, scale, Number(v))}
            options={[
              { value: "0.9", label: "90th" },
              { value: "0.95", label: "95th" },
              { value: "0.99", label: "99th" },
              { value: "0.999", label: "99.9th" },
            ]}
          />
        </div>
        <div className="popover__row">
          <span className="popover__lbl">TIC normalize</span>
          <Checkbox checked={ticNorm} onChange={setTicNorm} ariaLabel="TIC norm" />
        </div>
        <div className="popover__row">
          <span className="popover__lbl">Smooth σ</span>
          <NumberField
            size="sm"
            type="number"
            width="64px"
            value={String(smoothSigma)}
            onChange={(v) => setSmoothSigma(Number(v) || 0)}
            ariaLabel="smooth sigma"
          />
        </div>
        <div className="popover__row">
          <span className="popover__lbl">Contrast</span>
          <Select
            size="sm"
            ariaLabel="contrast mode"
            value={histogramMode}
            onChange={(v) => setHistogramMode(v as HistogramMode)}
            options={[
              { value: "none", label: "None" },
              { value: "equalize", label: "Equalize" },
              { value: "clahe", label: "CLAHE" },
            ]}
          />
        </div>
      </div>

      <div className="settings-card__group">
        <div className="mz-overline">Caching</div>
        <div className="popover__row">
          <span className="popover__lbl">Preload spectra</span>
          <Checkbox
            checked={preloadEnabled}
            onChange={setPreloadEnabled}
            ariaLabel="preload spectra"
          />
        </div>
        <div className="popover__row">
          <span className="popover__lbl">Cache limit</span>
          <NumberField
            size="sm"
            type="number"
            width="92px"
            unit="MB"
            value={String(cacheLimitMB)}
            onChange={(v) => setCacheLimitMB(Number(v) || 0)}
            ariaLabel="cache limit MB"
          />
        </div>
        <p className="settings-card__hint">
          When on, the full spectra index is buffered in memory in the background
          after the overview loads (so pixel spectra and ion images are instant),
          and small optical images (&lt; 50 MB) are decoded ahead of time. Cache
          limit caps the spectra buffer — <strong>0 = automatic</strong> (scaled to
          your device's memory). A new limit applies to the next file load. Preset
          via URL: <code>?preload=0</code>, <code>?cache=512</code>.
        </p>
      </div>

      <p className="settings-card__hint">
        Settings are global and saved in your browser (localStorage).
      </p>
    </Panel>
  );
}
