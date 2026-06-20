// MUST be first: repairs an invalid navigator.language before uPlot's module-load
// `new Intl.NumberFormat(navigator.language)` can throw and blank the app (Firefox).
import "./locale-guard";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@mzpeak/ui-kit/styles.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import { App } from "./App";
import { hydrateFromLocation } from "./urlSync";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Apply a deep link (?file=…&view=…&scan=…) once the app has mounted.
// Self-guarded + async (no-op when there's no `file` param).
void hydrateFromLocation();
