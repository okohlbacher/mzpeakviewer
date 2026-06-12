import { useState } from "react";
import { useStore } from "../state/store";
import type { ImagingInfo } from "../reader/types";
import { fmtBytes } from "./format";
import { accessionIn, cvTitle, useCvTerms, type CvMap } from "./cvTerms";
import { StudySection } from "./StudySection";

/** An array-encoding pill that reveals its ontology term + definition on hover. */
function EncodingChip({ code, cv }: { code: string; cv: CvMap | null }) {
  const [hover, setHover] = useState(false);
  const term = cv?.[accessionIn(code) ?? ""] ?? null;
  return (
    <span
      className="chip"
      style={{ position: "relative", cursor: term ? "help" : "default" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {code}
      {hover && term && (
        <span className="cv-pop" role="tooltip">
          <span className="cv-pop-name">{code} · {term.n}</span>
          {term.d && <span className="cv-pop-def">{term.d}</span>}
        </span>
      )}
    </span>
  );
}

// Friendly names for the common IMS scan-geometry CURIEs; falls back to the CURIE.
const IMS_TERMS: Record<string, string> = {
  "IMS:1000401": "top down",
  "IMS:1000402": "bottom up",
  "IMS:1000403": "left right",
  "IMS:1000404": "right left",
  "IMS:1000411": "meandering",
  "IMS:1000412": "random access",
  "IMS:1000413": "flyback",
  "IMS:1000480": "horizontal line scan",
  "IMS:1000481": "vertical line scan",
  "IMS:1000490": "linescan right left",
  "IMS:1000491": "linescan left right",
};
function imsTerm(curie: string | null): string {
  if (!curie) return "—";
  const name = IMS_TERMS[curie];
  return name ? `${name} (${curie})` : curie;
}

function fmtRange(r: [number, number] | null, digits = 2): string {
  if (!r) return "—";
  return `${r[0].toFixed(digits)} – ${r[1].toFixed(digits)}`;
}

function Card({
  k,
  children,
  accent,
}: {
  k: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={accent ? "stat-card accent" : "stat-card"}>
      <div className="k">{k}</div>
      <div className="v">{children}</div>
    </div>
  );
}

function ImagingSection({ img }: { img: ImagingInfo }) {
  const cv = useCvTerms();
  const grid = img.pixelCount
    ? `${img.pixelCount.x} × ${img.pixelCount.y}` +
      (img.pixelCount.z ? ` × ${img.pixelCount.z}` : "") +
      (img.pixelCountSource ? ` (${img.pixelCountSource})` : "")
    : "—";
  const pxSize = img.pixelSizeUm
    ? `${img.pixelSizeUm.x} × ${img.pixelSizeUm.y} µm`
    : "—";
  const dim = img.maxDimensionUm
    ? `${img.maxDimensionUm.x} × ${img.maxDimensionUm.y} µm`
    : "—";
  const anyScan =
    img.scanType || img.scanPattern || img.lineScanDirection || img.linescanSequence;

  return (
    <>
      <h3 className="section">Imaging</h3>
      <table className="data" style={{ maxWidth: 560 }}>
        <tbody>
          <tr>
            <th style={{ width: 200 }}>Pixel grid</th>
            <td>{grid}</td>
          </tr>
          <tr>
            <th>Pixel size</th>
            <td>{pxSize}</td>
          </tr>
          {img.maxDimensionUm && (
            <tr>
              <th>Max physical size</th>
              <td>{dim}</td>
            </tr>
          )}
          {img.mzRange && (
            <tr>
              <th>m/z range (MS1)</th>
              <td>
                {img.mzRange[0].toFixed(2)} – {img.mzRange[1].toFixed(2)} Th
              </td>
            </tr>
          )}
          <tr>
            <th>Coordinate base</th>
            <td>{img.coordinateBase ?? "—"}</td>
          </tr>
          {anyScan && (
            <>
              {img.scanType && (
                <tr>
                  <th>Scan type</th>
                  <td className="mono" title={cvTitle(cv, img.scanType)}>{imsTerm(img.scanType)}</td>
                </tr>
              )}
              {img.scanPattern && (
                <tr>
                  <th>Scan pattern</th>
                  <td className="mono" title={cvTitle(cv, img.scanPattern)}>{imsTerm(img.scanPattern)}</td>
                </tr>
              )}
              {img.lineScanDirection && (
                <tr>
                  <th>Line-scan direction</th>
                  <td className="mono" title={cvTitle(cv, img.lineScanDirection)}>{imsTerm(img.lineScanDirection)}</td>
                </tr>
              )}
              {img.linescanSequence && (
                <tr>
                  <th>Line-scan sequence</th>
                  <td className="mono" title={cvTitle(cv, img.linescanSequence)}>{imsTerm(img.linescanSequence)}</td>
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>

      <h3 className="section">
        Optical images{" "}
        <span className="hint" style={{ fontWeight: 400 }}>
          ({img.images.length})
        </span>
      </h3>
      {img.images.length === 0 ? (
        <p className="hint">No optical images embedded in this archive.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Source</th>
              <th>Archive path</th>
              <th>Dimensions</th>
              <th>Type</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {img.images.map((im) => (
              <tr key={im.archivePath}>
                <td>{im.sourceName ?? "—"}</td>
                <td className="mono">{im.archivePath}</td>
                <td>
                  {im.width != null && im.height != null
                    ? `${im.width} × ${im.height} px`
                    : "—"}
                </td>
                <td className="mono">{im.mediaType ?? "—"}</td>
                <td>{fmtBytes(im.sizeBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function SummaryTab() {
  const s = useStore((st) => st.summary);
  const manifest = useStore((st) => st.manifest);
  const scanning = useStore((st) => st.scanning);
  const scanned = useStore((st) => st.scanned);
  const scanProgress = useStore((st) => st.scanProgress);
  const computeBreakdown = useStore((st) => st.computeBreakdown);
  const cv = useCvTerms();
  if (!s) return null;

  const pct =
    scanProgress != null ? `${Math.round(scanProgress * 100)}%` : "…";
  const pending = scanning ? `scanning ${pct}` : "—";

  const reps = s.representationCounts;
  const repStr = [
    reps.profile ? `${reps.profile} profile` : null,
    reps.centroid ? `${reps.centroid} centroid` : null,
    reps.unknown ? `${reps.unknown} unknown` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const msLevels = Object.keys(s.msLevelCounts)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className="view-narrow">
      <div className="summary-grid">
        <Card k="File">
          <span style={{ fontSize: "0.95rem", wordBreak: "break-all" }}>
            {s.fileName}
          </span>
          <div style={{ fontSize: "0.8rem", fontWeight: 400, color: "var(--text-muted)" }}>
            {fmtBytes(s.fileSize)}
          </div>
        </Card>
        <Card k="Spectra" accent>
          {s.numSpectra.toLocaleString()}
        </Card>
        <Card k="Chromatograms">
          {s.numChromatograms.toLocaleString()}
        </Card>
        <Card k="Entities">
          {s.numEntities}
        </Card>
        <Card k="m/z range">
          {s.mzRange ? (
            <>
              {fmtRange(s.mzRange, 2)} <small>Th</small>
            </>
          ) : (
            <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "var(--text-muted)" }}>
              {pending}
            </span>
          )}
        </Card>
        <Card k="RT range">
          {s.rtRange ? (
            <>
              {fmtRange(s.rtRange, 1)} <small>s</small>
            </>
          ) : (
            <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "var(--text-muted)" }}>
              {pending}
            </span>
          )}
        </Card>
        <Card k="Storage layout">
          <span style={{ textTransform: "capitalize" }}>{s.layout}</span>
        </Card>
        <Card k="Imaging">
          {s.isImaging ? "Yes" : "No"}
        </Card>
        {s.instrument && (
          <Card k="Instrument">
            <span style={{ fontSize: "var(--text-body)" }}>{s.instrument}</span>
          </Card>
        )}
      </div>

      {s.imaging && <ImagingSection img={s.imaging} />}

      <StudySection />

      {!scanned && (
        <div
          style={{
            margin: "1rem 0",
            padding: "0.6rem 0.8rem",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            background: "var(--surface-panel)",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          {scanning ? (
            <span className="hint">
              Scanning {s.numSpectra.toLocaleString()} spectra… {pct}
            </span>
          ) : (
            <>
              <button onClick={() => void computeBreakdown()}>
                Compute breakdown
              </button>
              <span className="hint">
                MS-level / representation / m·z &amp; RT ranges require one pass
                over all {s.numSpectra.toLocaleString()} spectra (metadata only).
              </span>
            </>
          )}
        </div>
      )}

      <div className="summary-cols">
        <div>
      <h3 className="section">MS levels</h3>
      {msLevels.length === 0 ? (
        <p className="hint">
          {scanning ? `scanning ${pct}` : scanned ? "No MS-level information." : "—"}
        </p>
      ) : (
        <table className="data" style={{ maxWidth: 340 }}>
          <thead>
            <tr>
              <th>MS level</th>
              <th>Spectra</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {msLevels.map((lvl) => {
              const c = s.msLevelCounts[lvl];
              const pct = s.numSpectra ? (100 * c) / s.numSpectra : 0;
              return (
                <tr key={lvl}>
                  <td>MS{lvl}</td>
                  <td>{c.toLocaleString()}</td>
                  <td>{pct.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h3 className="section">Spectrum representation</h3>
      <p className="hint">{repStr || pending}</p>
        </div>
        <div>
      <h3 className="section">Array encodings</h3>
      {s.encodings.length === 0 ? (
        <p className="hint">No array-encoding information.</p>
      ) : (
        <div className="chips">
          {s.encodings.map((e) => (
            <EncodingChip key={e} code={e} cv={cv} />
          ))}
        </div>
      )}

      <h3 className="section">Entities ({manifest.length})</h3>
      <ManifestTable manifest={manifest} />
        </div>
      </div>
    </div>
  );
}

function ManifestTable({
  manifest,
}: {
  manifest: { name: string; entityType: string; dataKind: string }[];
}) {
  if (manifest.length === 0) return <p className="hint">No manifest entries.</p>;
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Name</th>
          <th>Entity</th>
          <th>Kind</th>
        </tr>
      </thead>
      <tbody>
        {manifest.map((e, i) => (
          <tr key={`${i}:${e.name}`}>
            <td className="mono">{e.name}</td>
            <td>{e.entityType || "—"}</td>
            <td>{e.dataKind || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
