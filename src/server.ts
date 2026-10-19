// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./types/index.js";
import { registerAllTools } from "./tools/index.js";

// package.json sits one level above both src/ and dist/, and npm always ships it.
const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export const SERVER_VERSION = version;

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    {
      name: "cypress-mcp",
      version: SERVER_VERSION,
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
