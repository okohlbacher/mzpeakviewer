import { defineConfig } from "vitest/config";

// Unit tests live under src/. Exclude the vendored mzpeakts package's own tests
// (they hit the network and use a non-vitest assert API).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["vendor/**", "node_modules/**", "dist/**"],
    environment: "node",
  },
});
