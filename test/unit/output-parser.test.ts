import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OutputParser, extractCloudRun } from "../../src/services/output-parser.js";
import { createLogger } from "../../src/utils/logger.js";
import passingFixture from "../fixtures/reporter-output/passing.json";
import failingFixture from "../fixtures/reporter-output/failing.json";
import mixedFixture from "../fixtures/reporter-output/mixed.json";
import flakyFixture from "../fixtures/reporter-output/flaky.json";

const parser = new OutputParser(createLogger(false));
const compileErrorOutput = readFileSync(
  "test/fixtures/cypress-output/compile-error.txt",
  "utf-8",
);

describe("OutputParser", () => {
  it("should parse a fully passing test run", () => {
    const result = parser.parse(JSON.stringify(passingFixture), "", 0);

    expect(result.success).toBe(true);
    expect(result.stats.tests).toBe(2);
    expect(result.stats.passing).toBe(2);
    expect(result.stats.failing).toBe(0);
    expect(result.tests).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
  });

  it("should parse a failing test run", () => {
    const result = parser.parse(JSON.stringify(failingFixture), "", 1);

    expect(result.success).toBe(false);
    expect(result.stats.tests).toBe(1);
    expect(result.stats.failing).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error).toContain("cy.click()");
  });

  it("should parse a mixed test run", () => {
    const result = parser.parse(JSON.stringify(mixedFixture), "", 1);

    expect(result.success).toBe(false);
    expect(result.stats.tests).toBe(3);
    expect(result.stats.passing).toBe(1);
    expect(result.stats.failing).toBe(1);
    expect(result.stats.pending).toBe(1);
  });

  it("should extract JSON from noisy output", () => {
    const noisy = `
Running: login.cy.ts (1 of 1)
${JSON.stringify(passingFixture)}

  (Results)
`;
    const result = parser.parse(noisy, "", 0);

    expect(result.success).toBe(true);
    expect(result.stats.tests).toBe(2);
  });

  it("should handle empty stdout gracefully", () => {
    const result = parser.parse("", "Some error output", 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("exited with code 1");
  });

  it("should handle garbage stdout", () => {
    const result = parser.parse("not json at all {{{", "error", 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should handle null exit code", () => {
    const result = parser.parse("", "", null);

    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown");
  });

  it("should surface config load errors instead of devtools noise", () => {
    const stdout = [
      "DevTools listening on ws://127.0.0.1:51906/devtools/browser/abc",
      "Your configFile is invalid: C:\\project\\cypress.config.ts",
      "",
      "It threw an error when required, check the stack trace below:",
      "",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\project\\cypress\\cypress.config' imported from C:\\project\\cypress.config.ts",
      "    at finalizeResolution (node:internal/modules/esm/resolve:274:11)",
      "DevTools listening on ws://127.0.0.1:51906/devtools/browser/abc",
    ].join("\n");

    const result = parser.parse(stdout, "", 1);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Your configFile is invalid");
    expect(result.error).toContain("ERR_MODULE_NOT_FOUND");
    expect(result.error).not.toContain("Output: DevTools listening");
    expect(result.stdoutTail).toBeDefined();
  });

  it("should flag tests that passed only after a retry as flaky", () => {
    const result = parser.parse(JSON.stringify(flakyFixture), "", 0);

    expect(result.success).toBe(true);
    expect(result.stats.flaky).toBe(1);
    const flaky = result.tests.find((t) => t.flaky);
    expect(flaky?.title).toBe("shows live flight status");
    expect(flaky?.attempts).toBe(3);
    expect(result.tests.find((t) => !t.flaky)?.attempts).toBe(1);
  });

  it("should never mark a failed test as flaky", () => {
    const result = parser.parse(JSON.stringify(failingFixture), "", 1);

    expect(result.stats.flaky).toBe(0);
    expect(result.tests.every((t) => !t.flaky)).toBe(true);
  });

  it("should find the report after unrelated braces in the output", () => {
    const stdout = [
      "Browser console: { theme: 'dark' }",
      "  (Run Starting)",
      JSON.stringify(passingFixture, null, 2),
      "  (Run Finished)",
    ].join("\n");

    const result = parser.parse(stdout, "", 0);

    expect(result.error).toBeUndefined();
    expect(result.stats.passing).toBe(2);
  });

  it("should attach the Cypress Cloud run URL of a recorded run", () => {
    const stdout = [
      JSON.stringify(passingFixture),
      "\u001b[32m  Recorded Run: https://cloud.cypress.io/projects/abc123/runs/42\u001b[39m",
    ].join("\n");

    const result = parser.parse(stdout, "", 0);

    expect(result.cloud).toEqual({
      runUrl: "https://cloud.cypress.io/projects/abc123/runs/42",
      projectId: "abc123",
      runNumber: 42,
    });
  });

  it("should keep the Cloud run URL even when the run crashed", () => {
    const stdout =
      "  Run URL: https://cloud.cypress.io/projects/abc123/runs/43\nError: boom";

    const result = parser.parse(stdout, "", 1);

    expect(result.error).toBeDefined();
    expect(result.cloud?.runNumber).toBe(43);
  });

  it("should not report Cloud info for local runs", () => {
    expect(parser.parse(JSON.stringify(passingFixture), "", 0).cloud).toBeUndefined();
    expect(extractCloudRun("no cloud here")).toBeUndefined();
  });
});

describe("OutputParser compile errors", () => {
  it("puts the bundler's message in error instead of the results table", () => {
    const result = parser.parse(compileErrorOutput, "", 1);

    expect(result.errorKind).toBe("compile");
    expect(result.error).toContain("Can't resolve './does-not-exist'");
    expect(result.error).not.toContain("Compiler.js");
    expect(result.stdoutTail).toContain("Run Finished");
  });
});

describe("OutputParser with report files", () => {
  const report = (spec: string, failed: boolean) => ({
    spec,
    stats: {
      suites: 1,
      tests: 1,
      passes: failed ? 0 : 1,
      pending: 0,
      failures: failed ? 1 : 0,
      start: "",
      end: "",
      duration: 100,
    },
    tests: [
      {
        title: "t",
        fullTitle: `${spec} t`,
        duration: 5,
        currentRetry: 0,
        err: failed ? { message: "boom" } : {},
      },
    ],
    pending: [],
    failures: failed
      ? [
          {
            title: "t",
            fullTitle: `${spec} t`,
            duration: 5,
            err: { message: "boom", stack: "" },
          },
        ]
      : [],
    passes: failed ? [] : [{ title: "t", fullTitle: `${spec} t`, duration: 5, err: {} }],
  });

  it("merges the specs of one launch, each test tagged with its spec", () => {
    const parser = new OutputParser(createLogger(false));
    const result = parser.parse("", "", 1, [
      report("a.cy.js", true),
      report("b.cy.js", false),
    ]);

    expect(result.stats).toMatchObject({
      tests: 2,
      passing: 1,
      failing: 1,
      duration: 200,
    });
    expect(result.failures).toMatchObject([{ spec: "a.cy.js", error: "boom" }]);
    expect(result.tests.map((t) => t.spec)).toEqual(["a.cy.js", "b.cy.js"]);
  });

  it("keeps a spec that did not compile as a failure when others ran", () => {
    const parser = new OutputParser(createLogger(false));
    const stdout = [
      "Oops...we found an error preparing this test file:",
      "  > cypress/e2e/broken.cy.js",
      "Error: Webpack Compilation Error",
      "Module not found: Error: Can't resolve './x'",
    ].join("\n");
    const result = parser.parse(stdout, "", 1, [report("a.cy.js", false)]);

    expect(result.success).toBe(false);
    expect(result.failures).toMatchObject([
      {
        spec: "cypress/e2e/broken.cy.js",
        fullTitle: "cypress/e2e/broken.cy.js did not compile",
      },
    ]);
  });
});
