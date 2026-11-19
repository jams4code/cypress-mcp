// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import type { CypressRunResult } from "../../types/results.js";
import { LAST_RUN } from "../../services/state-store.js";
import { buildFailureContexts } from "../../services/failure-context.js";
import { RunNotFoundError } from "../../utils/errors.js";
import { crashNextActions } from "../../utils/run-results.js";
import { READ_ONLY, legacyErrorResult, legacyResult } from "../result.js";
import { deprecated } from "../core/execute-run.js";

const TOOL = "cypress_get_failure_context";

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "Get Cypress failure context (deprecated)",
      description: deprecated(
        "cypress_get_failure",
        "Debugging bundle for the failures of a run: failing test, error, stack hint, location, spec excerpt and screenshot paths.",
      ),
      inputSchema: z.object({
        runId: z
          .string()
          .min(1)
          .default(LAST_RUN)
          .describe('Run to inspect; "last" is the latest run of this server'),
      }),
      annotations: READ_ONLY,
    },
    async ({ runId }) => {
      try {
        const run = ctx.stateStore.getRun(runId);
        if (!run) {
          throw new RunNotFoundError(runId, ctx.stateStore.runIds());
        }

        if (run.result.error) {
          return legacyResult(
            {
              ok: false,
              tool: TOOL,
              summary: crashSummary(run.result, run.spec),
              data: {
                runId: run.runId,
                spec: run.spec,
                error: run.result.error,
                runningTest: run.result.runningTest,
                failures:
                  run.result.failures.length > 0 ? run.result.failures : undefined,
                stdoutTail: run.stdoutTail || undefined,
                stderrTail: run.stderrTail || undefined,
              },
              nextActions: crashNextActions(run.result) ?? [
                "cypress_get_last_run",
                "cypress_rerun_last",
              ],
            },
            true,
          );
        }

        if (run.result.failures.length === 0) {
          return legacyResult(
            {
              ok: true,
              tool: TOOL,
              summary: "Last run had no failures.",
              data: { runId: run.runId, spec: run.spec },
              nextActions: [],
            },
            false,
            false,
          );
        }

        const contexts = await buildFailureContexts(run, run.projectRoot, 5);
        const failures = contexts.map((f) => ({
          testTitle: f.title,
          fullTitle: f.fullTitle,
          error: f.error,
          stackHint: f.stackHint,
          location: f.location,
          diff: f.diff,
          screenshot: f.screenshot,
          specExcerpt: f.excerpt,
        }));
        const screenshots = await ctx.screenshotResolver.find(run.spec);

        return legacyResult({
          ok: true,
          tool: TOOL,
          summary: `${failures.length} failure(s) in ${run.spec}`,
          data: {
            runId: run.runId,
            spec: run.spec,
            failures,
            screenshots,
            stderrTail: run.stderrTail || undefined,
          },
          nextActions: [
            "Fix the failing test(s) based on the error and spec excerpt",
            "cypress_rerun_last",
            "cypress_get_screenshot",
          ],
        });
      } catch (err) {
        return legacyErrorResult(TOOL, err, ctx.logger);
      }
    },
  );
}

function crashSummary(result: CypressRunResult, spec: string): string {
  if (result.errorKind === "compile") {
    return `${spec} did not compile, no test ran`;
  }
  if (result.errorKind === "timeout") {
    return result.runningTest
      ? `Last run timed out in ${spec} while running "${result.runningTest}"`
      : `Last run timed out in ${spec}`;
  }
  return `Last run crashed before tests executed in ${spec}`;
}
