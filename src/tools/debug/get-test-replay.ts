// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_get_test_replay",
    "Return the Cypress Cloud replay URL for the last run, if recording was enabled. Requires projectId and record key in Cypress config.",
    {},
    async () => {
      const lastRun = ctx.stateStore.getLastRun();

      if (!lastRun) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                message: "No test runs recorded. Run a spec first.",
              }),
            },
          ],
        };
      }

      // Cypress Cloud replay URLs are not available from local JSON reporter output.
      // They require --record flag and projectId in cypress.config.
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              message:
                "Test replay requires Cypress Cloud recording. Run with --record and a valid projectId to get replay URLs.",
              lastSpec: lastRun.spec,
              hint: "Add record: true and projectId to your cypress.config to enable this feature.",
            }),
          },
        ],
      };
    },
  );
}
