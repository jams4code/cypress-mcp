import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as {
  name: string;
  version: string;
  mcpName: string;
};
const server = JSON.parse(readFileSync("server.json", "utf-8")) as {
  name: string;
  version: string;
  packages: { registryType: string; identifier: string; version: string }[];
};

// The MCP Registry rejects a publish when these disagree, after npm already
// has the version, so the mismatch is caught here instead.
describe("server.json for the MCP Registry", () => {
  it("matches package.json", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages).toEqual([
      expect.objectContaining({
        registryType: "npm",
        identifier: pkg.name,
        version: pkg.version,
      }),
    ]);
  });
});

// Since 0.3.0 every dependency is bundled into dist/index.js, so that
// `npx -y cypress-mcp` installs one package and starts within the startup
// timeouts of MCP clients (Codex: 10 s). Needs `npm run build` first.
describe("published bundle", () => {
  it("declares no runtime dependencies", () => {
    expect((pkg as { dependencies?: object }).dependencies).toBeUndefined();
  });

  it("imports nothing but Node built-ins", () => {
    const code = readFileSync("dist/index.js", "utf-8");
    // The bundle is ESM with single or double quotes, after Rollup's tree shaking.
    const specifiers = [
      ...code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm),
      ...code.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
      ...code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
      // Not after a quote: ajv keeps `require("ajv/dist/runtime/...")` in
      // strings for its standalone code generation, which never runs here.
      ...code.matchAll(/(?<!['"`])\brequire(?:\$\d+)?\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]!);

    expect(specifiers.length).toBeGreaterThan(0);
    const external = specifiers.filter(
      (specifier) =>
        !specifier.startsWith("node:") &&
        !builtinModules.includes(specifier) &&
        // The wrapper config cypress-mcp writes for a run imports this; it is
        // text in a template, not an import of the bundle.
        specifier !== "./cypress-mcp-runtime.cjs",
    );
    expect(external).toEqual([]);
  });

  it("ships the notices of the bundled packages", () => {
    const notices = readFileSync("dist/THIRD_PARTY_NOTICES.md", "utf-8");
    for (const name of [
      "@modelcontextprotocol/server",
      "zod",
      "tinyglobby",
      "tree-kill",
    ]) {
      expect(notices).toContain(`## ${name} `);
    }
  });
});
