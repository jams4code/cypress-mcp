// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import { cloudOptionsShape, prepareRun, runOptionsShape } from "../run-shared.js";
import { RUNS_CYPRESS } from "../result.js";
import { deprecated, executeLegacyRun, toolError } from "./execute-run.js";

const TOOL = "cypress_run_test";

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "Run one Cypress test (deprecated)",
      description: deprecated(
        "cypress_run with testName",
        "Run a specific test by name within a spec file using grep (@cypress/grep). If the name matches no test, the call fails and lists the closest test titles.",
      ),
      inputSchema: z.object({
        spec: z.string().describe("Path to the spec file"),
        testName: z.string().min(1).describe("Exact or partial test name to match"),
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
          kind: "run_test",
          specs: run.specs,
          prefix: run.prefix,
          args: run.args,
          testName: input.testName,
          request,
        });
      } catch (err) {
        return toolError(TOOL, err, ctx.logger);
      }
    },
  );
}
