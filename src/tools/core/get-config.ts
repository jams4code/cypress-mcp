// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import { toolError } from "./execute-run.js";

const TOOL = "cypress_get_config";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL,
    "Return the resolved cypress-mcp configuration: project root, Cypress config file, browser, timeout, spec pattern, directories, and Cypress Cloud status (projectId, whether a record key is set). Use the projectId with Cypress Cloud MCP tools.",
    {},
    async () => {
      try {
        const config = await ctx.configLoader.load();
        const recordKeySet = Boolean(process.env["CYPRESS_RECORD_KEY"]);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ok: true,
                  tool: TOOL,
                  summary: `Config loaded from ${config.cypressConfigFile}`,
                  data: {
                    ...config,
                    cloud: {
                      projectId: config.projectId ?? null,
                      // Presence only. The key itself is never returned.
                      recordKeySet,
                      canRecord: Boolean(config.projectId) && recordKeySet,
                    },
                  },
                  nextActions: ["cypress_discover", "cypress_doctor"],
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return toolError(TOOL, err);
      }
    },
  );
}
