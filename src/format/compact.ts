// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// Plain text an agent reads instead of JSON: one header line, then a few lines
// per failure. The same data, complete, goes to structuredContent. A 150 test
// spec with 15 failures was 16,000 tokens as pretty JSON in 0.2.x; this keeps
// such a run near 1,000.
import path from "node:path";
import type { RunOutcome } from "../services/run-executor.js";
import type { FailureContext } from "../services/failure-context.js";
import type { RunRecord } from "../services/state-store.js";
import type { TestResult } from "../types/results.js";
import { normalizePath } from "../utils/paths.js";
import { displayPath } from "../services/projects.js";
import { fence, INLINE_OUTLINE_CHARS, pageDetail, pageSummary } from "./page.js";

/** Outline in the page view: what the browser kept, about 3,000 tokens. */
const MAX_PAGE_OUTLINE_CHARS = 12_000;

/**
 * Hard cap on any text result. Claude Code writes results over 50,000
 * characters to a file instead of showing them, and other clients truncate.
 */
export const MAX_TEXT_CHARS = 40_000;

/** Failures listed in a run result; the read tool pages through the rest. */
export const MAX_LISTED_FAILURES = 30;

/** Failures shown with excerpts in one cypress_get_failure call. */
export const FAILURES_PER_PAGE = 10;

const MAX_ERROR_LINES = 3;
const MAX_ERROR_LINE_CHARS = 300;
const MAX_CRASH_LINES = 15;

export type RunStatus = "passed" | "failed" | "error" | "timeout" | "no_match";

export function runStatus(outcome: RunOutcome): RunStatus {
  if (outcome.type === "timeout") return "timeout";
  if (outcome.type === "no_match") return "no_match";
  const { result } = outcome.record;
  if (result.error) return "error";
  return result.stats.failing > 0 ? "failed" : "passed";
}

const STATUS_WORD: Readonly<Record<RunStatus, string>> = {
  passed: "PASS",
  failed: "FAIL",
  error: "ERROR",
  timeout: "TIMEOUT",
  no_match: "NO MATCH",
};

/**
 * What ran, as the agent asked for it: the spec (relative to the server
 * root) or the number of specs, then the test filter, repeat and testing type.
 */
export function runLabel(record: RunRecord): string {
  const { args } = record;
  const parts = [
    record.specs.length > 1
      ? `${record.specs.length} specs`
      : displayPath(record.prefix, record.spec),
  ];
  if (args.grep) parts.push(quote(args.grep));
  else if (args.titles?.length === 1) parts.push(quote(args.titles[0]!));
  else if (args.titles && args.titles.length > 1)
    parts.push(`(${args.titles.length} tests)`);
  if (args.repeat && args.repeat > 1) parts.push(`x${args.repeat}`);
  if (args.component) parts.push("(component)");
  return parts.join(" ");
}

/** The first line of a run result: status, spec, counts, duration, runId. */
export function runHeadline(outcome: RunOutcome): string {
  const { record } = outcome;
  const { result, runId } = record;
  const status = runStatus(outcome);
  const target = runLabel(record);
  const specs =
    record.specs.length > 1
      ? `${record.specs.length} specs`
      : displayPath(record.prefix, record.spec);
  const id = `(runId ${runId})`;

  switch (status) {
    case "no_match":
      return record.args.grep
        ? `${STATUS_WORD[status]} ${specs}: no test title contains "${record.args.grep}", nothing ran ${id}`
        : `${STATUS_WORD[status]} ${specs}: the test at that line did not run, nothing ran ${id}`;
    case "timeout": {
      const where = result.runningTest ? ` while running "${result.runningTest}"` : "";
      return `${STATUS_WORD[status]} ${target}: stopped after ${seconds(result.stats.duration)}${where}; ${counts(record)} before it ${id}`;
    }
    case "error":
      return `${STATUS_WORD[status]} ${target}: ${errorDescription(record)} ${id}`;
    default:
      return `${STATUS_WORD[status]} ${target}: ${counts(record)} in ${seconds(result.stats.duration)} ${id}`;
  }
}

function counts(record: RunRecord): string {
  const { stats } = record.result;
  const parts: string[] = [];
  // "0 failed" says nothing on a pass; on any other status it is the news.
  if (stats.failing > 0 || stats.passing === 0) parts.push(`${stats.failing} failed`);
  parts.push(`${stats.passing} passed`);
  // With a title filter, the tests it left out are reported as pending: noise.
  const filtered = Boolean(record.args.grep) || Boolean(record.args.titles?.length);
  if (stats.pending > 0 && !filtered) parts.push(`${stats.pending} pending`);
  if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`);
  if (stats.flaky > 0) parts.push(`${stats.flaky} flaky`);
  return parts.join(", ");
}

/** Why a run did not complete, in a few words. */
function errorDescription(record: RunRecord): string {
  return record.result.errorKind === "compile"
    ? "the spec did not compile, no test ran"
    : record.result.errorKind === "timeout"
      ? "the run timed out"
      : "Cypress stopped before the tests ran";
}

/**
 * The text of a cypress_run result (and of the CLI). Passing tests are
 * omitted unless `verbose`; flaky ones are always named.
 */
export function renderRun(
  outcome: RunOutcome,
  failures: readonly FailureContext[],
  options: {
    /** Server root: paths shown to the agent are relative to it */
    displayRoot: string;
    verbose?: boolean;
    nextActions: readonly string[];
  },
): string {
  const { record } = outcome;
  const { result } = record;
  const lines = [runHeadline(outcome)];
  for (const warning of result.warnings ?? []) {
    lines.push(`note: ${warning}`);
  }

  if (outcome.type === "no_match") {
    if (outcome.closestMatches.length > 0) {
      lines.push(`closest: ${outcome.closestMatches.map(quote).join(", ")}`);
    } else if (outcome.titles.length > 0) {
      lines.push(
        `tests in the spec: ${outcome.titles.slice(0, 20).map(quote).join(", ")}`,
      );
    }
  }

  if (result.error && outcome.type === "completed") {
    lines.push(...crashLines(result.error));
  }

  if (result.cloud) {
    lines.push(`cloud: ${result.cloud.runUrl}`);
  }

  lines.push(...failureLines(failures, record, options.displayRoot));

  const flaky = result.tests.filter((test) => test.flaky);
  if (flaky.length > 0 && !options.verbose) {
    lines.push(
      `flaky (passed on a retry): ${flaky
        .slice(0, 10)
        .map((test) => `${quote(test.fullTitle)} (${test.attempts} attempts)`)
        .join(", ")}${flaky.length > 10 ? `, and ${flaky.length - 10} more` : ""}`,
    );
  }

  if (options.verbose) {
    lines.push(...testLines(result.tests));
  }

  return finish(lines, options.nextActions);
}

/**
 * One block per failure: title, `file:line:col error`, screenshot, and what
 * the page showed. With a single failure the page block is complete (outline
 * included), so one call is enough to fix it.
 */
function failureLines(
  failures: readonly FailureContext[],
  record: RunRecord,
  displayRoot: string,
): string[] {
  if (failures.length === 0) {
    return [];
  }

  const shown = failures.slice(0, MAX_LISTED_FAILURES);
  const screenshotDir = commonDir(
    shown.flatMap((failure) => (failure.screenshot ? [failure.screenshot] : [])),
  );
  const lines: string[] = [];
  if (screenshotDir) {
    lines.push(`screenshots in ${relative(displayRoot, screenshotDir)}/`);
  }

  for (const failure of shown) {
    lines.push(`${failure.index}) ${failure.fullTitle}`);
    const error = errorText(failure);
    const where = failure.location
      ? `${displayPath(record.prefix, failure.location)} `
      : record.specs.length > 1
        ? `${displayPath(record.prefix, failure.spec)}: `
        : "";
    lines.push(`   ${where}${error}`);
    if (failure.screenshot) {
      const shot = screenshotDir
        ? path.basename(failure.screenshot)
        : relative(displayRoot, failure.screenshot);
      lines.push(`   screenshot: ${shot}`);
    }
    if (failure.page) {
      lines.push(
        ...fence(
          failures.length === 1
            ? pageDetail(failure.page, INLINE_OUTLINE_CHARS)
            : pageSummary(failure.page),
          "   ",
        ),
      );
    }
  }

  if (failures.length > shown.length) {
    lines.push(
      `... ${failures.length - shown.length} more failures, listed by cypress_get_failure`,
    );
  }
  return lines;
}

/** Error class and message, at most three lines, each clipped. */
function errorText(failure: FailureContext): string {
  const message = failure.error
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const kept = message
    .slice(0, MAX_ERROR_LINES)
    .map((line) => clip(line, MAX_ERROR_LINE_CHARS));
  if (message.length > MAX_ERROR_LINES) {
    kept.push("[...]");
  }
  const text = kept.join("\n   ");
  return failure.errorName && !text.startsWith(failure.errorName)
    ? `${failure.errorName}: ${text}`
    : text;
}

/** Cypress's header above a compile error; the status line already says it. */
const COMPILE_HEADER = /^Oops\.\.\.we found an error preparing this test file:?$/;

function crashLines(error: string): string[] {
  const lines = error
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !COMPILE_HEADER.test(line.trim()));
  const kept = lines.slice(0, MAX_CRASH_LINES).map((line) => clip(line, 400));
  if (lines.length > MAX_CRASH_LINES) {
    kept.push("[...]");
  }
  return kept;
}

const STATE_TAG: Readonly<Record<TestResult["state"], string>> = {
  passed: "ok  ",
  failed: "FAIL",
  pending: "skip",
  skipped: "skip",
};

/** Every test, grouped under its spec, for runs of several specs. */
function testLinesBySpec(tests: readonly TestResult[], prefix: string): string[] {
  const lines: string[] = [];
  let current: string | undefined;
  for (const test of tests) {
    if (test.spec !== current) {
      current = test.spec;
      lines.push(`${current ? displayPath(prefix, current) : "(unknown spec)"}:`);
    }
    lines.push(`  ${testLines([test])[0]}`);
  }
  return lines;
}

/** Every test of a run, one line each. */
export function testLines(tests: readonly TestResult[]): string[] {
  return tests.map((test) => {
    const extra = [
      test.duration > 0 ? `${test.duration}ms` : "",
      test.attempts > 1 ? `${test.attempts} attempts` : "",
      test.flaky ? "flaky" : "",
    ]
      .filter(Boolean)
      .join(", ");
    return `${STATE_TAG[test.state]} ${test.fullTitle}${extra ? ` (${extra})` : ""}`;
  });
}

/**
 * The failures view of cypress_get_failure: per failure, the location with
 * its source excerpt, the full error, the diff and the screenshot.
 */
export function renderFailureContexts(
  record: RunRecord,
  failures: readonly FailureContext[],
  options: {
    displayRoot: string;
    first: number;
    total: number;
    nextActions: readonly string[];
  },
): string {
  const { result } = record;
  const what =
    options.total === 0
      ? result.error
        ? errorDescription(record)
        : "no failures"
      : options.total === 1
        ? "1 failure"
        : failures.length === 1
          ? `failure ${options.first} of ${options.total}`
          : `failures ${options.first} to ${options.first + failures.length - 1} of ${options.total}`;
  const lines = [`${runLabel(record)} (runId ${record.runId}): ${what}`];
  for (const warning of result.warnings ?? []) {
    lines.push(`note: ${warning}`);
  }

  if (result.error) {
    lines.push(...crashLines(result.error));
    if (result.runningTest) {
      lines.push(`running when stopped: ${quote(result.runningTest)}`);
    }
  }

  for (const failure of failures) {
    lines.push("", `${failure.index}) ${failure.fullTitle}`);
    if (failure.location)
      lines.push(`at ${displayPath(record.prefix, failure.location)}`);
    else if (record.specs.length > 1)
      lines.push(`in ${displayPath(record.prefix, failure.spec)}`);
    lines.push(
      failure.errorName && !failure.error.startsWith(failure.errorName)
        ? `${failure.errorName}: ${failure.error.trim()}`
        : failure.error.trim(),
    );
    if (failure.diff) lines.push(failure.diff);
    if (failure.excerpt) lines.push(failure.excerpt);
    const frames = failure.stack
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("at "));
    if (frames.length > 1) {
      lines.push(`stack: ${frames.slice(0, 5).join(" | ")}`);
    }
    if (failure.screenshot) {
      lines.push(`screenshot: ${relative(options.displayRoot, failure.screenshot)}`);
    }
    if (failure.page) {
      lines.push(...fence(pageSummary(failure.page), ""));
    }
  }

  return finish(lines, options.nextActions);
}

/** The page view of cypress_get_failure: everything recorded for one failure. */
export function renderPage(
  record: RunRecord,
  failure: FailureContext,
  options: { total: number; nextActions: readonly string[] },
): string {
  const lines = [
    `${runLabel(record)} (runId ${record.runId}): page at failure ${failure.index} of ${options.total}, ${quote(failure.fullTitle)}`,
  ];
  if (failure.location) lines.push(`at ${displayPath(record.prefix, failure.location)}`);
  lines.push(...fence(pageDetail(failure.page!, MAX_PAGE_OUTLINE_CHARS), ""));
  return finish(lines, options.nextActions);
}

export function renderTests(record: RunRecord, nextActions: readonly string[]): string {
  const { result } = record;
  const lines = [
    `${runLabel(record)} (runId ${record.runId}): ${result.stats.tests} tests, ${counts(record)}, ${seconds(result.stats.duration)}`,
    `args: ${JSON.stringify(compactArgs(record))}`,
  ];
  if (result.cloud) lines.push(`cloud: ${result.cloud.runUrl}`);
  if (result.error) lines.push(...crashLines(result.error));
  lines.push(
    ...(record.specs.length > 1
      ? testLinesBySpec(result.tests, record.prefix)
      : testLines(result.tests)),
  );
  return finish(lines, nextActions);
}

export function renderScreenshots(
  record: RunRecord,
  screenshots: readonly string[],
  missing: number,
  options: { displayRoot: string; nextActions: readonly string[] },
): string {
  const lines = [
    `${runLabel(record)} (runId ${record.runId}): ${screenshots.length} screenshot(s) under ${normalizePath(options.displayRoot)}`,
    ...screenshots.map((file) => relative(options.displayRoot, file)),
  ];
  if (missing > 0) {
    lines.push(
      `${missing} screenshot(s) of this run were deleted since: the server keeps the folders of about the last 50 runs`,
    );
  }
  return finish(lines, options.nextActions);
}

export function renderOutput(record: RunRecord, nextActions: readonly string[]): string {
  const lines = [
    `${runLabel(record)} (runId ${record.runId}): last 2,000 characters of Cypress output`,
  ];
  lines.push("--- stdout", record.stdoutTail.trim() || "(empty)");
  lines.push("--- stderr", record.stderrTail.trim() || "(empty)");
  return finish(lines, nextActions);
}

/** The run arguments worth showing; undefined values are left out by JSON.stringify. */
function compactArgs(record: RunRecord): Record<string, unknown> {
  const { args } = record;
  return {
    spec: args.spec,
    testName: args.grep,
    titles: args.titles,
    repeat: args.repeat,
    component: args.component,
    browser: args.browser,
    headed: args.headed || undefined,
    timeout: args.timeout,
    env: args.env && Object.keys(args.env).length > 0 ? Object.keys(args.env) : undefined,
    record: args.cloud?.record || undefined,
  };
}

/** Joins the lines, adds the next-step line and keeps the text under the cap. */
export function finish(lines: readonly string[], nextActions: readonly string[]): string {
  const body = [...lines];
  if (nextActions.length > 0) {
    body.push(`next: ${nextActions.join("; ")}`);
  }
  return capText(body.join("\n"));
}

export function capText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_TEXT_CHARS)}\n[cut at ${MAX_TEXT_CHARS} characters; the full data is in structuredContent]`;
}

export function relative(projectRoot: string, file: string): string {
  const rel = path.relative(projectRoot, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel)
    ? normalizePath(rel)
    : normalizePath(file);
}

/** The directory every file shares, when they are all in the same one. */
function commonDir(files: readonly string[]): string | undefined {
  if (files.length < 2) {
    return undefined;
  }
  const dirs = new Set(files.map((file) => path.dirname(file)));
  return dirs.size === 1 ? [...dirs][0] : undefined;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function quote(value: string): string {
  return JSON.stringify(value);
}
