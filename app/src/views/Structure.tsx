// Structure view — placeholder for Parquet structure browser.
export function Structure() {
  return (
    <div data-testid="structure-view" style={{ maxWidth: 640 }}>
      <div
        style={{
          padding: "1.5rem",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-md)",
          background: "var(--surface-panel)",
          color: "var(--text-muted)",
          textAlign: "center",
        }}
      >
        <p
          style={{
            margin: "0 0 0.5rem",
            fontWeight: "var(--weight-semibold)",
            color: "var(--text-heading)",
          }}
        >
          Parquet structure
        </p>
        <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>
          Parquet structure browser — coming in a later slice.
        </p>
      </div>
    </div>
  );
}
