// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import { cloudOptionsShape, prepareRun, runOptionsShape } from "../run-shared.js";
import { RUNS_CYPRESS } from "../result.js";
import { deprecated, executeLegacyRun, toolError } from "./execute-run.js";

const TOOL = "cypress_run_spec";

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "Run Cypress spec (deprecated)",
      description: deprecated(
        "cypress_run",
        "Run a single Cypress spec file headless. Returns the 0.2 JSON results with failure details, screenshot paths and next actions.",
      ),
      inputSchema: z.object({
        spec: z.string().describe("Path to the spec file relative to project root"),
        ...runOptionsShape,
        ...cloudOptionsShape,
      }),
      annotations: RUNS_CYPRESS,
    },
    async (input, request) => {
      try {
        const run = await prepareRun(ctx, input);
        return await executeLegacyRun(run.ctx, {
          tool: TOOL,
          kind: "run_spec",
          specs: run.specs,
          prefix: run.prefix,
          args: run.args,
          request,
        });
      } catch (err) {
        return toolError(TOOL, err, ctx.logger);
      }
    },
  );
}
