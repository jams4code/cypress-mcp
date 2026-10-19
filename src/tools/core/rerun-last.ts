// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import { executeRun, toolError } from "./execute-run.js";

const TOOL = "cypress_rerun_last";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL,
    "Replay the exact last run_spec or run_test invocation, including its Cypress Cloud recording options. Removes friction when iterating on the same failure: no need to reconstruct arguments.",
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
                tool: TOOL,
                summary: "No previous run to replay",
                data: null,
                nextActions: ["cypress_run_spec", "cypress_discover"],
              }),
            },
          ],
        };
      }

      try {
        return await executeRun(ctx, {
          tool: TOOL,
          kind: lastRun.kind,
          spec: lastRun.spec,
          args: lastRun.args,
          testName: lastRun.args.grep,
          previousRunId: lastRun.runId,
        });
      } catch (err) {
        return toolError(TOOL, err);
      }
    },
  );
}
