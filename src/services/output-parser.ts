// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import type { MochaJsonReport, MochaTest } from "../types/cypress.js";
import type {
  CloudRunInfo,
  CypressRunResult,
  FailureDetail,
  TestResult,
  TestState,
} from "../types/results.js";
import {
  extractCompileError,
  extractDiagnosticSnippet,
} from "../utils/cypress-diagnostics.js";
import type { Logger } from "../utils/logger.js";
import type { SpecReport } from "./run-workspace.js";

const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Cypress prints this line at the end of a recorded run. */
const RECORDED_RUN_PATTERN = /Recorded Run:\s+(https?:\/\/\S+)/;
/** Printed at the start of a recorded run; used when the run is cut short. */
const RUN_URL_PATTERN = /Run URL:\s+(https?:\/\/\S+)/;
const CLOUD_RUN_PATH_PATTERN = /\/projects\/([^/\s]+)\/runs\/(\d+)/;

/** Where a Mocha JSON report can start in mixed Cypress output. */
const REPORT_START_PATTERN = /\{\s*"stats"\s*:/g;

export class OutputParser {
  constructor(private readonly logger: Logger) {}

  /**
   * Results of a run. `reports` are the per-spec files the reporter wrote to
   * the run folder; without them (an older run layout, a crash before any
   * spec ran) the report is looked for in stdout.
   */
  parse(
    stdout: string,
    stderr: string,
    exitCode: number | null,
    reports: readonly SpecReport[] = [],
  ): CypressRunResult {
    const cloud = extractCloudRun(`${stdout}\n${stderr}`);

    let result: CypressRunResult;
    if (reports.length > 0) {
      result = this.mergeReports(reports, stdout, stderr);
    } else {
      const json = this.extractJson(stdout);
      result = json
        ? this.normalizeReport(json)
        : this.createErrorResult(stdout, stderr, exitCode);
    }

    return cloud ? { ...result, cloud } : result;
  }

  /**
   * One result for every spec of the run. A spec that did not compile writes
   * no report; when others did, it becomes a failure so it is not lost.
   */
  private mergeReports(
    reports: readonly SpecReport[],
    stdout: string,
    stderr: string,
  ): CypressRunResult {
    const parts = reports.map((report) => this.normalizeReport(report, report.spec));
    const failures = parts.flatMap((part) => part.failures);

    const compileError = extractCompileError(stdout, stderr);
    if (compileError) {
      const spec = /^\s*>\s*(\S.*)$/m.exec(compileError)?.[1]?.trim();
      failures.push({
        ...(spec ? { spec } : {}),
        title: "the spec did not compile",
        fullTitle: `${spec ?? "A spec"} did not compile`,
        error: compileError,
        stack: "",
      });
    }

    const sum = (key: keyof CypressRunResult["stats"]): number =>
      parts.reduce((total, part) => total + part.stats[key], 0);
    return {
      success: failures.length === 0,
      stats: {
        tests: sum("tests"),
        passing: sum("passing"),
        failing: failures.length,
        pending: sum("pending"),
        skipped: sum("skipped"),
        flaky: sum("flaky"),
        duration: sum("duration"),
      },
      tests: parts.flatMap((part) => part.tests),
      failures,
      screenshots: [],
      videos: [],
    };
  }

  private extractJson(stdout: string): MochaJsonReport | null {
    // Strategy 1: the whole of stdout is the report
    try {
      const parsed: unknown = JSON.parse(stdout.trim());
      if (this.isMochaReport(parsed)) return parsed;
    } catch {
      // Not pure JSON, need to extract
    }

    // Strategy 2: every place a report could start. Cypress and the app under
    // test can print other braces first, so the first "{" is not reliable.
    for (const match of stdout.matchAll(REPORT_START_PATTERN)) {
      const report = this.parseBalancedObject(stdout, match.index);
      if (report) return report;
    }

    // Strategy 3: the outermost object starting at the first "{"
    const firstBrace = stdout.indexOf("{");
    if (firstBrace !== -1) {
      const report = this.parseBalancedObject(stdout, firstBrace);
      if (report) return report;
    }

    // Strategy 4: a single-line report
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (this.isMochaReport(parsed)) return parsed;
      } catch {
        // Not valid JSON
      }
    }

    return null;
  }

  /** Parse the JSON object that opens at `start`, matching braces outside strings. */
  private parseBalancedObject(text: string, start: number): MochaJsonReport | null {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === "{") depth++;
      if (char === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed: unknown = JSON.parse(text.slice(start, i + 1));
            return this.isMochaReport(parsed) ? parsed : null;
          } catch {
            this.logger.debug("JSON parse failed for candidate block");
            return null;
          }
        }
      }
    }

    return null;
  }

  private isMochaReport(value: unknown): value is MochaJsonReport {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return (
      typeof obj["stats"] === "object" &&
      obj["stats"] !== null &&
      Array.isArray(obj["tests"])
    );
  }

  private normalizeReport(report: MochaJsonReport, spec?: string): CypressRunResult {
    const inSpec = spec ? { spec } : {};
    const failed = new Set(report.failures.map((t) => t.fullTitle));
    const pending = new Set(report.pending.map((t) => t.fullTitle));
    const passed = new Set(report.passes.map((t) => t.fullTitle));

    const tests: TestResult[] = report.tests.map((t) => {
      const state = inferState(t, failed, pending, passed);
      const retries = t.currentRetry ?? 0;

      return {
        ...inSpec,
        title: t.title,
        fullTitle: t.fullTitle,
        state,
        duration: t.duration ?? 0,
        attempts: retries + 1,
        flaky: state === "passed" && retries > 0,
        error: t.err?.message
          ? {
              message: t.err.message,
              stack: t.err.stack ?? "",
              diff: formatDiff(t),
            }
          : undefined,
      };
    });

    const failures: FailureDetail[] = report.failures.map((t) => ({
      ...inSpec,
      title: t.title,
      fullTitle: t.fullTitle,
      error: t.err?.message ?? "Unknown error",
      stack: t.err?.stack ?? "",
      diff: formatDiff(t),
    }));

    return {
      success: report.stats.failures === 0,
      stats: {
        tests: report.stats.tests,
        passing: report.stats.passes,
        failing: report.stats.failures,
        pending: report.stats.pending,
        skipped: tests.filter((t) => t.state === "skipped").length,
        flaky: tests.filter((t) => t.flaky).length,
        duration: report.stats.duration,
      },
      tests,
      failures,
      screenshots: [],
      videos: [],
    };
  }

  private createErrorResult(
    stdout: string,
    stderr: string,
    exitCode: number | null,
  ): CypressRunResult {
    const stdoutTail = stdout.trim().slice(-2000) || undefined;
    const stderrTail = stderr.trim().slice(-2000) || undefined;

    // The cause of a compile error sits above the results table and is lost
    // from the tails, so it is lifted into `error`.
    const compileError = extractCompileError(stdout, stderr);
    if (compileError) {
      return {
        ...emptyResult(),
        error: compileError,
        errorKind: "compile",
        stdoutTail,
        stderrTail,
      };
    }

    const diagnostic = extractDiagnosticSnippet(stdout, stderr);

    return {
      ...emptyResult(),
      error: `Cypress process exited with code ${exitCode ?? "unknown"}. Output: ${diagnostic}`,
      stdoutTail,
      stderrTail,
    };
  }
}

/** A result with no tests, for runs that never produced a report. */
export function emptyResult(): CypressRunResult {
  return {
    success: false,
    stats: {
      tests: 0,
      passing: 0,
      failing: 0,
      pending: 0,
      skipped: 0,
      flaky: 0,
      duration: 0,
    },
    tests: [],
    failures: [],
    screenshots: [],
    videos: [],
  };
}

/** Find the Cypress Cloud run URL that `cypress run --record` prints. Exported for tests. */
export function extractCloudRun(output: string): CloudRunInfo | undefined {
  const clean = output.replace(ANSI_PATTERN, "");
  const match = RECORDED_RUN_PATTERN.exec(clean) ?? RUN_URL_PATTERN.exec(clean);
  const runUrl = match?.[1];
  if (!runUrl) {
    return undefined;
  }

  const pathMatch = CLOUD_RUN_PATH_PATTERN.exec(runUrl);
  const runNumber = pathMatch?.[2] ? Number(pathMatch[2]) : undefined;

  return {
    runUrl,
    projectId: pathMatch?.[1],
    runNumber: Number.isFinite(runNumber) ? runNumber : undefined,
  };
}

function inferState(
  test: MochaTest,
  failed: ReadonlySet<string>,
  pending: ReadonlySet<string>,
  passed: ReadonlySet<string>,
): TestState {
  if (failed.has(test.fullTitle)) return "failed";
  if (pending.has(test.fullTitle)) return "pending";
  if (passed.has(test.fullTitle)) return "passed";
  return "skipped";
}

function formatDiff(test: MochaTest): string | undefined {
  return test.err?.expected !== undefined
    ? `Expected: ${test.err.expected}\nActual: ${test.err.actual}`
    : undefined;
}
