// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import { CypressMcpError } from "../../utils/errors.js";
import {
  buildRunNextActions,
  buildRunSummary,
  enrichRunResult,
} from "../../utils/run-results.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_rerun_last",
    "Replay the exact last run_spec or run_test invocation. Removes friction when iterating on the same failure — no need to reconstruct arguments.",
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
                tool: "cypress_rerun_last",
                summary: "No previous run to replay",
                data: null,
                nextActions: ["cypress_run_spec", "cypress_discover"],
              }),
            },
          ],
        };
      }

      try {
        const raw = await ctx.processManager.run(lastRun.args);
        const result = ctx.outputParser.parse(raw.stdout, raw.stderr, raw.exitCode);

        const screenshots = await ctx.screenshotResolver.find(
          lastRun.spec,
          lastRun.args.grep,
        );
        const enriched = enrichRunResult(
          result,
          screenshots.length > 0 ? screenshots : result.screenshots,
        );

        const record = ctx.stateStore.recordRun(
          lastRun.kind, lastRun.spec, lastRun.args, enriched, raw.stdout, raw.stderr,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: !enriched.error,
                tool: "cypress_rerun_last",
                runId: record.runId,
                summary: buildRunSummary(enriched, lastRun.spec, lastRun.args.grep),
                previousRunId: lastRun.runId,
                data: enriched,
                nextActions: buildRunNextActions(enriched),
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        if (err instanceof CypressMcpError) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              ok: false, tool: "cypress_rerun_last", summary: err.message,
              data: err.toJSON(), nextActions: ["cypress_doctor"],
            }) }],
            isError: true,
          };
        }
        throw err;
      }
    },
  );
}
