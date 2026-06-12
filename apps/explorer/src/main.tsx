import { createRoot } from "react-dom/client";

// Self-hosted IBM Plex (chrome = Sans, every measured value = Mono), bundled by
// Vite so the deployed app needs no Google Fonts CDN.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";

import { App } from "./ui/App";
import "./ui/styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

// NOTE: StrictMode is intentionally omitted. Its dev-only double mount destroys
// and recreates the imperative uPlot instances, and the second instance can be
// created after the data effect has already run — leaving the chart blank until
// the next state change. The plots own raw canvas/WASM-backed handles, so the
// double-invoke buys us nothing here.
createRoot(rootEl).render(<App />);
