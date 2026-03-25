import { describe, it, expect } from "vitest";
import { OutputParser } from "../../src/services/output-parser.js";
import { createLogger } from "../../src/utils/logger.js";
import passingFixture from "../fixtures/reporter-output/passing.json";
import failingFixture from "../fixtures/reporter-output/failing.json";
import mixedFixture from "../fixtures/reporter-output/mixed.json";

const parser = new OutputParser(createLogger(false));

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
});
