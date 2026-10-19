// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import type { CypressRunArgs } from "../../types/cypress.js";
import { TitleFilterUnavailableError } from "../../utils/errors.js";
import {
  cloudOptionsSchema,
  executeRun,
  runOptionsSchema,
  toCloudArgs,
  toolError,
} from "./execute-run.js";

const TOOL = "cypress_run_test";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL,
    "Run a specific test by name within a spec file using grep (@cypress/grep). Returns structured results with recommended next actions for the agent.",
    {
      spec: z.string().describe("Path to the spec file"),
      testName: z.string().min(1).describe("Exact or partial test name to match"),
      ...runOptionsSchema,
      ...cloudOptionsSchema,
    },
    async ({ spec, testName, browser, headed, timeout, env, ...cloud }) => {
      try {
        const resolvedSpec = await ctx.specFinder.resolveSpec(spec);
        const config = await ctx.configLoader.load();
        if (!config.titleFilterSupport) {
          throw new TitleFilterUnavailableError();
        }

        const args: CypressRunArgs = {
          spec: resolvedSpec,
          browser: browser ?? config.defaultBrowser,
          headed,
          timeout: timeout ?? config.defaultTimeout,
          env,
          grep: testName,
          configFile: config.cypressConfigFile,
          cloud: toCloudArgs(cloud),
        };

        return await executeRun(ctx, {
          tool: TOOL,
          kind: "run_test",
          spec: resolvedSpec,
          args,
          testName,
        });
      } catch (err) {
        return toolError(TOOL, err);
      }
    },
  );
}
