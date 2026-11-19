// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import { describeEnv, type EnvObjectShape } from "../../utils/sanitize.js";
import { InvalidArgumentError } from "../../utils/errors.js";
import { finish } from "../../format/compact.js";
import { READ_ONLY, envelopeSchema, errorResult, textResult } from "../result.js";

const TOOL = "cypress_get_env";

const envDataSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  env: z
    .record(z.string(), z.unknown())
    .describe(
      'Key to type: "string", "number", "boolean", "null", "array" or a nested object',
    ),
});

export function register(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    TOOL,
    {
      title: "List cypress.env.json keys",
      description:
        "List the keys in cypress.env.json with the type of each value (string, number, boolean, null, array, or a nested object of keys). Values are never returned, so secrets stay out of the conversation.",
      annotations: READ_ONLY,
      outputSchema: envelopeSchema(envDataSchema),
    },
    async () => {
      try {
        const envPath = path.join(ctx.projectRoot, "cypress.env.json");

        let raw: string;
        try {
          raw = await fs.readFile(envPath, "utf-8");
        } catch {
          // No env file is a normal setup, not an error.
          const summary = "No cypress.env.json in the project";
          return textResult(finish([summary], []), {
            ok: true,
            tool: TOOL,
            summary,
            data: { path: envPath, exists: false, env: {} },
            nextActions: [],
          });
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = undefined;
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new InvalidArgumentError(
            `${envPath} is not a JSON object, so Cypress cannot read it either.`,
          );
        }

        const shape = describeEnv(parsed as Record<string, unknown>);
        const summary = `cypress.env.json has ${Object.keys(shape).length} keys (types only, values are never returned)`;
        return textResult(finish([summary, ...shapeLines(shape, "")], []), {
          ok: true,
          tool: TOOL,
          summary,
          data: { path: envPath, exists: true, env: shape },
          nextActions: [],
        });
      } catch (err) {
        return errorResult(TOOL, err, ctx.logger);
      }
    },
  );
}

function shapeLines(shape: EnvObjectShape, indent: string): string[] {
  return Object.entries(shape).flatMap(([key, value]) =>
    typeof value === "string"
      ? [`${indent}${key}: ${value}`]
      : [`${indent}${key}:`, ...shapeLines(value, `${indent}  `)],
  );
}
