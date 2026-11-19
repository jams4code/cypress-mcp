import { describe, it, expect } from "vitest";
import {
  excerptAround,
  findFailureLocation,
  findSpecLocation,
} from "../../src/utils/stack-location.js";

describe("findSpecLocation", () => {
  it("reads the spec frame of a Cypress 16 webpack stack", () => {
    // The 0.2.1 excerpt marked line 5 for this failure, from a keyword search.
    const stack =
      'AssertionError: Timed out retrying after 2000ms: Expected to find element: `[data-cy="login-button"]`, but never found it.\n' +
      "    at Context.eval (webpack://shop/./cypress/e2e/checkout.cy.js:10:7)";

    expect(findSpecLocation(stack, "cypress/e2e/checkout.cy.js")).toEqual({
      line: 10,
      column: 7,
    });
  });

  it("prefers the spec frame over support files and Cypress internals", () => {
    const stack = [
      "CypressError: cy.click() failed",
      "    at $Cy.click (https://localhost:1234/__cypress/runner/cypress_runner.js:112650:68)",
      "    at Context.login (webpack:///./cypress/support/commands.ts:12:6)",
      "    at Context.eval (webpack:///./cypress/e2e/login.cy.ts:20:8)",
    ].join("\n");

    expect(findSpecLocation(stack, "cypress/e2e/login.cy.ts")).toEqual({
      line: 20,
      column: 8,
    });
  });

  it("handles encoded paths with spaces, query-style paths and Windows paths", () => {
    expect(
      findSpecLocation(
        "at Context.eval (webpack://p/./cypress/e2e/math%20&%20logic.cy.js:12:5)",
        "cypress/e2e/math & logic.cy.js",
      ),
    ).toEqual({ line: 12, column: 5 });
    expect(
      findSpecLocation(
        "at eval (http://localhost:5173/__cypress/tests?p=cypress/e2e/a.cy.ts:3:1)",
        "cypress/e2e/a.cy.ts",
      ),
    ).toEqual({ line: 3, column: 1 });
    expect(
      findSpecLocation(
        "at Context.eval (C:\\work\\shop\\cypress\\e2e\\a.cy.ts:4:2)",
        "cypress/e2e/a.cy.ts",
      ),
    ).toEqual({ line: 4, column: 2 });
  });

  it("returns undefined when no frame points at the spec", () => {
    expect(
      findSpecLocation(
        "Error: x\n    at Context.login (webpack:///./cypress/support/commands.ts:12:6)",
        "cypress/e2e/a.cy.ts",
      ),
    ).toBeUndefined();
  });
});

describe("excerptAround", () => {
  it("numbers the lines and marks the target", () => {
    const content = ["a", "b", "c", "d"].join("\n");

    expect(excerptAround(content, 2, 1)).toBe("     1: a\n >>> 2: b\n     3: c");
    expect(excerptAround(content, 9)).toBeUndefined();
  });
});

describe("findFailureLocation", () => {
  it("returns the spec frame with the spec path", () => {
    const stack = [
      "CypressError: cy.click() failed",
      "    at Context.login (webpack:///./cypress/support/commands.ts:12:6)",
      "    at Context.eval (webpack://shop/./cypress/e2e/login.cy.ts:20:8)",
    ].join("\n");

    expect(findFailureLocation(stack, "cypress/e2e/login.cy.ts")).toEqual({
      file: "cypress/e2e/login.cy.ts",
      line: 20,
      column: 8,
    });
  });

  it("falls back to the first project file, skipping Cypress and node_modules", () => {
    const stack = [
      "CypressError: Expected to find element: `#user`",
      "    at $Cy.get (https://localhost:4000/__cypress/runner/cypress_runner.js:1:2)",
      "    at helper (webpack://shop/./node_modules/some-lib/index.js:3:4)",
      "    at Context.login (webpack://shop/./cypress/support/commands.js:3:8)",
    ].join("\n");

    expect(findFailureLocation(stack, "cypress/e2e/login.cy.ts")).toEqual({
      file: "cypress/support/commands.js",
      line: 3,
      column: 8,
    });
  });

  it("returns undefined when no frame is in the project", () => {
    const stack =
      "Error: boom\n    at run (https://localhost:4000/__cypress/runner/cypress_runner.js:1:2)";

    expect(findFailureLocation(stack, "cypress/e2e/a.cy.ts")).toBeUndefined();
  });
});
