import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

const stdoutGuard = [
  {
    selector:
      "CallExpression[callee.object.object.name='process'][callee.object.property.name='stdout']",
    message:
      "stdout reserved for MCP JSON-RPC. Use stderr (logger) instead.",
  },
  {
    selector:
      "MemberExpression[object.name='process'][property.name='stdout']",
    message:
      "stdout reserved for MCP JSON-RPC. Use stderr (logger) instead.",
  },
];

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "**/*.cjs", "**/*.mjs"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "no-console": ["error", { allow: ["error", "warn"] }],
      "no-restricted-syntax": ["error", ...stdoutGuard],
    },
  },
  {
    files: ["src/server/transport/**/*.ts", "bin/**/*.ts", "src/server.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["test/**/*.ts", "**/*.test.ts"],
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
    },
  },
];
