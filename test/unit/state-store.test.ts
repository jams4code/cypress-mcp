import { describe, it, expect } from "vitest";
import { MAX_STORED_RUNS, StateStore } from "../../src/services/state-store.js";
import type { CypressRunResult } from "../../src/types/results.js";
import type { CypressRunArgs } from "../../src/types/cypress.js";

const mockResult: CypressRunResult = {
  success: true,
  stats: {
    tests: 2,
    passing: 2,
    failing: 0,
    pending: 0,
    skipped: 0,
    flaky: 0,
    duration: 5000,
  },
  tests: [],
  failures: [],
  screenshots: ["/path/to/screenshot.png"],
  videos: [],
};

const mockArgs: CypressRunArgs = { spec: "cypress/e2e/spec.cy.ts" };

describe("StateStore", () => {
  it("should return null when no runs recorded", () => {
    const store = new StateStore();
    expect(store.getLastRun()).toBeNull();
  });

  it("should record and retrieve a run with full metadata", () => {
    const store = new StateStore();
    const record = store.recordRun(
      "run_spec",
      "spec.cy.ts",
      mockArgs,
      mockResult,
      "stdout",
      "stderr",
    );

    expect(record.runId).toMatch(/^run_/);
    expect(record.kind).toBe("run_spec");
    expect(record.spec).toBe("spec.cy.ts");
    expect(record.args).toBe(mockArgs);
    expect(record.stdoutTail).toBe("stdout");
    expect(record.stderrTail).toBe("stderr");

    const last = store.getLastRun();
    expect(last).toBe(record);
  });

  it("should return screenshots by spec", () => {
    const store = new StateStore();
    store.recordRun("run_spec", "spec.cy.ts", mockArgs, mockResult, "", "");

    const screenshots = store.getScreenshots("spec.cy.ts");
    expect(screenshots).toHaveLength(1);
    expect(screenshots[0]).toContain("screenshot.png");
  });

  it("should return empty array for unknown spec", () => {
    const store = new StateStore();
    store.recordRun("run_spec", "spec.cy.ts", mockArgs, mockResult, "", "");
    expect(store.getScreenshots("other.cy.ts")).toHaveLength(0);
  });

  it("should clear all state", () => {
    const store = new StateStore();
    store.recordRun("run_spec", "spec.cy.ts", mockArgs, mockResult, "", "");
    store.clear();

    expect(store.getLastRun()).toBeNull();
    expect(store.getScreenshots("spec.cy.ts")).toHaveLength(0);
  });

  it("should preserve original args for rerun", () => {
    const store = new StateStore();
    const args: CypressRunArgs = {
      spec: "cypress/e2e/login.cy.ts",
      browser: "chrome",
      grep: "should login",
    };
    store.recordRun("run_test", "login.cy.ts", args, mockResult, "", "");

    const last = store.getLastRun();
    expect(last?.args.grep).toBe("should login");
    expect(last?.args.browser).toBe("chrome");
  });

  it("should clear stale screenshot entries after a clean rerun", () => {
    const store = new StateStore();
    store.recordRun("run_spec", "spec.cy.ts", mockArgs, mockResult, "", "");

    store.recordRun(
      "run_spec",
      "spec.cy.ts",
      mockArgs,
      { ...mockResult, screenshots: [] },
      "",
      "",
    );

    expect(store.getScreenshots("spec.cy.ts")).toEqual([]);
  });
});

describe("StateStore runs by id", () => {
  it("returns each run by its id and the latest for last", () => {
    const store = new StateStore();
    const first = store.recordRun("run_spec", "a.cy.ts", mockArgs, mockResult, "", "");
    const second = store.recordRun("run_spec", "b.cy.ts", mockArgs, mockResult, "", "");

    expect(store.getRun(first.runId)).toBe(first);
    expect(store.getRun(second.runId)).toBe(second);
    expect(store.getRun("last")).toBe(second);
    expect(store.getRun()).toBe(second);
    expect(store.getRun("run_unknown")).toBeNull();
    expect(store.runIds()).toEqual([second.runId, first.runId]);
  });

  it("keeps the latest runs only", () => {
    const store = new StateStore();
    store.clear();
    for (let i = 0; i < MAX_STORED_RUNS + 5; i++) {
      store.recordRun("run_spec", "a.cy.ts", mockArgs, mockResult, "", "");
    }

    expect(store.runIds()).toHaveLength(MAX_STORED_RUNS);
    expect(store.getRun("run_1")).toBeNull();
    expect(store.getRun(`run_${MAX_STORED_RUNS + 5}`)).not.toBeNull();
  });
});
