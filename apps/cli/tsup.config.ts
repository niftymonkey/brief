import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["cjs"],
  target: "node20",
  outDir: "dist",
  clean: true,
  shims: false,
  splitting: false,
  noExternal: ["@brief/core"],
  banner: { js: "#!/usr/bin/env node" },
  outExtension: () => ({ js: ".cjs" }),
});
