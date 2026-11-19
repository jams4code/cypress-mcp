// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import { LAST_RUN } from "../../services/state-store.js";
import { RunNotFoundError } from "../../utils/errors.js";
import { READ_ONLY, legacyErrorResult, legacyResult } from "../result.js";
import { deprecated } from "../core/execute-run.js";

const TOOL = "cypress_get_last_run";

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "Get Cypress run results (deprecated)",
      description: deprecated(
        'cypress_get_failure with view "tests"',
        "Return the full structured results of a run including runId, args used, and all test details.",
      ),
      inputSchema: z.object({
        runId: z
          .string()
          .min(1)
          .default(LAST_RUN)
          .describe('Run to show; "last" is the latest run of this server'),
      }),
      annotations: READ_ONLY,
    },
    async ({ runId }) => {
      try {
        const run = ctx.stateStore.getRun(runId);
        if (!run) {
          throw new RunNotFoundError(runId, ctx.stateStore.runIds());
        }

        const nextActions: string[] = [];
        if (run.result.error) {
          nextActions.push("cypress_rerun_last");
        } else if (run.result.failures.length > 0) {
          nextActions.push("cypress_get_failure_context", "cypress_rerun_last");
        }

        return legacyResult({
          ok: true,
          tool: TOOL,
          summary: `Run ${run.runId}: ${run.result.stats.passing} passing, ${run.result.stats.failing} failing in ${run.spec}`,
          data: {
            runId: run.runId,
            kind: run.kind,
            spec: run.spec,
            timestamp: new Date(run.timestamp).toISOString(),
            args: run.args,
            result: run.result,
            stdoutTail: run.stdoutTail || undefined,
            stderrTail: run.stderrTail || undefined,
          },
          nextActions,
        });
      } catch (err) {
        return legacyErrorResult(TOOL, err, ctx.logger);
      }
    },
  );
}
