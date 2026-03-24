// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import { normalizePath } from "../../utils/paths.js";

const SUPPORT_FILE_CANDIDATES = [
  "cypress/support/e2e.ts",
  "cypress/support/e2e.js",
  "cypress/support/index.ts",
  "cypress/support/index.js",
];

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_get_support_file",
    "Find the Cypress support file and verify it exists. Returns the path and basic validation.",
    {},
    async () => {
      const config = await ctx.configLoader.load();

      for (const candidate of SUPPORT_FILE_CANDIDATES) {
        const fullPath = path.join(config.projectRoot, candidate);
        try {
          const stat = await fs.stat(fullPath);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  found: true,
                  path: normalizePath(candidate),
                  absolutePath: normalizePath(fullPath),
                  size: stat.size,
                }),
              },
            ],
          };
        } catch {
          // Try next
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              found: false,
              message: "No support file found.",
              candidates: SUPPORT_FILE_CANDIDATES,
            }),
          },
        ],
      };
    },
  );
}
