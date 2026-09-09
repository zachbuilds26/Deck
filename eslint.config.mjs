import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next. node_modules is listed
  // explicitly: without it `eslint .` crawls dependencies for minutes. Same
  // for the browser-capture artifact dirs at the repo root (thousands of
  // trace/screenshot files from past verification runs).
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    ".chrome-*/**",
    ".edge-*/**",
  ]),
]);

export default eslintConfig;
