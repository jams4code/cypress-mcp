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
import { extractDiagnosticSnippet } from "../utils/cypress-diagnostics.js";
import type { Logger } from "../utils/logger.js";

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

  parse(stdout: string, stderr: string, exitCode: number | null): CypressRunResult {
    const cloud = extractCloudRun(`${stdout}\n${stderr}`);
    const json = this.extractJson(stdout);

    const result = json
      ? this.normalizeReport(json)
      : this.createErrorResult(stdout, stderr, exitCode);

    return cloud ? { ...result, cloud } : result;
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

  private normalizeReport(report: MochaJsonReport): CypressRunResult {
    const failed = new Set(report.failures.map((t) => t.fullTitle));
    const pending = new Set(report.pending.map((t) => t.fullTitle));
    const passed = new Set(report.passes.map((t) => t.fullTitle));

    const tests: TestResult[] = report.tests.map((t) => {
      const state = inferState(t, failed, pending, passed);
      const retries = t.currentRetry ?? 0;

      return {
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
    const diagnostic = extractDiagnosticSnippet(stdout, stderr);

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
      error: `Cypress process exited with code ${exitCode ?? "unknown"}. Output: ${diagnostic}`,
      stdoutTail: stdout.trim().slice(-2000) || undefined,
      stderrTail: stderr.trim().slice(-2000) || undefined,
    };
  }
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
