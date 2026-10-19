// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import type { CypressRunArgs } from "../../types/cypress.js";
import {
  cloudOptionsSchema,
  executeRun,
  runOptionsSchema,
  toCloudArgs,
  toolError,
} from "./execute-run.js";

const TOOL = "cypress_run_spec";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL,
    "Run a single Cypress spec file headless. Returns structured results with pass/fail/flaky counts, failure details, screenshot paths, the Cypress Cloud run URL when recorded, and recommended next actions.",
    {
      spec: z.string().describe("Path to the spec file relative to project root"),
      ...runOptionsSchema,
      ...cloudOptionsSchema,
    },
    async ({ spec, browser, headed, timeout, env, ...cloud }) => {
      try {
        const resolvedSpec = await ctx.specFinder.resolveSpec(spec);
        const config = await ctx.configLoader.load();

        const args: CypressRunArgs = {
          spec: resolvedSpec,
          browser: browser ?? config.defaultBrowser,
          headed,
          timeout: timeout ?? config.defaultTimeout,
          env,
          configFile: config.cypressConfigFile,
          cloud: toCloudArgs(cloud),
        };

        return await executeRun(ctx, {
          tool: TOOL,
          kind: "run_spec",
          spec: resolvedSpec,
          args,
          includeDiscoverOnSuccess: true,
        });
      } catch (err) {
        return toolError(TOOL, err);
      }
    },
  );
}
