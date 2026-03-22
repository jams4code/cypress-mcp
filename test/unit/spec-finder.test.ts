import { describe, it, expect } from "vitest";
import path from "node:path";
import { SpecFinder } from "../../src/services/spec-finder.js";
import { createLogger } from "../../src/utils/logger.js";

const fixtureRoot = path.resolve("test/fixtures/cypress-project");
const finder = new SpecFinder(fixtureRoot, createLogger(false));

describe("SpecFinder", () => {
  it("should find spec files in fixture project", async () => {
    const specs = await finder.findSpecs();

    expect(specs.length).toBeGreaterThan(0);
    expect(specs.some((s) => s.includes("sample.cy.ts"))).toBe(true);
  });

  it("should resolve an existing spec file", async () => {
    const resolved = await finder.resolveSpec("cypress/e2e/sample.cy.ts");

    expect(resolved).toContain("sample.cy.ts");
  });

  it("should throw on missing spec", async () => {
    await expect(finder.resolveSpec("nonexistent.cy.ts")).rejects.toThrow(
      "Spec file not found",
    );
  });

  it("should count tests in a spec file", async () => {
    const count = await finder.countTests("cypress/e2e/sample.cy.ts");

    expect(count).toBe(3); // 2 it() + 1 it.skip()
  });
});
