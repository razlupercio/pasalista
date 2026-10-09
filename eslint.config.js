// SPDX-License-Identifier: AGPL-3.0-or-later
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      ".cache/**",
      "packages/db/migrations/**",
      "packages/api-client/src/schema.d.ts",
      "apps/web/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      // Only parameterized queries (CLAUDE.md): raw SQL fragments are forbidden outside migrations.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='sql'][callee.property.name='raw']",
          message:
            "sql.raw() bypasses parameterization. Use the sql`` template or the query builder.",
        },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // packages/core must run unchanged on Node, browsers and React Native.
    files: ["packages/core/src/**/*.ts"],
    languageOptions: { globals: {} },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["node:*"], message: "packages/core must stay platform-agnostic." }],
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      // React event handlers may be async; returning a promise to them is fine.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/test/**/*.ts", "apps/web/e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
