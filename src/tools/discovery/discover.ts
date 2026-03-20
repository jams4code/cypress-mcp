import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import type { SpecSummary } from "../../types/results.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_discover",
    "Discover and map the entire Cypress test suite. Returns all specs with test counts, describe blocks, and test names. Use this first to understand what tests exist before writing or running anything.",
    {},
    async () => {
      const config = await ctx.configLoader.load();
      const specFiles = await ctx.specFinder.findSpecs();

      const specs: SpecSummary[] = await Promise.all(
        specFiles.map(async (file) => {
          const absolute = path.join(config.projectRoot, file);
          try {
            const content = await fs.readFile(absolute, "utf-8");
            return parseSpecSummary(file, content);
          } catch {
            return { file, tests: 0, describes: [], testNames: [] };
          }
        }),
      );

      const totalTests = specs.reduce((sum, s) => sum + s.tests, 0);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ok: true,
                tool: "cypress_discover",
                summary: `Found ${specs.length} spec files with ${totalTests} total tests`,
                data: {
                  projectRoot: config.projectRoot,
                  configFile: config.cypressConfigFile,
                  specCount: specs.length,
                  totalTests,
                  specs,
                },
                nextActions: specs.length > 0
                  ? ["cypress_analyze_spec", "cypress_run_spec"]
                  : ["cypress_doctor"],
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

function parseSpecSummary(file: string, content: string): SpecSummary {
  const describes: string[] = [];
  const testNames: string[] = [];

  const describeRegex = /describe\s*\(\s*['"`](.+?)['"`]/g;
  let match: RegExpExecArray | null;
  while ((match = describeRegex.exec(content)) !== null) {
    if (match[1]) describes.push(match[1]);
  }

  const itRegex = /it(?:\.only|\.skip)?\s*\(\s*['"`](.+?)['"`]/g;
  while ((match = itRegex.exec(content)) !== null) {
    if (match[1]) testNames.push(match[1]);
  }

  return { file, tests: testNames.length, describes, testNames };
}
