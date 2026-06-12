export interface ColormapScaleProps {
  /** @default "viridis" */
  colormap?: "viridis" | "inferno" | "gray";
  /** Low-end tick label. @default "0" */
  low?: string;
  /** High-end tick label. @default "max" */
  high?: string;
  /** @default "horizontal" */
  orientation?: "horizontal" | "vertical";
  /** Tune tick colour for placement on the dark data stage. */
  onStage?: boolean;
  className?: string;
}

/** Signature ion-image legend / scale bar. `.mz-cmap`. */
export function ColormapScale({
  colormap = "viridis",
  low = "0",
  high = "max",
  orientation = "horizontal",
  onStage,
  className,
}: ColormapScaleProps) {
  const cls = [
    "mz-cmap",
    orientation === "vertical" ? "mz-cmap--vertical" : "",
    onStage ? "mz-cmap--stage" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <div className={`mz-cmap__bar mz-cmap__bar--${colormap}`} />
      <div className="mz-cmap__ticks">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}
