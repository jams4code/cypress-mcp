import { describe, it, expect } from "vitest";
import type { CypressRunResult } from "../../src/types/results.js";
import {
  buildRunNextActions,
  buildRunSummary,
  enrichRunResult,
} from "../../src/utils/run-results.js";

const baseResult: CypressRunResult = {
  success: false,
  stats: {
    tests: 1,
    passing: 0,
    failing: 1,
    pending: 0,
    skipped: 0,
    flaky: 0,
    duration: 1000,
  },
  tests: [],
  failures: [
    {
      title: "should log in",
      fullTitle: "Login flow should log in",
      error: "Expected login to succeed",
      stack: "",
    },
  ],
  screenshots: [],
  videos: [],
};

describe("run-results helpers", () => {
  it("should attach matching screenshots to failures", () => {
    const enriched = enrichRunResult(baseResult, [
      "C:/tmp/Login flow -- should log in (failed).png",
    ]);

    expect(enriched.failures[0]?.screenshot).toContain("should log in");
    expect(enriched.screenshots).toHaveLength(1);
  });

  it("should summarize pre-test crashes clearly", () => {
    const summary = buildRunSummary(
      {
        ...baseResult,
        error: "Config invalid",
        stats: { ...baseResult.stats, tests: 0, failing: 0 },
      },
      "e2e/login.cy.ts",
    );

    expect(summary).toContain("failed before tests executed");
  });

  it("should point unexplained crashes at the output, then the doctor", () => {
    const nextActions = buildRunNextActions({
      ...baseResult,
      error: "Config invalid",
    });

    expect(nextActions).toEqual(["cypress_get_last_run", "cypress_doctor"]);
  });

  it("should mention flaky tests in the summary", () => {
    const summary = buildRunSummary(
      {
        ...baseResult,
        success: true,
        failures: [],
        stats: { ...baseResult.stats, passing: 3, failing: 0, flaky: 1 },
      },
      "e2e/login.cy.ts",
    );

    expect(summary).toBe("All 3 tests passed in e2e/login.cy.ts (1 flaky)");
  });

  it("should point recorded failures at Cypress Cloud MCP", () => {
    const runUrl = "https://cloud.cypress.io/projects/abc123/runs/42";
    const nextActions = buildRunNextActions({ ...baseResult, cloud: { runUrl } });

    expect(nextActions[0]).toBe("cypress_get_failure_context");
    expect(
      nextActions.some(
        (a) => a.includes("cypress_get_failed_tests") && a.includes(runUrl),
      ),
    ).toBe(true);
  });

  it("should not mention Cloud MCP for local runs", () => {
    expect(buildRunNextActions(baseResult).join(" ")).not.toContain("Cloud");
  });

  it("should send compile errors to the spec, not the doctor", () => {
    const compiled = {
      ...baseResult,
      failures: [],
      error: "Module not found",
      errorKind: "compile" as const,
    };

    expect(buildRunSummary(compiled, "e2e/a.cy.ts")).toContain("did not compile");
    expect(buildRunNextActions(compiled).join(" ")).not.toContain("cypress_doctor");
    expect(buildRunNextActions(compiled)[0]).toContain("cypress_rerun_last");
  });

  it("should name the test that hung in a timeout summary", () => {
    const timedOut = {
      ...baseResult,
      error: "Cypress process timed out after 2000ms",
      errorKind: "timeout" as const,
      runningTest: "Hang never ends",
      stats: { ...baseResult.stats, passing: 1, failing: 0 },
    };

    expect(buildRunSummary(timedOut, "e2e/hang.cy.ts")).toBe(
      'Run timed out while running "Hang never ends" in e2e/hang.cy.ts after 1 passing, 0 failing',
    );
    expect(buildRunNextActions(timedOut)[0]).toContain("data.runningTest");
  });
});
