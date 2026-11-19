// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import type { ToolContext } from "../types/index.js";
import type { CypressRunArgs } from "../types/cypress.js";
import type { CypressRunResult, FailureDetail, TestResult } from "../types/results.js";
import type { RunRecord } from "./state-store.js";
import type { RunProgress } from "./reporter-events.js";
import type { SpawnResult } from "./process-manager.js";
import { emptyResult, extractCloudRun } from "./output-parser.js";
import {
  cleanupWorkspaces,
  listScreenshots,
  prepareWorkspace,
  readContexts,
  readReports,
  type RunWorkspace,
} from "./run-workspace.js";
import { attachPageContexts } from "./page-context.js";
import {
  InvalidArgumentError,
  TimeoutError,
  TitleFilterUnavailableError,
} from "../utils/errors.js";
import { closestTitles } from "../utils/closest-match.js";
import { enrichRunResult } from "../utils/run-results.js";

export interface RunRequest {
  readonly kind: RunRecord["kind"];
  /** Spec files of the run, project relative, already resolved */
  readonly specs: readonly string[];
  readonly args: CypressRunArgs;
  /** Project folder relative to the server root, for the paths shown */
  readonly prefix?: string;
  /** Aborts the run: a queued run never starts, a running Cypress is killed */
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RunProgress) => void;
}

/**
 * How a run ended. Every outcome is recorded in the state store, so the read
 * tools can inspect it by runId. Setup problems (spec not found, Cypress not
 * installed, cancelled) are thrown as CypressMcpError instead.
 */
export type RunOutcome =
  | { readonly type: "completed"; readonly record: RunRecord }
  | { readonly type: "timeout"; readonly record: RunRecord; readonly error: TimeoutError }
  | {
      readonly type: "no_match";
      readonly record: RunRecord;
      /** Full titles declared in the specs, from the static parser */
      readonly titles: readonly string[];
      readonly closestMatches: readonly string[];
    };

/** Markers of a config load that failed inside the wrapper, not the project. */
const WRAPPER_MARKERS = ["cypress-mcp.config", "cypress-mcp-runtime"];

/**
 * Run Cypress once and record the run. Shared by the MCP tools and the CLI.
 *
 * Runs go through the wrapper config (failure context, title filter, repeat)
 * unless the project turned it off or it failed before for this project. If
 * Cypress cannot load the config through the wrapper, the run is repeated
 * once without it, so a project the wrapper does not suit still runs.
 */
export async function executeCypressRun(
  ctx: ToolContext,
  request: RunRequest,
): Promise<RunOutcome> {
  const config = await ctx.configLoader.load();
  const runId = ctx.stateStore.allocateRunId();
  const warnings: string[] = [];
  const wrap = config.failureContext && ctx.wrapperDisabled === undefined;

  await cleanupWorkspaces(ctx.projectRoot, ctx.logger);

  let attempt = await runOnce(ctx, request, runId, wrap, config);

  if (wrap && attempt.type === "done" && wrapperFailed(attempt)) {
    const reason = firstLine(attempt.result.error ?? "the config did not load");
    ctx.wrapperDisabled = reason;
    ctx.logger.warn("Cypress could not load the config through the cypress-mcp wrapper", {
      reason,
    });
    if (canRunWithoutWrapper(request.args, config.titleFilterSupport)) {
      warnings.push(
        `No failure context for this project: Cypress could not load ${config.cypressConfigFile} through the cypress-mcp wrapper (${reason}), so it ran with the plain config. Later runs skip the wrapper until the server restarts.`,
      );
      attempt = await runOnce(ctx, request, runId, false, config);
    } else {
      warnings.push(
        `Cypress could not load ${config.cypressConfigFile} through the cypress-mcp wrapper (${reason}). This run needs it (repeat, testName without @cypress/grep, or a describe line), so it was not repeated with the plain config.`,
      );
    }
  }

  const { workspace } = attempt;
  if (attempt.type === "timeout") {
    return {
      type: "timeout",
      record: await recordTimedOutRun(
        ctx,
        request,
        runId,
        attempt.error,
        workspace,
        warnings,
      ),
      error: attempt.error,
    };
  }

  const raw = attempt.raw;
  const parsed = attempt.result;
  const screenshots = (await listScreenshots(workspace)).reverse();
  const withPages = attachPageContexts(parsed, await readContexts(workspace));
  const allWarnings = [...warnings, ...raw.warnings];
  const enriched: CypressRunResult = {
    ...enrichRunResult(withPages, screenshots),
    ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
  };

  const record = ctx.stateStore.recordRun(
    request.kind,
    request.specs[0] ?? request.args.spec,
    request.args,
    enriched,
    raw.stdout,
    raw.stderr,
    {
      runId,
      specs: request.specs,
      projectRoot: ctx.projectRoot,
      prefix: request.prefix ?? "",
      contextCaptured: Boolean(workspace.wrapperConfigFile),
    },
  );

  // A title filter that left nothing passed or failed tested nothing. 0.2.1
  // reported this as a pass.
  const filtered = Boolean(request.args.grep) || Boolean(request.args.titles?.length);
  if (
    filtered &&
    !enriched.error &&
    enriched.stats.passing + enriched.stats.failing === 0
  ) {
    const titles: string[] = [];
    for (const spec of request.specs) {
      const declared = await ctx.specFinder.parse(spec);
      titles.push(...(declared?.tests.map((test) => test.fullTitle) ?? []));
    }
    return {
      type: "no_match",
      record,
      titles,
      closestMatches: closestTitles(
        request.args.grep ?? request.args.titles?.[0] ?? "",
        titles,
      ),
    };
  }

  return { type: "completed", record };
}

type Attempt =
  | {
      readonly type: "done";
      readonly workspace: RunWorkspace;
      readonly raw: SpawnResult;
      readonly result: CypressRunResult;
      readonly reports: number;
    }
  | {
      readonly type: "timeout";
      readonly workspace: RunWorkspace;
      readonly error: TimeoutError;
    };

async function runOnce(
  ctx: ToolContext,
  request: RunRequest,
  runId: string,
  wrap: boolean,
  config: { cypressConfigFile: string; titleFilterSupport: boolean },
): Promise<Attempt> {
  const { args } = request;
  if (!wrap) {
    assertRunsWithoutWrapper(args, config.titleFilterSupport);
  }

  const workspace = await prepareWorkspace(ctx.projectRoot, `${runId}-${process.pid}`, {
    configFile: config.cypressConfigFile,
    cypressVersion: wrap ? await ctx.processManager.cypressVersion() : undefined,
    wrap,
    titles: args.titles,
    contains: args.grep,
    repeat: args.repeat,
  });

  // Without the wrapper, @cypress/grep filters: one exact title is passed as
  // its title (a substring match, the closest it has).
  const runArgs: CypressRunArgs =
    !wrap && args.titles?.length === 1 ? { ...args, grep: args.titles[0] } : args;

  let raw: SpawnResult;
  try {
    raw = await ctx.processManager.run(runArgs, {
      signal: request.signal,
      onProgress: request.onProgress,
      workspace,
    });
  } catch (err) {
    if (err instanceof TimeoutError && err.partial) {
      return { type: "timeout", workspace, error: err };
    }
    throw err;
  }

  const reports = await readReports(workspace);
  return {
    type: "done",
    workspace,
    raw,
    result: ctx.outputParser.parse(raw.stdout, raw.stderr, raw.exitCode, reports),
    reports: reports.length,
  };
}

/** No spec reported, not a compile error, and the output points at the wrapper. */
function wrapperFailed(attempt: Extract<Attempt, { type: "done" }>): boolean {
  if (
    attempt.reports > 0 ||
    !attempt.result.error ||
    attempt.result.errorKind === "compile"
  ) {
    return false;
  }
  const output = `${attempt.raw.stdout}\n${attempt.raw.stderr}`;
  return WRAPPER_MARKERS.some((marker) => output.includes(marker));
}

function canRunWithoutWrapper(args: CypressRunArgs, grep: boolean): boolean {
  try {
    assertRunsWithoutWrapper(args, grep);
    return true;
  } catch {
    return false;
  }
}

/**
 * Without the wrapper, title filters need @cypress/grep and repeat is not
 * available. Throws the error the agent can act on.
 */
function assertRunsWithoutWrapper(args: CypressRunArgs, grep: boolean): void {
  if ((args.repeat ?? 1) > 1) {
    throw new InvalidArgumentError(
      "repeat needs failure context, which is off for this project (failureContext: false, or the wrapper config failed to load). Run the test several times instead.",
    );
  }
  if ((args.titles?.length ?? 0) > 1) {
    throw new InvalidArgumentError(
      "A file:line on a describe block needs failure context, which is off for this project. Target one test's line instead.",
    );
  }
  if ((args.grep || args.titles?.length) && !grep) {
    throw new TitleFilterUnavailableError();
  }
}

/** The line that names the error, e.g. "Error: Cannot find module 'x'". */
function firstLine(text: string): string {
  const lines = text
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^Cypress process exited/.test(part));
  const line = lines.find((part) => /^[A-Za-z]*Error\b/.test(part)) ?? lines[0];
  return (line ?? text).slice(0, 200);
}

/**
 * A run killed at its timeout keeps what it did: the tests that finished,
 * their failures and the test that hung are recorded like any other run.
 */
async function recordTimedOutRun(
  ctx: ToolContext,
  request: RunRequest,
  runId: string,
  err: TimeoutError,
  workspace: RunWorkspace,
  warnings: readonly string[],
): Promise<RunRecord> {
  const { kind, args } = request;
  const partial = err.partial!;

  const tests: TestResult[] = partial.completed
    .filter((test) => !test.hook)
    .map((test) => ({
      ...(test.spec ? { spec: test.spec } : {}),
      title: test.title,
      fullTitle: test.fullTitle,
      state: test.state,
      duration: test.duration ?? 0,
      attempts: 1,
      flaky: false,
      ...(test.error ? { error: { message: test.error, stack: test.stack ?? "" } } : {}),
    }));
  const failures: FailureDetail[] = partial.completed
    .filter((test) => test.state === "failed")
    .map((test) => ({
      ...(test.spec ? { spec: test.spec } : {}),
      title: test.title,
      fullTitle: test.fullTitle,
      error: test.error ?? "Unknown error",
      stack: test.stack ?? "",
    }));
  const cloud = extractCloudRun(`${partial.stdout}\n${partial.stderr}`);

  const result: CypressRunResult = {
    ...emptyResult(),
    stats: {
      tests: tests.length,
      passing: tests.filter((test) => test.state === "passed").length,
      failing: failures.length,
      pending: tests.filter((test) => test.state === "pending").length,
      skipped: 0,
      flaky: 0,
      duration: args.timeout ?? 0,
    },
    tests,
    failures,
    error: err.message,
    errorKind: "timeout",
    ...(partial.runningTest ? { runningTest: partial.runningTest } : {}),
    stdoutTail: partial.stdout.trim().slice(-2000) || undefined,
    stderrTail: partial.stderr.trim().slice(-2000) || undefined,
    ...(cloud ? { cloud } : {}),
    ...(warnings.length > 0 ? { warnings: [...warnings] } : {}),
  };

  const screenshots = (await listScreenshots(workspace)).reverse();
  const withPages = attachPageContexts(result, await readContexts(workspace));
  return ctx.stateStore.recordRun(
    kind,
    request.specs[0] ?? args.spec,
    args,
    enrichRunResult(withPages, screenshots),
    partial.stdout,
    partial.stderr,
    {
      runId,
      specs: request.specs,
      projectRoot: ctx.projectRoot,
      prefix: request.prefix ?? "",
      contextCaptured: Boolean(workspace.wrapperConfigFile),
    },
  );
}
