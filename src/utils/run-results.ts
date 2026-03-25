// Copyright (c) 2026 JADEV GROUP SARL. Licensed under BUSL-1.1.
import path from "node:path";
import type { CypressRunResult, FailureDetail } from "../types/results.js";

export function enrichRunResult(
  result: CypressRunResult,
  screenshots: readonly string[],
): CypressRunResult {
  const failures = attachFailureScreenshots(result.failures, screenshots);

  return {
    ...result,
    failures,
    screenshots,
  };
}

export function buildRunSummary(
  result: CypressRunResult,
  spec: string,
  testName?: string,
): string {
  if (result.error) {
    return testName
      ? `Cypress failed before executing "${testName}" in ${spec}`
      : `Cypress failed before tests executed in ${spec}`;
  }

  if (testName) {
    if (result.stats.tests === 0) {
      return `No tests matched "${testName}" in ${spec}`;
    }

    return result.success
      ? `Test "${testName}" passed in ${spec}`
      : `Test "${testName}" failed in ${spec}`;
  }

  if (result.success) {
    return `All ${result.stats.passing} tests passed in ${spec}`;
  }

  return `${result.stats.failing} failing, ${result.stats.passing} passing in ${spec}`;
}

export function buildRunNextActions(
  result: CypressRunResult,
  options?: { includeDiscoverOnSuccess?: boolean },
): string[] {
  if (result.error) {
    return ["cypress_doctor", "cypress_get_last_run"];
  }

  if (result.stats.failing > 0) {
    return ["cypress_get_failure_context", "cypress_get_screenshot"];
  }

  if (options?.includeDiscoverOnSuccess && result.stats.passing > 0) {
    return ["cypress_discover"];
  }

  return [];
}

function attachFailureScreenshots(
  failures: readonly FailureDetail[],
  screenshots: readonly string[],
): FailureDetail[] {
  const remaining = [...screenshots];

  return failures.map((failure) => {
    const matchIndex = remaining.findIndex((file) => matchesFailure(file, failure));
    if (matchIndex === -1) {
      return { ...failure };
    }

    const [screenshot] = remaining.splice(matchIndex, 1);
    return {
      ...failure,
      screenshot,
    };
  });
}

function matchesFailure(file: string, failure: FailureDetail): boolean {
  const fileName = sanitizeValue(path.basename(file));
  const candidates = [failure.fullTitle, failure.title]
    .map(sanitizeValue)
    .filter((value) => value.length > 0);

  return candidates.some((candidate) => fileName.includes(candidate));
}

function sanitizeValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}
