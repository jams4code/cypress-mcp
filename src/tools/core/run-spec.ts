// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/index.js";
import type { CypressRunArgs } from "../../types/cypress.js";
import { CypressMcpError } from "../../utils/errors.js";

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    "cypress_run_spec",
    "Run a single Cypress spec file headless. Returns structured results with pass/fail counts, failure details, screenshot paths, and recommended next actions.",
    {
      spec: z.string().describe("Path to the spec file relative to project root"),
      browser: z.string().optional().describe("Browser: electron, chrome, firefox, edge"),
      headed: z.boolean().optional().describe("Run in headed mode (visible browser)"),
      timeout: z.number().optional().describe("Timeout in ms (default: 300000)"),
      env: z.record(z.string()).optional().describe("Env vars to pass to Cypress"),
    },
    async ({ spec, browser, headed, timeout, env }) => {
      try {
        await ctx.specFinder.resolveSpec(spec);
        const config = await ctx.configLoader.load();

        const args: CypressRunArgs = {
          spec,
          browser: browser ?? config.defaultBrowser,
          headed,
          timeout: timeout ?? config.defaultTimeout,
          env,
        };

        const raw = await ctx.processManager.run(args);
        const result = ctx.outputParser.parse(raw.stdout, raw.stderr, raw.exitCode);

        const screenshots = await ctx.screenshotResolver.find(spec);
        const enriched = {
          ...result,
          screenshots: screenshots.length > 0 ? screenshots : result.screenshots,
        };

        const record = ctx.stateStore.recordRun(
          "run_spec", spec, args, enriched, raw.stdout, raw.stderr,
        );

        const nextActions: string[] = [];
        if (enriched.error) {
          nextActions.push("cypress_doctor", "cypress_get_last_run");
        } else if (enriched.stats.failing > 0) {
          nextActions.push("cypress_get_failure_context", "cypress_get_screenshot");
        } else if (enriched.stats.passing > 0) {
          nextActions.push("cypress_discover");
        }

        let summary: string;
        if (enriched.error) {
          summary = `Cypress failed to start: ${enriched.error.slice(0, 150)}`;
        } else if (enriched.success) {
          summary = `All ${enriched.stats.passing} tests passed in ${spec}`;
        } else {
          summary = `${enriched.stats.failing} failing, ${enriched.stats.passing} passing in ${spec}`;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: !enriched.error,
                tool: "cypress_run_spec",
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
              ok: false, tool: "cypress_run_spec", summary: err.message,
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
