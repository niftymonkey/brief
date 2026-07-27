import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path mapping in tsconfig.json, so a suite imports a
    // component by the same specifier the app does.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    // Node is the default because most suites here talk to Postgres. A component
    // suite opts itself into a DOM with a `// @vitest-environment jsdom` docblock.
    environment: "node",
    passWithNoTests: true,
    setupFiles: ["./src/test/load-env.ts"],
  },
});
