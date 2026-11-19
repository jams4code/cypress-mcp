// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import { assertPlainGlob } from "../../services/spec-finder.js";
import { finish } from "../../format/compact.js";
import { displayPath, ProjectRequiredError } from "../../services/projects.js";
import path from "node:path";
import { READ_ONLY, envelopeSchema, errorResult, textResult } from "../result.js";

const TOOL = "cypress_list_specs";

const listDataSchema = z.object({
  pattern: z.array(z.string()),
  total: z.number().describe("Number of specs"),
  totalTests: z.number(),
  specs: z.array(
    z.object({
      file: z.string(),
      tests: z.number(),
      titles: z.array(z.string()).optional(),
    }),
  ),
});

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "List Cypress specs",
      description:
        "List spec files with their test counts, read statically (nothing runs). titles: true adds each test's full title, the text testName matches. In a monorepo, lists every project's specs.",
      inputSchema: z.object({
        pattern: z
          .string()
          .optional()
          .describe(
            "Glob relative to the project root. Default: the project's specPattern",
          ),
        titles: z.boolean().optional().describe("Include test titles"),
        project: z
          .string()
          .optional()
          .describe("Monorepos: one project folder. Default: every project"),
      }),
      outputSchema: envelopeSchema(listDataSchema),
      annotations: READ_ONLY,
    },
    async ({ pattern, titles, project }) => {
      try {
        // Only the caller's pattern is checked; the project's own specPattern is trusted.
        if (pattern !== undefined) assertPlainGlob(pattern);
        const projects = await projectsToList(ctx, project);

        const patterns = new Set<string>();
        const specs: { file: string; tests: number; titles?: string[] }[] = [];
        for (const { ctx: projectCtx, prefix } of projects) {
          const config = await projectCtx.configLoader.load();
          const projectPatterns =
            pattern === undefined ? [...config.specPattern] : [pattern];
          projectPatterns.forEach((p) => patterns.add(displayPath(prefix, p)));
          const files = await projectCtx.specFinder.findSpecs(projectPatterns);
          for (const file of files) {
            const parsed = await projectCtx.specFinder.parse(file);
            const tests = parsed?.tests ?? [];
            specs.push({
              file: displayPath(prefix, file),
              tests: tests.length,
              ...(titles ? { titles: tests.map((test) => test.fullTitle) } : {}),
            });
          }
        }
        const totalTests = specs.reduce((sum, spec) => sum + spec.tests, 0);

        const where =
          projects.length > 1
            ? `${projects.length} projects (${projects.map((p) => p.prefix || ".").join(", ")})`
            : [...patterns].join(", ");
        const summary = `${specs.length} spec(s), ${totalTests} test(s) in ${where}`;
        const lines = [summary];
        for (const spec of specs) {
          lines.push(`${spec.file}: ${spec.tests}`);
          for (const title of spec.titles ?? []) {
            lines.push(`  ${title}`);
          }
        }
        const nextActions =
          specs.length === 0
            ? ["check the pattern, or the specPattern in the Cypress config"]
            : [];

        return textResult(finish(lines, nextActions), {
          ok: true,
          tool: TOOL,
          summary,
          data: { pattern: [...patterns], total: specs.length, totalTests, specs },
          nextActions,
        });
      } catch (err) {
        return errorResult(TOOL, err, ctx.logger);
      }
    },
  );
}

/**
 * The project asked for; else the server root's; else every project under it
 * (a monorepo root has no config of its own).
 */
async function projectsToList(
  ctx: ToolContext,
  project: string | undefined,
): Promise<{ ctx: ToolContext; prefix: string }[]> {
  try {
    const selection = await ctx.projects.select({ project });
    return [selection];
  } catch (err) {
    if (!(err instanceof ProjectRequiredError) || err.code !== "PROJECT_REQUIRED") {
      throw err;
    }
    const folders = await ctx.projects.discover();
    return folders.map((folder) => {
      const projectRoot = path.join(ctx.serverRoot, folder);
      return {
        ctx: ctx.projects.context(projectRoot),
        prefix: folder === "." ? "" : folder,
      };
    });
  }
}
