// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import { finish } from "../../format/compact.js";
import { READ_ONLY, envelopeSchema, errorResult, textResult } from "../result.js";

const TOOL = "cypress_get_config";

const configDataSchema = z.object({
  projectRoot: z.string(),
  cypressConfigFile: z.string(),
  defaultBrowser: z.string().optional(),
  defaultTimeout: z.number(),
  screenshotsDir: z.string(),
  downloadsDir: z.string(),
  specPattern: z.array(z.string()),
  supportFile: z.union([z.string(), z.literal(false)]).optional(),
  titleFilterSupport: z.boolean(),
  projectId: z.string().optional(),
  cloud: z.object({
    projectId: z.string().nullable(),
    recordKeySet: z.boolean(),
    canRecord: z.boolean(),
  }),
});

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "Show the cypress-mcp config",
      description:
        "Resolved configuration: project root, Cypress config file, browser, timeout, spec pattern, folders, grep support and Cypress Cloud status (projectId, whether a record key is set; the key is never shown).",
      annotations: READ_ONLY,
      outputSchema: envelopeSchema(configDataSchema),
    },
    async () => {
      try {
        const config = await ctx.configLoader.load();
        const recordKeySet = Boolean(process.env["CYPRESS_RECORD_KEY"]);
        const cloud = {
          projectId: config.projectId ?? null,
          // Presence only. The key itself is never returned.
          recordKeySet,
          canRecord: Boolean(config.projectId) && recordKeySet,
        };
        const summary = `Config loaded from ${config.cypressConfigFile}`;
        const lines = [
          `${summary} in ${config.projectRoot}`,
          `specPattern: ${config.specPattern.join(", ")}`,
          `browser: ${config.defaultBrowser ?? "project default"}; timeout: ${config.defaultTimeout} ms`,
          `screenshots: ${config.screenshotsDir}; downloads: ${config.downloadsDir}`,
          `testName filter (@cypress/grep): ${config.titleFilterSupport ? "yes" : "no"}`,
          `cloud: projectId ${cloud.projectId ?? "none"}, record key ${recordKeySet ? "set" : "not set"}`,
        ];

        return textResult(finish(lines, []), {
          ok: true,
          tool: TOOL,
          summary,
          data: {
            ...config,
            specPattern: [...config.specPattern],
            cloud,
          },
          nextActions: [],
        });
      } catch (err) {
        return errorResult(TOOL, err, ctx.logger);
      }
    },
  );
}
