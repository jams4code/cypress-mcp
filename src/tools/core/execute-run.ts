// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../../types/index.js";
import type { CloudRecordArgs, CypressRunArgs } from "../../types/cypress.js";
import type { RunRecord } from "../../services/state-store.js";
import { CypressMcpError } from "../../utils/errors.js";
import {
  buildRunNextActions,
  buildRunSummary,
  enrichRunResult,
} from "../../utils/run-results.js";

/** Input fields shared by every tool that starts a Cypress run. */
export const runOptionsSchema = {
  browser: z.string().optional().describe("Browser: electron, chrome, firefox, edge"),
  headed: z.boolean().optional().describe("Run in headed mode (visible browser)"),
  timeout: z
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .optional()
    .describe("Timeout in ms (default: 300000)"),
  env: z
    .record(z.string().min(1), z.string())
    .optional()
    .describe(
      "Cypress env values, read in tests with cy.env() (Cypress 15.10+) or Cypress.env()",
    ),
};

/**
 * Cypress Cloud recording. The record key never appears here: Cypress reads
 * CYPRESS_RECORD_KEY from the server environment.
 */
export const cloudOptionsSchema = {
  record: z
    .boolean()
    .optional()
    .describe(
      "Record this run to Cypress Cloud (needs projectId and CYPRESS_RECORD_KEY). The result includes the Cloud run URL, which Cypress Cloud MCP tools accept.",
    ),
  tags: z
    .array(
      z
        .string()
        .min(1)
        .max(100)
        .regex(/^[^,]+$/, "Tags cannot contain commas"),
    )
    .max(20)
    .optional()
    .describe("Cloud run tags, e.g. ['local', 'agent']"),
  group: z.string().min(1).max(200).optional().describe("Cloud run group name"),
  ciBuildId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Cloud build id, to attach several recorded runs to one Cloud run"),
};

export function toCloudArgs(input: {
  record?: boolean;
  tags?: string[];
  group?: string;
  ciBuildId?: string;
}): CloudRecordArgs | undefined {
  if (!input.record) {
    return undefined;
  }
  return {
    record: true,
    tags: input.tags,
    group: input.group,
    ciBuildId: input.ciBuildId,
  };
}

interface ExecuteRunOptions {
  readonly tool: string;
  readonly kind: RunRecord["kind"];
  readonly spec: string;
  readonly args: CypressRunArgs;
  readonly testName?: string;
  readonly previousRunId?: string;
  readonly includeDiscoverOnSuccess?: boolean;
}

/** Run Cypress, record the run in session state and build the tool response. */
export async function executeRun(
  ctx: ToolContext,
  options: ExecuteRunOptions,
): Promise<CallToolResult> {
  const { tool, kind, spec, args, testName } = options;

  const raw = await ctx.processManager.run(args);
  const result = ctx.outputParser.parse(raw.stdout, raw.stderr, raw.exitCode);

  const screenshots = await ctx.screenshotResolver.find(spec, testName);
  const enriched = enrichRunResult(
    result,
    screenshots.length > 0 ? screenshots : result.screenshots,
  );

  const record = ctx.stateStore.recordRun(
    kind,
    spec,
    args,
    enriched,
    raw.stdout,
    raw.stderr,
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: !enriched.error,
            tool,
            runId: record.runId,
            summary: buildRunSummary(enriched, spec, testName),
            ...(options.previousRunId ? { previousRunId: options.previousRunId } : {}),
            data: enriched,
            nextActions: buildRunNextActions(enriched, {
              includeDiscoverOnSuccess: options.includeDiscoverOnSuccess,
            }),
          },
          null,
          2,
        ),
      },
    ],
  };
}

/** Standard error envelope for known failures; unknown errors are rethrown. */
export function toolError(tool: string, err: unknown): CallToolResult {
  if (!(err instanceof CypressMcpError)) {
    throw err;
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ok: false,
          tool,
          summary: err.message,
          data: err.toJSON(),
          nextActions: ["cypress_doctor"],
        }),
      },
    ],
    isError: true,
  };
}
