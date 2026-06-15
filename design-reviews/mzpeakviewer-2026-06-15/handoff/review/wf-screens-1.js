/* wf-screens-1.js — Start, Shell, Summary mock builders. Global: WF_SCREENS */
window.WF_SCREENS = window.WF_SCREENS || {};

/* tiny inline icon helper */
function ic(d) {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}
const ICONS = {
  summary: "M4 5h16M4 10h16M4 15h10",
  spectra: "M3 18 7 6l3 12 3-16 3 16 2-8h2",
  chrom: "M3 17c3 0 3-8 6-8s3 6 6 6 3-4 6-4",
  metadata: "M4 5h16v6H4zM4 15h10",
  structure: "M4 6h16M4 12h16M4 18h16M9 4v16",
  overview: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  ion: "M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  multi: "M5 7h4v10H5zM10 7h4v10h-4zM15 7h4v10h-4z",
  optical: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6",
  grid: "M4 4h16v16H4zM10 4v16M16 4v16M4 10h16M4 16h16",
};

/* ════════════════════════════════════════════════════════════════════════
   SCREEN 1 — START / FILE-OPEN
   ════════════════════════════════════════════════════════════════════════ */
WF_SCREENS.start = function (state) {
  const over = state === "over";
  const loading = state === "loading";
  const error = state === "error";

  let center;
  if (loading) {
    center = `
      <div class="m-drop" style="padding:38px 30px">
        <div class="row center" style="justify-content:center;gap:10px">
          <span class="spinner" aria-hidden></span>
          <div style="text-align:left">
            <div class="ttl" style="margin:0">Opening HR2MSI-mouse-urinary-bladder.mzpeak…</div>
            <div class="hint mono" style="margin-top:4px">streaming · reading parquet footers · probing capabilities</div>
          </div>
        </div>
        <div class="m-prog" style="justify-content:center;margin-top:16px">
          <div class="track" style="max-width:300px"><div class="fill" style="width:46%"></div></div>
          <span class="pct">142 / 310 MB</span>
          <span class="m-btn sm hot" data-goto="start:over" data-pinhost>✕ Cancel</span>
        </div>
      </div>`;
  } else {
    center = `
      <div class="m-drop ${over ? "over" : ""}" data-pinhost data-goto="${over ? "summary:imaging" : "start:over"}">
        ${ic("M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2")}
        <div class="ttl">${over ? "Release to open this file" : "Drop a <code>.mzpeak</code> file here, or click to browse"}</div>
        <div class="hint" style="margin-top:5px">${over ? "1 file · HR2MSI-mouse-urinary-bladder.mzpeak" : "Local files never leave your browser — nothing is uploaded"}</div>
      </div>`;
  }

  const demos = [
    { nm: "General MS — Bruker QTOF", kd: "var(--success)", ds: "micrOTOF-Q II ESI-QTOF run (MTBLS520)", chips: ["~38 MB", "micrOTOF-Q II", "MTBLS520"], hi: false, rt: "" },
    { nm: "Imaging MSI — Mouse Bladder", kd: "var(--blue-600)", ds: "AP-SMALDI: ion images, optical overlay, per-pixel spectra", chips: ["~310 MB", "260 × 134 px", "optical"], hi: true, rt: "Round-trip demo: m/z → ion image → pixel → spectrum" },
    { nm: "TMT 10-plex — SDRF", kd: "var(--red-600)", ds: "PXD011799 TiO₂ TMT fraction; SDRF channel model", chips: ["~90 MB", "TMT 10-plex", "SDRF"], hi: false, rt: "" },
  ];
  const demoHtml = demos.map(d => `
    <div class="m-demo ${d.hi ? "hi" : ""}" ${d.hi ? 'data-pinhost' : ''}>
      <div class="nm"><span class="kd" style="background:${d.kd}"></span>${d.nm}</div>
      <div class="ds">${d.ds}</div>
      <div class="chips">${d.chips.map(c => `<span class="c">${c}</span>`).join("")}</div>
      ${d.rt ? `<div class="hint" style="color:var(--blue-600);display:flex;align-items:center;gap:5px"><span style="font-size:13px">↻</span>${d.rt}</div>` : ""}
      <div class="acts">
        <span class="m-btn primary sm hot" ${d.hi ? 'data-goto="summary:imaging"' : ""}>${d.hi ? "Open imaging demo" : "☁ Open from cloud"}</span>
        <span class="m-btn sm" style="justify-content:center">⤓ Download &amp; open</span>
      </div>
    </div>`).join("");

  return `
  <div class="m-win">
    <div style="max-width:760px;margin:0 auto;padding:46px 28px 40px;text-align:center">
      <div class="row center" style="justify-content:center;gap:18px;max-width:440px;margin:0 auto 18px" data-pinhost>
        <div style="font-weight:800;letter-spacing:-0.03em;font-size:22px;color:var(--gray-900)">Open<span style="color:var(--blue-600)">MS</span></div>
        <div style="width:1px;height:34px;background:var(--wf-line)"></div>
        <div style="font-weight:800;letter-spacing:-0.03em;font-size:22px;color:var(--gray-900)">mzPeak</div>
      </div>
      <h1 style="font-size:21px;margin:0 0 7px;color:var(--gray-900);font-weight:600" data-pinhost>Explore mass spectrometry data online</h1>
      <p class="muted" style="font-size:13px;max-width:540px;margin:0 auto 22px;line-height:1.5">
        An interactive viewer for the <b style="color:var(--blue-600)">mzPeak</b> format — imaging (MSI) and LC-MS alike.
        Pick an <em>m/z</em>, get an ion image, click a pixel, see its spectrum. Everything runs in your browser.
      </p>
      ${center}
      ${error ? `<div class="m-errbar" data-pinhost style="margin-top:14px;text-align:left;display:flex;gap:9px;align-items:flex-start;padding:10px 13px;background:var(--red-50);border:1px solid var(--red-200);border-radius:var(--radius-md);color:var(--red-600);font-size:12px">
        <span style="font-size:14px;line-height:1">⚠</span>
        <div><b>Couldn’t open “sample.mzML”.</b> Please choose a <code class="mono">.mzpeak</code> file — an uncompressed ZIP of Parquet + <span class="mono">mzpeak_index.json</span>. <a href="#" style="color:var(--red-600);text-decoration:underline">See accepted formats ↗</a></div>
      </div>` : ""}
      <div class="row center" style="justify-content:space-between;margin:26px 0 9px">
        <span class="eyebrow">Or try an example dataset</span>
        <span class="hint" style="color:var(--blue-600)">more at mzpeak.org/examples ↗</span>
      </div>
      <div data-pinhost>${demoHtml}</div>
      <div class="row" style="margin-top:16px" data-pinhost>
        <div class="m-input ph grow" style="flex:1">…or paste a https:// .mzpeak URL</div>
        <span class="m-btn primary">Load URL</span>
      </div>
    </div>
  </div>`;
};

/* ════════════════════════════════════════════════════════════════════════
   Shared shell chrome (topbar + sidebar) used by screens 2–6
   ════════════════════════════════════════════════════════════════════════ */
function shellTopbar(activeCaps) {
  const caps = activeCaps
    ? `<div class="m-capbar">
         <span class="m-badge ok"><span class="bd"></span>Imaging</span>
         <span class="m-badge info"><span class="bd"></span>2 optical</span>
         <span class="m-badge neutral"><span class="bd"></span>TIC</span>
       </div>`
    : `<div class="m-capbar"><span class="m-badge neutral"><span class="bd"></span>LC-MS</span><span class="m-badge neutral"><span class="bd"></span>4 chrom</span></div>`;
  return `
    <div class="m-topbar">
      <span class="m-logo">mzPeak<small>Viewer</small></span>
      <span class="m-fname">${activeCaps ? "HR2MSI-mouse-urinary-bladder.mzpeak" : "bruker-microTOF-Q-II.mzpeak"}</span>
      ${caps}
      <span class="grow"></span>
      <span class="m-btn sm">${ic("M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M16 6l-4-4-4 4M12 2v13")}Share view</span>
      <span class="m-btn sm">Open file…</span>
    </div>`;
}

function shellSidebar(active, opts) {
  opts = opts || {};
  const imaging = opts.imaging !== false;
  const advOpen = opts.advOpen !== false;
  const tab = (id, label, on, depth, stepNo) => `
    <div class="m-tab ${on ? "on" : ""}" ${depth ? 'style="padding-left:30px"' : ""} data-goto="${opts.goto && opts.goto[id] ? opts.goto[id] : ""}">
      ${ic(ICONS[id] || ICONS.summary)}<span>${label}</span>${stepNo ? `<span class="step-no">${stepNo}</span>` : ""}
    </div>`;
  return `
    <div class="m-side">
      ${tab("summary", "Summary", active === "summary")}
      ${tab("spectra", "Spectra", active === "spectra")}
      ${imaging ? "" : tab("chrom", "Chromatograms", active === "chrom")}
      ${imaging ? tab("chrom", "Chromatograms", false) : ""}
      <div class="m-acc ${advOpen ? "" : "collapsed"}"><span class="cv">▾</span>Advanced</div>
      <div class="m-accbody ${advOpen ? "" : "collapsed"}">
        ${tab("metadata", "Metadata", active === "metadata", true)}
        ${tab("structure", "Structure", active === "structure", true)}
      </div>
      ${imaging ? `
      <div class="m-acc"><span class="cv">▾</span>Imaging (MSI)<span class="cap">IMS columns ✓</span></div>
      <div class="m-accbody">
        ${tab("overview", "Overview (TIC)", active === "overview", true, "1")}
        ${tab("ion", "Ion image", active === "ion", true, "2")}
        ${tab("multi", "RGB channels", active === "multi", true)}
        ${tab("optical", "Optical", active === "optical", true)}
        ${tab("grid", "Grid", active === "grid", true)}
      </div>` : ""}
      <div class="m-filecard">
        <div class="h">File</div>
        ${imaging ? `
        <div class="r"><span class="k">Spectra</span><span class="v">34,840</span></div>
        <div class="r"><span class="k">m/z</span><span class="v">86–1004</span></div>
        <div class="r"><span class="k">Layout</span><span class="v">imaging</span></div>
        <div class="r"><span class="k">Imaging</span><span class="v" style="color:var(--success)">yes</span></div>`
        : `
        <div class="r"><span class="k">Spectra</span><span class="v">1,684</span></div>
        <div class="r"><span class="k">m/z</span><span class="v">50–1200</span></div>
        <div class="r"><span class="k">Layout</span><span class="v">lc-ms</span></div>
        <div class="r"><span class="k">Imaging</span><span class="v">no</span></div>`}
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   SCREEN 2 — CAPABILITY-ADAPTIVE SHELL
   ════════════════════════════════════════════════════════════════════════ */
WF_SCREENS.shell = function (state) {
  const imaging = state !== "lcms";
  const sideGoto = { summary: "summary:" + (imaging ? "imaging" : "lcms"), spectra: "spectra:profile", structure: "structure:list", ion: "imaging:empty", overview: "imaging:empty" };
  return `
  <div class="m-win">
    ${shellTopbar(imaging)}
    <div class="m-shell">
      <div data-pinhost style="position:relative">${shellSidebar(imaging ? "overview" : "summary", { imaging, goto: sideGoto })}</div>
      <div class="m-view">
        <div class="m-vh"><h3>${imaging ? "Overview (TIC)" : "Summary"}</h3><p>${imaging ? "Per-pixel total-ion-current heatmap" : "File overview, stats and capabilities"}</p></div>
        <div data-pinhost style="display:flex;flex-direction:column;gap:12px">
          <div class="hint" style="display:flex;gap:8px;align-items:center;padding:9px 12px;background:var(--blue-50);border:1px solid var(--blue-200);border-radius:var(--radius-md);color:var(--blue-700)">
            <span style="font-size:14px">↻</span>
            ${imaging
              ? "This file carries spatial coordinates — the <b>Imaging (MSI)</b> group below is unlocked. Steps ①→② walk the round-trip."
              : "No spatial coordinates detected — the Imaging group is hidden. Chromatograms is shown because 4 chromatograms are present."}
          </div>
          <div class="m-stage" style="min-height:300px;${imaging ? "" : "background:var(--gray-50);background-image:none"}">
            ${imaging
              ? `<div class="m-ion" style="width:300px;height:155px;background:
                   radial-gradient(circle at 38% 44%, #fde725, #22a884 26%, #2a788e 48%, #414487 70%, #1a1a1a 86%)"></div>`
              : `<div class="m-empty" style="color:var(--wf-faint)">No imaging grid — this is an LC-MS file.<br>Use Summary, Spectra and Chromatograms.</div>`}
          </div>
        </div>
      </div>
    </div>
  </div>`;
};

/* ════════════════════════════════════════════════════════════════════════
   SCREEN 3 — SUMMARY
   ════════════════════════════════════════════════════════════════════════ */
WF_SCREENS.summary = function (state) {
  const imaging = state !== "lcms";
  return `
  <div class="m-win">
    ${shellTopbar(imaging)}
    <div class="m-shell">
      ${shellSidebar("summary", { imaging, goto: { spectra: "spectra:profile", structure: "structure:list", overview: "imaging:empty", ion: "imaging:empty" } })}
      <div class="m-view mz-scroll">
        <div class="m-vh"><h3>Summary</h3><p>File overview, stats and capabilities</p></div>

        <div data-pinhost class="row" style="gap:12px;align-items:stretch">
          <div class="grow">
            <div class="eyebrow" style="margin-bottom:7px">Identity</div>
            <div style="font-weight:600;color:var(--gray-900);font-size:13px" class="mono">${imaging ? "HR2MSI-mouse-urinary-bladder.mzpeak" : "bruker-microTOF-Q-II.mzpeak"}</div>
            <div class="hint mono" style="margin-top:3px">${imaging ? "AP-SMALDI Orbitrap · imaging · 310 MB" : "micrOTOF-Q II · lc-ms · 38 MB"}</div>
            <div class="m-tiles mt12">
              <div class="m-tile"><div class="val">${imaging ? "34,840" : "1,684"}</div><div class="lab">Spectra</div></div>
              <div class="m-tile"><div class="val">${imaging ? "86–1004" : "50–1200"}<small>Th</small></div><div class="lab">m/z range</div></div>
              <div class="m-tile"><div class="val">${imaging ? "imaging" : "lc-ms"}</div><div class="lab">Layout</div></div>
              <div class="m-tile"><div class="val ${imaging ? "accent" : ""}">${imaging ? "yes" : "no"}</div><div class="lab">Imaging</div></div>
            </div>
          </div>
          ${imaging ? `
          <div class="hot" data-goto="imaging:empty" style="border:1px solid var(--wf-line);border-radius:var(--radius-md);background:var(--ink);padding:10px;display:flex;flex-direction:column;align-items:center;gap:6px;width:150px;flex-shrink:0">
            <div class="m-ion" style="width:118px;height:61px;background:radial-gradient(circle at 40% 45%,#fde725,#22a884 30%,#414487 62%,#1a1a1a 84%)"></div>
            <span style="font-size:10px;color:#9aa4ad" class="mono">TIC overview</span>
            <span class="m-btn primary sm" style="height:24px">Open ion-image explorer →</span>
          </div>` : ""}
        </div>

        <div data-pinhost class="mt16">
          <div class="m-panel">
            <div class="ph">Capabilities <span class="ct">round-trip readiness</span></div>
            <div class="pb">
              <div class="row wrap gap8" style="margin:4px 0 8px">
                <span class="m-badge ${imaging ? "ok" : "neutral"}"><span class="bd"></span>Imaging (MSI) — ${imaging ? "yes" : "no"}</span>
                <span class="m-badge ${imaging ? "info" : "neutral"}"><span class="bd"></span>${imaging ? "2 optical images" : "no optical"}</span>
                <span class="m-badge neutral"><span class="bd"></span>${imaging ? "per-pixel TIC" : "4 chromatograms"}</span>
                <span class="m-badge mono neutral">${imaging ? "zlib · numpress" : "zlib"}</span>
              </div>
              ${imaging ? `<div class="m-statrow"><span class="k">Detection signals</span><span class="v">IMS_1000050_position_x, _y · CV params</span></div>
              <div class="m-statrow"><span class="k">Detection confidence</span><span class="v" style="color:var(--success)">high</span></div>` : ""}
              <div class="m-statrow"><span class="k">Unsupported features</span><span class="v"><span class="m-badge warn mono" style="font-size:9.5px">2 · ion-mobility</span></span></div>
            </div>
          </div>
          <div class="m-panel">
            <div class="ph">File <span class="cv">▾</span></div>
            <div class="pb">
              <div class="m-statrow"><span class="k">Instrument</span><span class="v">${imaging ? "Q Exactive HF Orbitrap" : "micrOTOF-Q II"}</span></div>
              <div class="m-statrow"><span class="k">m/z range</span><span class="v">${imaging ? "86.01 – 1004.55" : "50.00 – 1200.00"} <em>Th</em></span></div>
              <div class="m-statrow"><span class="k">RT range</span><span class="v">${imaging ? "—" : "0.0 – 1980.5"} <em>s</em></span></div>
              <div class="m-statrow"><span class="k">Entities</span><span class="v">${imaging ? "34,840" : "1,684"}</span></div>
            </div>
          </div>
          <div class="row gap8 mt12">
            <span class="m-btn hot" data-goto="spectra:profile">${ic(ICONS.spectra)}Browse spectra</span>
            ${imaging ? `<span class="m-btn primary hot" data-goto="imaging:empty">${ic(ICONS.ion)}Explore ion images</span>` : ""}
            <span class="m-btn hot" data-goto="structure:list">${ic(ICONS.structure)}Inspect structure</span>
          </div>
        </div>
      </div>
    </div>
  </div>`;
};
