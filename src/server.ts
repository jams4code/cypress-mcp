// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./types/index.js";
import { registerAllTools } from "./tools/index.js";

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    {
      name: "cypress-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  registerAllTools(server, ctx);

  return server;
}
