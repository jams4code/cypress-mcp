// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_get_config",
    "Return the current Cypress MCP server configuration including project root, browser, timeouts, and directories.",
    {},
    async () => {
      const config = await ctx.configLoader.load();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(config, null, 2),
          },
        ],
      };
    },
  );
}
