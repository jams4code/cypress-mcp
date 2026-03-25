// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import type { MochaJsonReport } from "../types/cypress.js";
import type {
  CypressRunResult,
  FailureDetail,
  TestResult,
  TestState,
} from "../types/results.js";
import type { Logger } from "../utils/logger.js";

export class OutputParser {
  constructor(private readonly logger: Logger) {}

  parse(stdout: string, stderr: string, exitCode: number | null): CypressRunResult {
    const json = this.extractJson(stdout);

    if (!json) {
      return this.createErrorResult(stdout, stderr, exitCode);
    }

    return this.normalizeReport(json);
  }

  private extractJson(stdout: string): MochaJsonReport | null {
    // Strategy 1: Try parsing the entire stdout as JSON
    try {
      const parsed: unknown = JSON.parse(stdout.trim());
      if (this.isMochaReport(parsed)) return parsed;
    } catch {
      // Not pure JSON, need to extract
    }

    // Strategy 2: Find the outermost JSON object in the output
    const jsonStart = stdout.indexOf("{");
    const jsonEnd = stdout.lastIndexOf("}");

    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      return null;
    }

    // Walk from the first { and find its matching }
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = jsonStart; i <= jsonEnd; i++) {
      const char = stdout[i];

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
          const candidate = stdout.slice(jsonStart, i + 1);
          try {
            const parsed: unknown = JSON.parse(candidate);
            if (this.isMochaReport(parsed)) return parsed;
          } catch {
            this.logger.debug("JSON parse failed for candidate block");
          }
          break;
        }
      }
    }

    // Strategy 3: Try line by line
    const lines = stdout.split("\n");
    for (const line of lines) {
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
    const tests: TestResult[] = report.tests.map((t) => ({
      title: t.title,
      fullTitle: t.fullTitle,
      state: this.inferState(t, report),
      duration: t.duration,
      error: t.err?.message
        ? {
            message: t.err.message,
            stack: t.err.stack ?? "",
            diff:
              t.err.expected !== undefined
                ? `Expected: ${t.err.expected}\nActual: ${t.err.actual}`
                : undefined,
          }
        : undefined,
    }));

    const failures: FailureDetail[] = report.failures.map((t) => ({
      title: t.title,
      fullTitle: t.fullTitle,
      error: t.err?.message ?? "Unknown error",
      stack: t.err?.stack ?? "",
      diff:
        t.err?.expected !== undefined
          ? `Expected: ${t.err.expected}\nActual: ${t.err.actual}`
          : undefined,
    }));

    return {
      success: report.stats.failures === 0,
      stats: {
        tests: report.stats.tests,
        passing: report.stats.passes,
        failing: report.stats.failures,
        pending: report.stats.pending,
        skipped: 0,
        duration: report.stats.duration,
      },
      tests,
      failures,
      screenshots: [],
      videos: [],
    };
  }

  private inferState(
    test: MochaJsonReport["tests"][number],
    report: MochaJsonReport,
  ): TestState {
    if (report.failures.some((f) => f.fullTitle === test.fullTitle)) return "failed";
    if (report.pending.some((p) => p.fullTitle === test.fullTitle)) return "pending";
    if (report.passes.some((p) => p.fullTitle === test.fullTitle)) return "passed";
    return "skipped";
  }

  private createErrorResult(
    stdout: string,
    stderr: string,
    exitCode: number | null,
  ): CypressRunResult {
    // Combine stderr + stdout for the best error message.
    // Cypress writes config errors to stdout on some platforms.
    // Filter out noise like "DevTools listening" and tput warnings.
    const combined = [stderr.trim(), stdout.trim()]
      .filter(Boolean)
      .join("\n");
    const filtered = combined
      .split("\n")
      .filter(
        (l) =>
          !l.includes("DevTools listening") &&
          !l.includes("Opening `/dev/tty`") &&
          !l.includes("tput:") &&
          l.trim().length > 0,
      )
      .join("\n");
    const errorLines = filtered || combined;
    const truncated =
      errorLines.length > 2000 ? errorLines.slice(-2000) : errorLines;

    return {
      success: false,
      stats: {
        tests: 0,
        passing: 0,
        failing: 0,
        pending: 0,
        skipped: 0,
        duration: 0,
      },
      tests: [],
      failures: [],
      screenshots: [],
      videos: [],
      error: `Cypress process exited with code ${exitCode ?? "unknown"}. Output: ${truncated}`,
    };
  }
}
