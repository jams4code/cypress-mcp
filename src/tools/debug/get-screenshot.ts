// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import { RunNotFoundError } from "../../utils/errors.js";
import { READ_ONLY, legacyErrorResult, legacyResult } from "../result.js";
import { deprecated } from "../core/execute-run.js";

const TOOL = "cypress_get_screenshot";

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "Find Cypress screenshots (deprecated)",
      description: deprecated(
        'cypress_get_failure with view "screenshots"',
        "Find screenshot files from Cypress test failures. Returns absolute file paths.",
      ),
      inputSchema: z.object({
        spec: z.string().optional().describe("Filter by spec file name"),
        testName: z.string().optional().describe("Filter by test name"),
        runId: z
          .string()
          .min(1)
          .optional()
          .describe("Screenshots of this run instead of a search on disk"),
      }),
      annotations: READ_ONLY,
    },
    async ({ spec, testName, runId }) => {
      try {
        let screenshots: string[];
        if (runId !== undefined) {
          const run = ctx.stateStore.getRun(runId);
          if (!run) {
            throw new RunNotFoundError(runId, ctx.stateStore.runIds());
          }
          screenshots = [...run.result.screenshots];
        } else {
          // Since 0.4 runs keep screenshots in their own folder: look at the
          // latest run first, then in the project's screenshots folder.
          const fromLastRun = matching(
            ctx.stateStore.getLastRun()?.result.screenshots ?? [],
            spec,
            testName,
          );
          screenshots =
            fromLastRun.length > 0
              ? fromLastRun
              : await ctx.screenshotResolver.find(spec, testName);
        }

        const summary =
          screenshots.length === 0
            ? "No screenshots found. Run a test first or check the spec/test name."
            : `Found ${screenshots.length} screenshot(s)`;

        return legacyResult({
          ok: true,
          tool: TOOL,
          summary,
          data: { screenshots, count: screenshots.length },
          nextActions:
            screenshots.length > 0
              ? ["cypress_get_failure_context", "cypress_rerun_last"]
              : ["cypress_run_spec"],
        });
      } catch (err) {
        return legacyErrorResult(TOOL, err, ctx.logger);
      }
    },
  );
}

/** The same filter as ScreenshotResolver.find: spec base name, then test name. */
function matching(files: readonly string[], spec?: string, testName?: string): string[] {
  const squash = (value: string): string =>
    value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return files.filter((file) => {
    if (spec && !file.includes(path.basename(spec, path.extname(spec)))) return false;
    if (testName && !squash(path.basename(file)).includes(squash(testName))) return false;
    return true;
  });
}
