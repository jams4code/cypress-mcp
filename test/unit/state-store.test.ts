import { describe, it, expect } from "vitest";
import { StateStore } from "../../src/services/state-store.js";
import type { CypressRunResult } from "../../src/types/results.js";
import type { CypressRunArgs } from "../../src/types/cypress.js";

const mockResult: CypressRunResult = {
  success: true,
  stats: { tests: 2, passing: 2, failing: 0, pending: 0, skipped: 0, duration: 5000 },
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
      "run_spec", "spec.cy.ts", mockArgs, mockResult, "stdout", "stderr",
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
});
