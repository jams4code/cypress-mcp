// @ts-check
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["dist/", "node_modules/", "*.mjs", "test/fixtures/"],
  },
  {
    // The reporter and runtime/ are plain JavaScript because Cypress loads
    // them as they are: require() in Node, bundled into the spec in the browser.
    files: ["src/**/*.ts", "test/**/*.ts", "reporter/**/*.cjs", "runtime/**/*.{js,cjs}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended?.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "error",
    },
  },
  {
    // Loaded with require() by Cypress, so CommonJS is the point.
    files: ["reporter/**/*.cjs", "runtime/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
