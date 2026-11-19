// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import { LAST_RUN } from "../../services/state-store.js";
import { RunNotFoundError } from "../../utils/errors.js";
import { RUNS_CYPRESS } from "../result.js";
import { deprecated, executeLegacyRun, toolError } from "./execute-run.js";

const TOOL = "cypress_rerun_last";

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "Rerun a Cypress run (deprecated)",
      description: deprecated(
        "cypress_run with the same arguments",
        "Replay the exact arguments of a previous run_spec or run_test call, Cloud recording options included.",
      ),
      inputSchema: z.object({
        runId: z
          .string()
          .min(1)
          .default(LAST_RUN)
          .describe('Run to replay; "last" is the latest run of this server'),
      }),
      annotations: RUNS_CYPRESS,
    },
    async ({ runId }, request) => {
      try {
        const previous = ctx.stateStore.getRun(runId);
        if (!previous) {
          throw new RunNotFoundError(runId, ctx.stateStore.runIds());
        }
        return await executeLegacyRun(ctx.projects.context(previous.projectRoot), {
          tool: TOOL,
          kind: previous.kind,
          specs: previous.specs,
          prefix: previous.prefix,
          args: previous.args,
          testName: previous.args.grep,
          previousRunId: previous.runId,
          request,
        });
      } catch (err) {
        return toolError(TOOL, err, ctx.logger);
      }
    },
  );
}
