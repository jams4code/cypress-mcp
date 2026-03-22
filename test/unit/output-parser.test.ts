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
});
