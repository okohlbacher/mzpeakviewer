/* wf-screens-2.js — Spectra, Imaging, Structure. Uses globals from wf-screens-1.js */

/* spectrum plot SVG — profile (line) or centroid (sticks) */
function spectrumSVG(kind, opts) {
  opts = opts || {};
  const W = 1000, H = 300, pad = 26;
  const peaks = opts.peaks || [
    [90, 0.32], [150, 0.18], [absRand(210), 0.55], [absRand(265), 0.22], [absRand(330), 0.84],
    [absRand(395), 0.30], [absRand(470), 1.0], [absRand(540), 0.41], [absRand(620), 0.62],
    [absRand(700), 0.28], [absRand(790), 0.48], [absRand(880), 0.16], [absRand(950), 0.24],
  ];
  function absRand(x) { return x; }
  const x = mz => pad + ((mz - 80) / (1000 - 80)) * (W - pad * 2);
  const y = v => H - pad - v * (H - pad * 2);
  let body = "";
  if (kind === "centroid") {
    body = peaks.map(([m, v]) => `<line x1="${x(m).toFixed(1)}" y1="${(H - pad).toFixed(1)}" x2="${x(m).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--blue-600)" stroke-width="1.4"/>`).join("");
    // reporter cluster dots
    if (opts.reporters) {
      body += opts.reporters.map((r, i) => `<circle cx="${x(126 + i * 2).toFixed(1)}" cy="${y(r).toFixed(1)}" r="3" fill="${CHCOL[i % CHCOL.length]}"/>`).join("");
    }
  } else {
    let dpath = `M ${pad} ${H - pad}`;
    peaks.forEach(([m, v]) => {
      const cx = x(m);
      dpath += ` L ${(cx - 8).toFixed(1)} ${(H - pad).toFixed(1)} Q ${cx.toFixed(1)} ${y(v).toFixed(1)} ${(cx + 8).toFixed(1)} ${(H - pad).toFixed(1)}`;
    });
    dpath += ` L ${W - pad} ${H - pad}`;
    body = `<path d="${dpath}" fill="var(--spectrum-fill)" stroke="var(--blue-600)" stroke-width="1.3"/>`;
  }
  const grid = [0.25, 0.5, 0.75, 1].map(g => `<line x1="${pad}" y1="${y(g).toFixed(1)}" x2="${W - pad}" y2="${y(g).toFixed(1)}" stroke="var(--gray-100)"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${grid}
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--gray-300)"/>
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="var(--gray-300)"/>
    ${opts.band ? `<rect x="${x(opts.band[0])}" y="${pad}" width="${x(opts.band[1]) - x(opts.band[0])}" height="${H - pad * 2}" fill="var(--warning-band)"/>` : ""}
    ${body}
  </svg>`;
}
const CHCOL = ["#3b54da", "#c00000", "#2e9e5b", "#b026d3", "#e8820c", "#0e9bb5", "#d6336c", "#5f6caf", "#7cb518", "#e0a800"];

/* ════════════════════════════════════════════════════════════════════════
   SCREEN 4 — SPECTRA
   ════════════════════════════════════════════════════════════════════════ */
WF_SCREENS.spectra = function (state) {
  const empty = state === "empty";
  const tmt = state === "tmt";
  const imaging = false;
  let picker, plot, extras = "";

  if (empty) {
    picker = `<div class="m-empty" style="padding:60px"><div style="font-size:13px">This file contains mass spectra but no spectra are loaded yet.</div><div class="hint">Open a file to browse spectra.</div></div>`;
    plot = "";
  } else {
    picker = `
      <div class="row center wrap gap8" data-pinhost>
        <div class="m-field"><span class="m-label">MS level</span><div class="m-segc"><span class="${tmt ? "" : "on"}">All</span><span>MS1</span><span class="${tmt ? "on" : ""}">MS2</span></div></div>
        <div class="m-field"><span class="m-label">Spectrum</span>
          <div class="row center gap6">
            <span class="m-btn sm">‹ Prev</span>
            <div class="m-select" style="min-width:230px">${tmt ? "MS2 #842 · scan=4821 (HCD)" : "#317 · scan=318 (FTMS, +)"}</div>
            <span class="m-btn sm">Next ›</span>
          </div>
        </div>
        <div class="grow"></div>
        <div class="m-field" style="text-align:right">
          <span class="m-label">&nbsp;</span>
          <div class="row gap6 center" style="justify-content:flex-end">
            <span class="m-badge info mono">${tmt ? "centroid" : "profile"}</span>
            <span class="hint mono">${tmt ? "abs #842 · MS2 · #421/1700 in level · 1,204 pts" : "abs #317 · MS1 · #318/1684 in level · 28,402 pts"}</span>
          </div>
        </div>
      </div>`;
    plot = `
      <div data-pinhost class="mt12">
        <div class="row" style="align-items:stretch;gap:0">
          <div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:10px;color:var(--wf-muted);padding:0 4px;display:grid;place-items:center">intensity</div>
          <div class="m-plot grow" style="height:300px">${spectrumSVG(tmt ? "centroid" : "profile", tmt ? { reporters: [0.9, 0.6, 0.78, 0.4, 0.55, 0.3, 0.66, 0.2, 0.7, 0.5] } : {})}
            <div class="axlabel" style="left:8px;top:6px">${tmt ? "1.4e6" : "9.2e5"}</div>
            <div class="axlabel" style="left:8px;bottom:18px">0</div>
          </div>
        </div>
        <div class="row" style="justify-content:space-between;margin-top:2px;padding-left:18px">
          <span class="axlabel mono" style="position:static">80</span>
          <span class="hint">m/z (Th) — scroll to zoom · double-click to reset</span>
          <span class="axlabel mono" style="position:static">1000</span>
        </div>
      </div>`;
    if (tmt) {
      extras = `
      <div data-pinhost class="mt12">
        <div class="eyebrow" style="margin-bottom:6px">Reporter ions — 9/10 channels detected (±5 mDa) · relative to strongest · click to zoom</div>
        <div class="m-channels">
          ${["126 · ctrl", "127N · ctrl", "127C · drug", "128N · drug", "128C · drug", "129N · t2", "129C · t2", "130N · t6", "130C · t6", "131 · pool"].map((lab, i) => {
            const det = i !== 7;
            return `<span class="m-chpill" style="border-left-color:${CHCOL[i % CHCOL.length]};${det ? "" : "opacity:.45"}">
              <span class="d" style="background:${CHCOL[i % CHCOL.length]}"></span><b>${lab.split(" · ")[0]}</b><span class="mono">${det ? (90 - i * 7) + "%" : "—"}</span></span>`;
          }).join("")}
        </div>
      </div>`;
    } else {
      extras = `<div data-pinhost class="hint mt12" style="display:flex;gap:8px;align-items:center;padding:8px 12px;background:var(--gray-25);border:1px solid var(--wf-line);border-radius:var(--radius-md)">
        <span style="font-size:13px;color:var(--blue-600)">↻</span>
        Picking a pixel in the <b>Imaging</b> view fills this same plot — the selected spectrum is shared across both views.</div>`;
    }
  }

  return `
  <div class="m-win">
    ${shellTopbar(imaging)}
    <div class="m-shell">
      ${shellSidebar("spectra", { imaging, goto: { summary: "summary:lcms", structure: "structure:list" } })}
      <div class="m-view mz-scroll">
        <div class="m-vh"><h3>Spectra</h3><p>m/z vs intensity for the selected spectrum</p></div>
        ${picker}${plot}${extras}
      </div>
    </div>
  </div>`;
};

/* ════════════════════════════════════════════════════════════════════════
   SCREEN 5 — IMAGING (the round-trip)
   ════════════════════════════════════════════════════════════════════════ */
WF_SCREENS.imaging = function (state) {
  const empty = state === "empty";
  const rendering = state === "rendering";
  const picked = state === "picked";
  const ready = state === "ready" || picked;

  // stepper
  const step = (n, label, cls) => `<div class="st ${cls}"><span class="n">${cls === "done" ? "✓" : n}</span>${label}</div>`;
  let s1 = "", s2 = "", s3 = "", s4 = "";
  if (empty) { s1 = "active"; }
  else if (rendering) { s1 = "done"; s2 = "active"; }
  else if (ready && !picked) { s1 = "done"; s2 = "done"; s3 = "active"; }
  else if (picked) { s1 = "done"; s2 = "done"; s3 = "done"; s4 = "active"; }
  const stepper = `<div class="m-stepper" data-pinhost>
    ${step(1, "Pick m/z + tolerance", s1)}${step(2, "Render ion image", s2)}${step(3, "Click a pixel", s3)}${step(4, "Read its spectrum", s4)}</div>`;

  // control card
  const ctrlCard = `
    <div data-pinhost class="row end wrap gap12" style="padding:11px 13px;border:1px solid var(--wf-line);border-radius:var(--radius-md);background:var(--gray-25)">
      <div class="m-field"><span class="m-label">m/z</span><div class="m-input" style="width:120px">${empty ? '<span style="color:var(--wf-faint)">e.g. 798.54</span>' : "741.53"}<span class="unit">Th</span></div></div>
      <div class="m-field"><span class="m-label">± tolerance</span><div class="m-input" style="width:96px">0.50<span class="unit">Da</span></div></div>
      <span class="m-btn primary">${rendering ? "Rendering…" : "Render"}</span>
      <div class="grow"></div>
      <div class="m-field"><span class="m-label">Colormap</span><div class="m-select" style="width:108px">Viridis</div></div>
      <div class="m-field"><span class="m-label">Scale</span><div class="m-segc"><span class="on">linear</span><span>log</span></div></div>
      <div class="m-field"><span class="m-label">Clip</span><div class="m-select" style="width:92px">99th pct</div></div>
      ${ready ? `<div class="row gap6"><span class="m-btn sm">−</span><span class="m-btn sm mono">100%</span><span class="m-btn sm">+</span></div>` : ""}
    </div>`;

  // warm badge
  const warm = (ready && !rendering) ? `<span class="m-badge ok" style="margin-left:8px"><span class="bd"></span>Ion image ready · prefetched</span>` : (rendering ? "" : `<span class="m-badge info" style="margin-left:8px"><span class="bd"></span>warming common m/z…</span>`);

  // stage content
  let stage;
  if (empty) {
    stage = `<div class="m-stage" style="flex:1"><div class="m-empty">
      <div style="font-size:26px;opacity:.5">◎</div>
      <div style="font-size:13px;color:#c5ccd3">Enter an m/z and tolerance, then <b style="color:#fff">Render</b> to see the ion image.</div>
      <div class="hint" style="color:#6b757e">A background prefetch is warming the most common m/z windows so the first render is instant.</div>
    </div></div>`;
  } else if (rendering) {
    stage = `<div class="m-stage" style="flex:1"><div class="m-empty">
      <span class="spinner big" aria-hidden></span>
      <div class="m-prog" style="margin-top:6px"><div class="track"><div class="fill" style="width:62%"></div></div><span class="pct" style="color:#9aa4ad">62%</span></div>
      <div class="hint mono" style="color:#6b757e">Rendering ion image… 21,640 / 34,840 pixels</div>
    </div></div>`;
  } else {
    const crosshairX = picked ? 51 : 50, crosshairY = picked ? 42 : 50;
    stage = `<div class="m-stage" style="flex:1;position:relative">
      <div class="m-ion" style="width:330px;height:170px;position:relative;background:
        radial-gradient(ellipse 30% 50% at 38% 40%, #fde725, #7ad151 18%, #22a884 38%, #2a788e 58%, #414487 78%, #1a1a1a 92%),
        radial-gradient(ellipse 22% 30% at 70% 64%, #22a884, #2a788e 50%, transparent 75%)">
        ${picked ? `<div style="position:absolute;left:${crosshairX}%;top:${crosshairY}%;width:13px;height:13px;border:2px solid #fff;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 2px rgba(0,0,0,.6)"></div>` : ""}
      </div>
      <div class="m-overlay" style="left:24px;top:24px">${picked ? "x: 168, y: 57 · intensity: 8.4e5" : "hover a pixel to read x · y · intensity"}</div>
      <div class="m-overlay" style="right:24px;bottom:24px;display:flex;align-items:center;gap:6px"><span style="width:30px;height:3px;background:#fff;display:inline-block"></span>50 µm</div>
      ${picked ? `<div class="m-overlay" style="left:${crosshairX}%;top:calc(${crosshairY}% + 16px);transform:translateX(-50%);border-color:var(--blue-400)">pixel #19,812 picked ↓</div>` : ""}
    </div>`;
  }

  const legend = ready ? `
    <div class="m-legend" data-pinhost style="padding:14px 4px">
      <span style="color:#9aa4ad" class="mono">max 1.2e6</span>
      <div class="bar"></div>
      <span style="color:#9aa4ad" class="mono">0</span>
      <div style="margin-top:6px;text-align:center;color:var(--wf-faint);font-size:9.5px" class="mono">19,812 px<br>signal</div>
    </div>` : "";

  // dock
  let dock = "";
  if (picked) {
    dock = `<div class="m-spdock" data-pinhost>
      <div class="dh"><b>Spectrum</b><span class="meta">pixel (x: 168, y: 57) · #19,812 · 982 pts · centroid</span><span class="grow"></span><span class="m-btn sm ghost">Collapse</span></div>
      <div class="m-plot" style="height:172px;border:none;border-radius:0">${spectrumSVG("centroid", {})}</div>
    </div>`;
  } else if (ready) {
    dock = `<div class="m-spdock" data-pinhost style="opacity:.85">
      <div class="dh"><b>Spectrum</b><span class="meta" style="color:var(--blue-600)">↑ click any pixel above to load its spectrum here — without leaving this view</span></div>
      <div class="m-empty" style="padding:18px;min-height:0">No pixel selected yet.</div>
    </div>`;
  }

  return `
  <div class="m-win">
    ${shellTopbar(true)}
    <div class="m-shell">
      ${shellSidebar("ion", { imaging: true, goto: { summary: "summary:imaging", spectra: "spectra:profile", structure: "structure:list" } })}
      <div class="m-view mz-scroll" style="display:flex;flex-direction:column;gap:11px">
        <div class="m-vh" style="margin:0"><h3>Ion image ${warm}</h3><p>Spatial map for an m/z window — click a pixel to inspect its spectrum</p></div>
        ${stepper}
        ${ctrlCard}
        <div class="row" style="gap:11px;flex:1;min-height:300px">
          ${stage}${legend}
        </div>
        ${dock}
      </div>
    </div>
  </div>`;
};

/* ════════════════════════════════════════════════════════════════════════
   SCREEN 6 — STRUCTURE (parquet inspector)
   ════════════════════════════════════════════════════════════════════════ */
WF_SCREENS.structure = function (state) {
  const list = state === "list";
  const colOpen = state === "column";
  const members = [
    { p: "mzpeak_index.json", sz: "4.1 KB", manifest: true },
    { p: "spectra/ms_data.parquet", sz: "248.6 MB", on: !list },
    { p: "spectra/spectrum_index.parquet", sz: "1.2 MB" },
    { p: "imaging/coordinates.parquet", sz: "612 KB" },
    { p: "optical/overview.ome.tiff", sz: "8.4 MB" },
    { p: "metadata/run.json", sz: "11 KB" },
  ];
  const cols = [
    ["mz", "DOUBLE", "ZSTD", "34,840", "96.2 MB", 71],
    ["intensity", "FLOAT", "ZSTD", "34,840", "31.8 MB", 23],
    ["scan_index", "INT32", "RLE_DICT", "34,840", "2.1 MB", 2],
    ["IMS_position_x", "INT32", "RLE_DICT", "34,840", "1.6 MB", 1],
    ["IMS_position_y", "INT32", "RLE_DICT", "34,840", "1.6 MB", 1],
  ];

  const memberHtml = members.map(m => `
    <div class="mi ${m.manifest ? "manifest" : ""} ${m.on ? "on" : ""}" data-pinhost="${m.manifest ? "manifest" : ""}" ${m.manifest ? 'data-goto="structure:footer"' : (m.p.endsWith(".parquet") ? `data-goto="structure:${colOpen ? "column" : "footer"}"` : "")}>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px">${m.manifest ? '<span class="m-tag-ml">manifest</span>' : ""}${m.p}</span>
      <span class="sz">${m.manifest ? '<span style="color:var(--blue-600)">View JSON →</span> ' : ""}${m.sz}</span>
    </div>`).join("");

  let right;
  if (list) {
    right = `<div class="m-empty" style="min-height:300px;border:1px dashed var(--wf-line);border-radius:var(--radius-md)">
      <div style="font-size:22px;opacity:.4">▦</div>
      <div style="font-size:13px">Select a parquet member to inspect its arrays.</div>
      <div class="hint">Each column is one stored data array — m/z, intensity, scan index, IMS coordinates.</div>
    </div>`;
  } else {
    right = `
      <h4 style="font-size:13px;margin:0 0 2px" class="mono">spectra/ms_data.parquet</h4>
      <p class="hint" style="margin:0 0 10px"><b class="mono">34,840</b> rows · <b class="mono">5</b> columns · <b class="mono">3</b> row groups · 131.3 MB compressed / 412.0 MB raw (3.1×) · <span class="mono">mzpeakts 0.9</span></p>
      <table class="m-coltab">
        <thead><tr><th>column</th><th>type</th><th>codec</th><th class="num">values</th><th class="num">size</th><th>share</th></tr></thead>
        <tbody>
          ${cols.map((c, i) => {
            const isOpen = colOpen && i === 0;
            return `<tr class="${isOpen ? "on" : ""}" data-pinhost="${i === 0 ? "col" : ""}" ${i === 0 ? `data-goto="structure:${colOpen ? "footer" : "column"}"` : ""}>
              <td class="name">${colOpen && i === 0 ? "▾" : "▸"} ${c[0]}</td><td>${c[1]}</td><td>${c[2]}</td>
              <td class="num">${c[3]}</td><td class="num">${c[4]}</td>
              <td><span class="m-sharebar"><i style="width:${c[5]}%"></i></span> <span class="mono" style="font-size:10px">${c[5]}%</span></td>
            </tr>
            ${isOpen ? `<tr><td colspan="6" style="padding:0">
              <div data-pinhost style="background:var(--gray-50);border-radius:6px;margin:4px 0 8px;padding:11px 13px">
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px 16px;font-size:11px">
                  ${[["Physical", "DOUBLE"], ["Logical", "—"], ["Encodings", "PLAIN, DICT"], ["Dictionary", "no"], ["Min", "86.0102"], ["Max", "1004.55"], ["Nulls", "0"], ["Distinct", "2.1 M"]].map(s => `<div><div class="eyebrow" style="font-size:9px">${s[0]}</div><div class="mono" style="color:var(--wf-ink)">${s[1]}</div></div>`).join("")}
                </div>
                <div class="mt12">
                  <div class="row center" style="justify-content:space-between;margin-bottom:5px"><span class="eyebrow" style="font-size:9px">Sample value distribution · 50k rows</span><span class="hint mono" style="font-size:10px">mean 512.4 · median 498.1 · σ 214.7</span></div>
                  <div class="m-hist">${Array.from({ length: 40 }, (_, k) => `<i style="height:${Math.max(6, Math.round(60 * Math.exp(-Math.pow((k - 14) / 9, 2)) + (k > 26 ? 18 * Math.exp(-Math.pow((k - 32) / 5, 2)) : 0)))}%"></i>`).join("")}</div>
                  <div class="row" style="justify-content:space-between"><span class="hint mono" style="font-size:9px">86.0</span><span class="hint mono" style="font-size:9px">1004.6</span></div>
                </div>
              </div></td></tr>` : ""}`;
          }).join("")}
        </tbody>
      </table>`;
  }

  return `
  <div class="m-win">
    ${shellTopbar(true)}
    <div class="m-shell">
      ${shellSidebar("structure", { imaging: true, goto: { summary: "summary:imaging", spectra: "spectra:profile", overview: "imaging:empty", ion: "imaging:empty" } })}
      <div class="m-view mz-scroll">
        <div class="m-vh"><h3>Structure</h3><p>Parquet members and column footers — the raw shape of the archive</p></div>
        <div class="row gap6" data-pinhost style="margin-bottom:12px"><span class="m-segc"><span>Metadata</span><span class="on">Structure</span></span></div>
        <div class="row" style="gap:18px;align-items:flex-start">
          <div style="width:300px;flex-shrink:0">
            <div class="eyebrow" style="margin-bottom:6px">Archive members</div>
            <div data-pinhost>${memberHtml}</div>
          </div>
          <div class="grow">${right}</div>
        </div>
      </div>
    </div>
  </div>`;
};
