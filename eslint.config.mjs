import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // `docs/` é material de referência, não código do app: o handoff de design
    // tem um scaffold copiado que roda no navegador com `React` global, e ele
    // nunca entra no bundle. Lintá-lo falha a bateria por algo que não é defeito.
    "docs/**",
  ]),
]);

export default eslintConfig;
