import { useCallback, useEffect, useRef, type DependencyList } from "react";
import type uPlot from "uplot";

/**
 * Manages the uPlot lifecycle shared by SpectrumPlot and ChromPlot.
 *
 * uPlot must be constructed LAZILY once the host has a real width — building at
 * zero width permanently breaks its scale auto-ranging — and recreated whenever
 * the data changes (a built-empty instance never re-ranges on a later setData).
 * This hook owns the host ref, the instance, the ResizeObserver, and the
 * rebuild/redraw effects so both plots stay identical and correct.
 *
 * @param construct  Build a fresh uPlot at the given width (return null to leave
 *                   the host empty, e.g. for an empty dataset).
 * @param height     Fixed plot height in px.
 * @param rebuildDeps Reconstruct the instance when any of these change (the data).
 * @param redrawDeps  Cheap redraw (no reconstruct) when any of these change
 *                    (e.g. a selection marker drawn by a hook).
 */
export function useUplot(
  construct: (el: HTMLDivElement, width: number) => uPlot | null,
  height: number,
  rebuildDeps: DependencyList,
  redrawDeps: DependencyList,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const constructRef = useRef(construct);
  constructRef.current = construct;

  const build = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    const w = el.clientWidth;
    if (w <= 0) return; // wait for layout; the ResizeObserver retries
    plotRef.current?.destroy();
    plotRef.current = constructRef.current(el, w);
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w <= 0) return;
      if (plotRef.current) plotRef.current.setSize({ width: w, height });
      else build();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
  }, [build, height]);

  // Recreate on data change (see note above).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => build(), rebuildDeps);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => plotRef.current?.redraw(), redrawDeps);

  return hostRef;
}
