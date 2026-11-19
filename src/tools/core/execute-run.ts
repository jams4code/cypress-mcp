// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// Shared code of the legacy run tools (cypress_run_spec, cypress_run_test,
// cypress_rerun_last), enabled with --caps legacy. They return the 0.2.x JSON
// envelope; cypress_run is the compact replacement.
import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import type { ToolContext } from "../../types/index.js";
import type { CypressRunArgs } from "../../types/cypress.js";
import type { RunRecord } from "../../services/state-store.js";
import { executeCypressRun } from "../../services/run-executor.js";
import { buildRunNextActions, buildRunSummary } from "../../utils/run-results.js";
import { progressNotifier } from "../run-shared.js";
import { legacyErrorResult, legacyResult } from "../result.js";

/** Titles listed when run_test matched nothing; enough to pick from without flooding the context. */
const MAX_LISTED_TITLES = 100;

/** Prefix of every legacy tool description. */
export function deprecated(replacement: string, description: string): string {
  return `Deprecated, removed in 0.5: use ${replacement}. ${description}`;
}

interface LegacyRunOptions {
  readonly tool: string;
  readonly kind: RunRecord["kind"];
  readonly specs: readonly string[];
  readonly prefix?: string;
  readonly args: CypressRunArgs;
  readonly testName?: string;
  readonly previousRunId?: string;
  readonly request?: ServerContext;
}

/** Run Cypress, record the run and build the 0.2.x JSON response. */
export async function executeLegacyRun(
  ctx: ToolContext,
  options: LegacyRunOptions,
): Promise<CallToolResult> {
  const { tool, args, testName } = options;
  const spec = options.specs[0] ?? args.spec;
  const progress = progressNotifier(options.request);
  const outcome = await executeCypressRun(ctx, {
    kind: options.kind,
    specs: options.specs,
    args,
    prefix: options.prefix,
    signal: options.request?.mcpReq.signal,
    onProgress: progress.onProgress,
  });
  await progress.flush();
  const { record } = outcome;
  const result = record.result;
  const previous = options.previousRunId ? { previousRunId: options.previousRunId } : {};

  if (outcome.type === "no_match") {
    const query = args.grep ?? "";
    const { titles, closestMatches } = outcome;
    return legacyResult(
      {
        ok: false,
        tool,
        runId: record.runId,
        summary: `No test matched "${query}" in ${spec}: nothing passed or failed, so nothing was tested.`,
        ...previous,
        data: {
          code: "NO_TEST_MATCHED",
          testName: query,
          closestMatches,
          testTitles: titles.slice(0, MAX_LISTED_TITLES),
          ...(titles.length > MAX_LISTED_TITLES ? { testTitleCount: titles.length } : {}),
          stats: result.stats,
        },
        nextActions:
          closestMatches.length > 0
            ? [
                `cypress_run_test with testName set to one of data.closestMatches, e.g. "${closestMatches[0]}"`,
                "cypress_run_spec to run the whole spec",
              ]
            : ["cypress_analyze_spec to see the tests in this spec", "cypress_run_spec"],
      },
      true,
    );
  }

  if (outcome.type === "timeout") {
    return legacyResult(
      {
        ok: false,
        tool,
        runId: record.runId,
        summary: buildRunSummary(result, spec, testName),
        ...previous,
        // code and suggestion as in the error envelope 0.2.1 returned for timeouts
        data: { ...outcome.error.toJSON(), ...result },
        nextActions: buildRunNextActions(result),
      },
      true,
    );
  }

  // A run that never produced a report (compile error, Cypress crash) is a
  // tool error: 0.2.x returned ok: false without isError.
  return legacyResult(
    {
      ok: !result.error,
      tool,
      runId: record.runId,
      summary: buildRunSummary(result, spec, testName),
      ...previous,
      data: result,
      nextActions: buildRunNextActions(result),
    },
    Boolean(result.error),
  );
}

export { legacyErrorResult as toolError };
