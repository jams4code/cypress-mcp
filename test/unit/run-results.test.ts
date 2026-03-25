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
      { ...baseResult, error: "Config invalid", stats: { ...baseResult.stats, tests: 0, failing: 0 } },
      "e2e/login.cy.ts",
    );

    expect(summary).toContain("failed before tests executed");
  });

  it("should suggest doctor for process-level failures", () => {
    const nextActions = buildRunNextActions({
      ...baseResult,
      error: "Config invalid",
    });

    expect(nextActions).toEqual(["cypress_doctor", "cypress_get_last_run"]);
  });
});
