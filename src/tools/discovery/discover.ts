// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import type { SpecSummary } from "../../types/results.js";
import type { ParsedSpec } from "../../services/spec-parser.js";
import { READ_ONLY, legacyErrorResult, legacyResult } from "../result.js";
import { deprecated } from "../core/execute-run.js";

const TOOL = "cypress_discover";

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "Map the Cypress suite (deprecated)",
      description: deprecated(
        "cypress_list_specs with titles: true",
        "Map the whole Cypress suite: every spec with its test count, describe blocks and test names.",
      ),
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const config = await ctx.configLoader.load();
        const specFiles = await ctx.specFinder.findSpecs(config.specPattern);

        const specs: SpecSummary[] = await Promise.all(
          specFiles.map(async (file) =>
            toSummary(file, await ctx.specFinder.parse(file)),
          ),
        );
        const totalTests = specs.reduce((sum, s) => sum + s.tests, 0);

        return legacyResult({
          ok: true,
          tool: TOOL,
          summary: `Found ${specs.length} spec files with ${totalTests} total tests`,
          data: {
            projectRoot: config.projectRoot,
            configFile: config.cypressConfigFile,
            specCount: specs.length,
            totalTests,
            specs,
          },
          nextActions:
            specs.length > 0 ? ["cypress_analyze_spec", "cypress_run_spec"] : [],
        });
      } catch (err) {
        return legacyErrorResult(TOOL, err, ctx.logger);
      }
    },
  );
}

function toSummary(file: string, parsed: ParsedSpec | null): SpecSummary {
  if (!parsed) {
    return { file, tests: 0, describes: [], testNames: [] };
  }

  return {
    file,
    tests: parsed.tests.length,
    describes: parsed.suites.map((suite) => suite.name),
    testNames: parsed.tests.map((test) => test.name),
  };
}
