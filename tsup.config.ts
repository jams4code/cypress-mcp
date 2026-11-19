import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  // package.json engines: >=22.12
  target: "node22",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  minify: false,
  treeshake: true,
  // Every dependency is bundled, so `npx -y cypress-mcp` installs one package
  // instead of the MCP SDK's whole dependency tree (96 packages and 8 s cold
  // in 0.2.x, against a 10 s startup timeout in Codex).
  noExternal: [/.*/],
  // Read by scripts/third-party-notices.mjs and scripts/audit-prod.mjs to know
  // which packages ship inside dist/index.js.
  metafile: true,
  // Bundled CommonJS packages (tree-kill) call require() for Node built-ins,
  // which an ES module does not have.
  banner: {
    js: 'import { createRequire as __cypressMcpCreateRequire } from "node:module";\nconst require = __cypressMcpCreateRequire(import.meta.url);',
  },
});
