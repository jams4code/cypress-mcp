import { describe, it, expect } from "vitest";
import {
  classifyConfigRuntimeCheck,
  extractDiagnosticSnippet,
} from "../../src/utils/cypress-diagnostics.js";

describe("cypress diagnostics", () => {
  it("should extract the most useful config error snippet", () => {
    const stdout = [
      "DevTools listening on ws://127.0.0.1:51906/devtools/browser/abc",
      "Your configFile is invalid: C:\\project\\cypress.config.ts",
      "",
      "It threw an error when required, check the stack trace below:",
      "",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\project\\cypress\\cypress.config' imported from C:\\project\\cypress.config.ts",
      "    at finalizeResolution (node:internal/modules/esm/resolve:274:11)",
    ].join("\n");

    const snippet = extractDiagnosticSnippet(stdout, "");

    expect(snippet).toContain("Your configFile is invalid");
    expect(snippet).toContain("ERR_MODULE_NOT_FOUND");
  });

  it("should classify missing-spec output as a successful config load", () => {
    const result = classifyConfigRuntimeCheck(
      1,
      "Can't run because no spec files were found. We searched for specs matching this glob pattern.",
      "",
    );

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("load the config");
  });

  it("should classify invalid config output as a failure", () => {
    const result = classifyConfigRuntimeCheck(
      1,
      "Your configFile is invalid: cypress.config.ts\nError [ERR_MODULE_NOT_FOUND]: Cannot find module",
      "",
    );

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Your configFile is invalid");
  });
});
