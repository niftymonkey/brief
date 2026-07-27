import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "outputs/**",
    ".vercel/**",
    "public/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // JSX text handles apostrophes and quotes correctly on its own, and
      // entity-escaped prose is harder to read and edit.
      "react/no-unescaped-entities": "off",
    },
  },
]);

export default eslintConfig;
