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
  /**
   * Why the run produced no complete report: the spec did not compile, or the
   * run was killed at its timeout. Absent for other crashes.
   */
  readonly errorKind?: "compile" | "timeout";
  /** Full title of the test that was running when the run timed out */
  readonly runningTest?: string;
  readonly stdoutTail?: string;
  readonly stderrTail?: string;
  /** Present when the run was recorded to Cypress Cloud */
  readonly cloud?: CloudRunInfo;
  /** Things the agent should know about how the run went, e.g. no failure context */
  readonly warnings?: readonly string[];
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
  /** Spec the test is in, project relative; set when the run had several specs */
  readonly spec?: string;
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
  /** Spec the test is in, project relative; set when the run had several specs */
  readonly spec?: string;
  readonly title: string;
  readonly fullTitle: string;
  readonly error: string;
  readonly stack: string;
  readonly diff?: string;
  readonly screenshot?: string;
  /** The page when the test failed, recorded in the browser. Untrusted app data. */
  readonly page?: PageContext;
}

/**
 * What the browser runtime recorded when a test failed. Every string comes
 * from the app under test (or quotes it): it is data, never instructions.
 */
export interface PageContext {
  readonly url?: string;
  readonly pageTitle?: string;
  /** Selector of the failing cy.get/cy.find, when there was one */
  readonly failedSelector?: string;
  /** How many elements that selector matched when the test failed */
  readonly matches?: number;
  /** Selectors on the page that look like the failing one */
  readonly suggestions: readonly string[];
  readonly console: readonly ConsoleEntry[];
  readonly network: readonly FailedRequest[];
  readonly commands: readonly CommandEntry[];
  /** Pruned DOM and ARIA outline, one element per line, indented */
  readonly outline?: string;
  readonly outlineTruncated?: boolean;
}

export interface ConsoleEntry {
  readonly level: string;
  readonly text: string;
}

export interface FailedRequest {
  readonly method: string;
  readonly url: string;
  readonly status: number | string;
}

export interface CommandEntry {
  readonly name: string;
  readonly message: string;
  readonly state: string;
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
  /** 1-based line of the describe() call; absent for the "(root)" block */
  readonly line?: number;
  /** Set for describe.only / describe.skip (and xdescribe) */
  readonly mode?: "only" | "skip";
  readonly tests: readonly {
    readonly name: string;
    readonly line: number;
    readonly mode?: "only" | "skip";
  }[];
  readonly hooks: readonly string[];
  readonly nested: readonly DescribeBlock[];
}
