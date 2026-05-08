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
  banner: {
    js: [
      "#!/usr/bin/env node",
      "process.removeAllListeners('warning');",
      "process.on('warning', (w) => {",
      "  if (w.code === 'DEP0040') return;",
      "  process.stderr.write('(node:' + process.pid + ') ' + w.name + ': ' + w.message + '\\n');",
      "});",
    ].join("\n"),
  },
  outExtension: () => ({ js: ".cjs" }),
});
