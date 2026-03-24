// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import { sanitizeEnv } from "../../utils/sanitize.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_get_env",
    "Return the contents of cypress.env.json with sensitive values masked. Safe to display.",
    {},
    async () => {
      const config = await ctx.configLoader.load();
      const envPath = path.join(config.projectRoot, "cypress.env.json");

      try {
        const raw = await fs.readFile(envPath, "utf-8");
        const parsed: unknown = JSON.parse(raw);

        if (typeof parsed === "object" && parsed !== null) {
          const sanitized = sanitizeEnv(parsed as Record<string, unknown>);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ env: sanitized, path: envPath }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ env: parsed }) },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                env: null,
                message: "No cypress.env.json found or file is invalid.",
              }),
            },
          ],
        };
      }
    },
  );
}
