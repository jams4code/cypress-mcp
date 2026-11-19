import { describe, it, expect } from "vitest";
import {
  MAX_LISTED_FAILURES,
  MAX_TEXT_CHARS,
  renderRun,
  runHeadline,
} from "../../src/format/compact.js";
import type { RunOutcome } from "../../src/services/run-executor.js";
import type { FailureContext } from "../../src/services/failure-context.js";
import type { RunRecord } from "../../src/services/state-store.js";
import type { CypressRunResult } from "../../src/types/results.js";

const ROOT = "/work/shop";

function record(result: Partial<CypressRunResult>, grep?: string): RunRecord {
  return {
    runId: "run_7",
    kind: grep ? "run_test" : "run_spec",
    spec: "cypress/e2e/big.cy.js",
    specs: ["cypress/e2e/big.cy.js"],
    projectRoot: ROOT,
    prefix: "",
    contextCaptured: true,
    args: { spec: "cypress/e2e/big.cy.js", ...(grep ? { grep } : {}) },
    result: {
      success: true,
      stats: {
        tests: 0,
        passing: 0,
        failing: 0,
        pending: 0,
        skipped: 0,
        flaky: 0,
        duration: 1500,
      },
      tests: [],
      failures: [],
      screenshots: [],
      videos: [],
      ...result,
    },
    stdoutTail: "",
    stderrTail: "",
    timestamp: 0,
  };
}

function failure(index: number, error: string): FailureContext {
  return {
    index,
    spec: "cypress/e2e/big.cy.js",
    title: `case ${index}`,
    fullTitle: `Big suite case ${index}`,
    errorName: "AssertionError",
    error,
    location: `cypress/e2e/big.cy.js:${index + 1}:5`,
    screenshot: `${ROOT}/cypress/screenshots/big.cy.js/Big suite -- case ${index} (failed).png`,
    stack: "",
    stackHint: "",
  };
}

describe("runHeadline", () => {
  it("leaves 0 failed out of a pass and filtered tests out of a testName run", () => {
    const pass = record({
      stats: {
        tests: 3,
        passing: 3,
        failing: 0,
        pending: 0,
        skipped: 0,
        flaky: 0,
        duration: 1500,
      },
    });
    expect(runHeadline({ type: "completed", record: pass })).toBe(
      "PASS cypress/e2e/big.cy.js: 3 passed in 1.5s (runId run_7)",
    );

    const one = record(
      {
        success: false,
        stats: {
          tests: 3,
          passing: 0,
          failing: 1,
          pending: 2,
          skipped: 0,
          flaky: 0,
          duration: 900,
        },
      },
      "case 1",
    );
    expect(runHeadline({ type: "completed", record: one })).toBe(
      'FAIL cypress/e2e/big.cy.js "case 1": 1 failed, 0 passed in 0.9s (runId run_7)',
    );
  });
});

describe("renderRun", () => {
  it("lists the first failures, names the screenshot folder once and counts the rest", () => {
    const failures = Array.from({ length: 45 }, (_, i) =>
      failure(i + 1, `expected ${i} to equal 7`),
    );
    const outcome: RunOutcome = {
      type: "completed",
      record: record({
        success: false,
        stats: {
          tests: 45,
          passing: 0,
          failing: 45,
          pending: 0,
          skipped: 0,
          flaky: 0,
          duration: 1,
        },
      }),
    };

    const text = renderRun(outcome, failures, {
      displayRoot: ROOT,
      nextActions: ["next one"],
    });
    const lines = text.split("\n");

    expect(lines[1]).toBe("screenshots in cypress/screenshots/big.cy.js/");
    expect(lines[2]).toBe("1) Big suite case 1");
    expect(lines[3]).toBe(
      "   cypress/e2e/big.cy.js:2:5 AssertionError: expected 0 to equal 7",
    );
    expect(lines[4]).toBe("   screenshot: Big suite -- case 1 (failed).png");
    expect(text).toContain(
      `${MAX_LISTED_FAILURES}) Big suite case ${MAX_LISTED_FAILURES}`,
    );
    expect(text).not.toContain(`${MAX_LISTED_FAILURES + 1}) Big suite`);
    expect(text).toContain(
      `... ${45 - MAX_LISTED_FAILURES} more failures, listed by cypress_get_failure`,
    );
    expect(lines.at(-1)).toBe("next: next one");
  });

  it("keeps an error to three clipped lines", () => {
    const long = ["first line", "x".repeat(1_000), "third", "fourth", "fifth"].join("\n");
    const text = renderRun(
      { type: "completed", record: record({ success: false }) },
      [failure(1, long)],
      { displayRoot: ROOT, nextActions: [] },
    );

    expect(text).toContain(
      "AssertionError: first line\n   " + "x".repeat(300) + "...\n   third\n   [...]",
    );
    expect(text).not.toContain("fourth");
  });

  it("stays under the inline limit of clients whatever the run", () => {
    const failures = Array.from({ length: 30 }, (_, i) =>
      failure(i + 1, "y".repeat(2_000)),
    );
    const tests = Array.from({ length: 5_000 }, (_, i) => ({
      title: `t${i}`,
      fullTitle: `A very long suite name for test number ${i} that keeps going`,
      state: "passed" as const,
      duration: 12,
      attempts: 1,
      flaky: false,
    }));
    const text = renderRun(
      { type: "completed", record: record({ success: false, tests }) },
      failures,
      { displayRoot: ROOT, verbose: true, nextActions: [] },
    );

    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS + 200);
    expect(text.length).toBeLessThan(50_000);
    expect(text).toContain("the full data is in structuredContent");
  });
});
