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
    // Xcode / Gradle output (gitignored): vendored third-party JS that a local
    // iOS or Android build leaves behind, which failed the pre-push lint.
    "ios/build/**",
    "android/**/build/**",
  ]),
]);

export default eslintConfig;
