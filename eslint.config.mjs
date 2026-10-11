import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { FlatCompat } = require("@eslint/eslintrc");
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      ".next-dev/**",
      "node_modules/**",
      "next-env.d.ts",
      "test-results/**",
      "playwright-report/**",
      ".vercel/**",
    ],
  },
];

export default config;
