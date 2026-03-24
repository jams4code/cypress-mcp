// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_clear_downloads",
    "Clear the Cypress downloads directory. Useful before re-running tests that produce download artifacts.",
    {},
    async () => {
      const config = await ctx.configLoader.load();
      const downloadsPath = path.join(config.projectRoot, config.downloadsDir);

      try {
        await fs.rm(downloadsPath, { recursive: true, force: true });
        await fs.mkdir(downloadsPath, { recursive: true });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                cleared: true,
                path: downloadsPath,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                cleared: false,
                error: err instanceof Error ? err.message : "Unknown error",
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
