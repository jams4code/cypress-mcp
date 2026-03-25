// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_get_screenshot",
    "Find screenshot files from Cypress test failures. Returns absolute file paths that multimodal AI agents can read directly.",
    {
      spec: z.string().optional().describe("Filter by spec file name"),
      testName: z.string().optional().describe("Filter by test name"),
    },
    async ({ spec, testName }) => {
      const screenshots = await ctx.screenshotResolver.find(spec, testName);

      const summary =
        screenshots.length === 0
          ? "No screenshots found. Run a test first or check the spec/test name."
          : `Found ${screenshots.length} screenshot(s)`;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ok: true,
                tool: "cypress_get_screenshot",
                summary,
                data: { screenshots, count: screenshots.length },
                nextActions:
                  screenshots.length > 0
                    ? ["cypress_get_failure_context", "cypress_rerun_last"]
                    : ["cypress_run_spec"],
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
