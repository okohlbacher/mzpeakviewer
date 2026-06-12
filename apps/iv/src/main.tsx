import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Self-hosted brand fonts (offline-safe, no CDN). Specific latin weight files:
// IBM Plex Sans 400/500/600/700 (+ 400 italic), IBM Plex Mono 400/500/600.
// Imported BEFORE the design-system CSS so @font-face rules register first.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";

// Design-system tokens + component classes (Phase 0: inert layers only;
// base.css global resets + shell.css join at Phase 2).
import "./styles/ds/index.css";

import { App } from "./ui/App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
