// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_list_specs",
    "List all Cypress spec files in the project. Returns file paths and test counts.",
    { pattern: z.string().optional().describe("Glob pattern to filter specs") },
    async ({ pattern }) => {
      const specs = await ctx.specFinder.findSpecs(pattern);
      const results = await Promise.all(
        specs.map(async (file) => ({
          file,
          tests: await ctx.specFinder.countTests(file),
        })),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ specs: results, total: results.length }, null, 2),
          },
        ],
      };
    },
  );
}
