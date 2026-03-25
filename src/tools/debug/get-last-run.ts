// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_get_last_run",
    "Return the full structured results of the most recent Cypress test run including runId, args used, and all test details.",
    {},
    async () => {
      const lastRun = ctx.stateStore.getLastRun();

      if (!lastRun) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: false,
                tool: "cypress_get_last_run",
                summary: "No test runs recorded in this session.",
                data: null,
                nextActions: ["cypress_run_spec", "cypress_discover"],
              }),
            },
          ],
        };
      }

      const nextActions: string[] = [];
      if (lastRun.result.error) {
        nextActions.push("cypress_doctor", "cypress_rerun_last");
      } else if (lastRun.result.failures.length > 0) {
        nextActions.push("cypress_get_failure_context", "cypress_rerun_last");
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ok: true,
                tool: "cypress_get_last_run",
                summary: `Run ${lastRun.runId}: ${lastRun.result.stats.passing} passing, ${lastRun.result.stats.failing} failing in ${lastRun.spec}`,
                data: {
                  runId: lastRun.runId,
                  kind: lastRun.kind,
                  spec: lastRun.spec,
                  timestamp: new Date(lastRun.timestamp).toISOString(),
                  args: lastRun.args,
                  result: lastRun.result,
                  stdoutTail: lastRun.stdoutTail || undefined,
                  stderrTail: lastRun.stderrTail || undefined,
                },
                nextActions,
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
