// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
/** Normalized result from a Cypress test run */
export interface CypressRunResult {
  readonly success: boolean;
  readonly stats: RunStats;
  readonly tests: readonly TestResult[];
  readonly failures: readonly FailureDetail[];
  readonly screenshots: readonly string[];
  readonly videos: readonly string[];
  readonly error?: string;
  readonly stdoutTail?: string;
  readonly stderrTail?: string;
  /** Present when the run was recorded to Cypress Cloud */
  readonly cloud?: CloudRunInfo;
}

/**
 * Where a recorded run lives in Cypress Cloud. `runUrl` is accepted as-is by
 * Cypress Cloud MCP tools (cypress_get_runs, cypress_get_failed_tests, ...).
 */
export interface CloudRunInfo {
  readonly runUrl: string;
  readonly projectId?: string;
  readonly runNumber?: number;
}

export interface RunStats {
  readonly tests: number;
  readonly passing: number;
  readonly failing: number;
  readonly pending: number;
  readonly skipped: number;
  /** Tests that passed only after one or more retries */
  readonly flaky: number;
  readonly duration: number;
}

export type TestState = "passed" | "failed" | "pending" | "skipped";

export interface TestResult {
  readonly title: string;
  readonly fullTitle: string;
  readonly state: TestState;
  readonly duration: number;
  /** Attempts made, including retries (Cypress `retries` config) */
  readonly attempts: number;
  /** Passed after failing at least once: the same rule Cypress Cloud uses */
  readonly flaky: boolean;
  readonly error?: TestError;
}

export interface TestError {
  readonly message: string;
  readonly stack: string;
  readonly diff?: string;
}

export interface FailureDetail {
  readonly title: string;
  readonly fullTitle: string;
  readonly error: string;
  readonly stack: string;
  readonly diff?: string;
  readonly screenshot?: string;
}

/** Discovery result for cypress_discover */
export interface DiscoveryResult {
  readonly projectRoot: string;
  readonly configFile: string;
  readonly specCount: number;
  readonly totalTests: number;
  readonly specs: readonly SpecSummary[];
}

export interface SpecSummary {
  readonly file: string;
  readonly tests: number;
  readonly describes: readonly string[];
  readonly testNames: readonly string[];
}

/** Detailed analysis of a single spec file */
export interface SpecAnalysis {
  readonly file: string;
  readonly structure: {
    readonly describes: readonly DescribeBlock[];
  };
  readonly visits: readonly string[];
  readonly intercepts: readonly string[];
  readonly fixtures: readonly string[];
  readonly customCommands: readonly string[];
}

export interface DescribeBlock {
  readonly name: string;
  readonly tests: readonly { readonly name: string; readonly line: number }[];
  readonly hooks: readonly string[];
  readonly nested: readonly DescribeBlock[];
}
