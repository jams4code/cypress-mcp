// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import type { CypressRunArgs } from "../../types/cypress.js";
import { CypressMcpError } from "../../utils/errors.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_run_test",
    "Run a specific test by name within a spec file using grep. Returns structured results with recommended next actions for the agent.",
    {
      spec: z.string().describe("Path to the spec file"),
      testName: z.string().describe("Exact or partial test name to match"),
      browser: z.string().optional().describe("Browser to use"),
      timeout: z.number().optional().describe("Timeout in ms"),
    },
    async ({ spec, testName, browser, timeout }) => {
      try {
        await ctx.specFinder.resolveSpec(spec);
        const config = await ctx.configLoader.load();

        const args: CypressRunArgs = {
          spec,
          browser: browser ?? config.defaultBrowser,
          timeout: timeout ?? config.defaultTimeout,
          grep: testName,
        };

        const raw = await ctx.processManager.run(args);
        const result = ctx.outputParser.parse(raw.stdout, raw.stderr, raw.exitCode);

        const screenshots = await ctx.screenshotResolver.find(spec, testName);
        const enriched = {
          ...result,
          screenshots: screenshots.length > 0 ? screenshots : result.screenshots,
        };

        const record = ctx.stateStore.recordRun(
          "run_test", spec, args, enriched, raw.stdout, raw.stderr,
        );

        const nextActions: string[] = [];
        if (enriched.stats.failing > 0) {
          nextActions.push("cypress_get_failure_context", "cypress_get_screenshot");
        }

        const summary = enriched.success
          ? `Test "${testName}" passed in ${spec}`
          : `Test "${testName}" failed in ${spec}`;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: !enriched.error,
                tool: "cypress_run_test",
                runId: record.runId,
                summary,
                data: enriched,
                nextActions,
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        if (err instanceof CypressMcpError) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              ok: false, tool: "cypress_run_test", summary: err.message,
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
