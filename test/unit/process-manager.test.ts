import { describe, it, expect } from "vitest";
import { buildChildEnv, buildCliArgs } from "../../src/services/process-manager.js";
import type { CypressRunArgs } from "../../src/types/cypress.js";

const base: CypressRunArgs = { spec: "cypress/e2e/login.cy.ts" };

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe("buildCliArgs", () => {
  it("builds a plain headless run", () => {
    expect(
      buildCliArgs({ ...base, browser: "chrome", configFile: "cypress.config.ts" }),
    ).toEqual([
      "run",
      "--reporter",
      "json",
      "--spec",
      "cypress/e2e/login.cy.ts",
      "--config-file",
      "cypress.config.ts",
      "--browser",
      "chrome",
    ]);
  });

  it("passes shell metacharacters through as one literal argument", () => {
    const spec = "cypress/e2e/a & calc | b.cy.ts";

    expect(valueAfter(buildCliArgs({ ...base, spec }), "--spec")).toBe(spec);
  });

  it("passes env as one JSON argument so commas, quotes and types survive", () => {
    const env = { user: 'a,"b" & c', port: "3000", baseUrl: "http://x" };
    const json = valueAfter(buildCliArgs({ ...base, env }), "--env");

    expect(JSON.parse(json ?? "")).toEqual(env);
  });

  it("sends grep through --env and --expose when Cypress supports expose", () => {
    const grep = 'fails, & shows "quotes"';
    const args = buildCliArgs({ ...base, grep }, { expose: true });

    expect(JSON.parse(valueAfter(args, "--env") ?? "")).toEqual({ grep });
    expect(JSON.parse(valueAfter(args, "--expose") ?? "")).toEqual({ grep });
  });

  it("omits --expose for Cypress versions that do not know the flag", () => {
    const args = buildCliArgs({ ...base, grep: "login" }, { expose: false });

    expect(args).not.toContain("--expose");
    expect(JSON.parse(valueAfter(args, "--env") ?? "")).toEqual({ grep: "login" });
  });

  it("adds no --env or --expose when there is nothing to pass", () => {
    const args = buildCliArgs(base);

    expect(args).not.toContain("--env");
    expect(args).not.toContain("--expose");
  });

  it("adds Cloud recording flags only when record is true", () => {
    expect(
      buildCliArgs({ ...base, cloud: { record: false, tags: ["x"] } }),
    ).not.toContain("--record");

    const args = buildCliArgs({
      ...base,
      cloud: {
        record: true,
        tags: ["local", "agent"],
        group: "smoke",
        ciBuildId: "build-7",
      },
    });

    expect(args).toContain("--record");
    expect(valueAfter(args, "--tag")).toBe("local,agent");
    expect(valueAfter(args, "--group")).toBe("smoke");
    expect(valueAfter(args, "--ci-build-id")).toBe("build-7");
    expect(args).not.toContain("--key");
  });

  it("rejects tags that would be split by Cypress", () => {
    expect(() =>
      buildCliArgs({ ...base, cloud: { record: true, tags: ["a,b"] } }),
    ).toThrow("Cloud tags");
  });
});

describe("buildChildEnv", () => {
  it("drops an inherited grep so plain runs are not silently filtered", () => {
    const env = buildChildEnv({ CYPRESS_GREP: "stale", cypress_grep: "stale" }, base);

    expect(Object.keys(env).filter((k) => k.toLowerCase() === "cypress_grep")).toEqual(
      [],
    );
  });

  it("keeps the rest of the parent environment", () => {
    expect(buildChildEnv({ PATH: "/usr/bin" }, base)["PATH"]).toBe("/usr/bin");
  });

  it("requires CYPRESS_RECORD_KEY in the environment to record", () => {
    const recordArgs: CypressRunArgs = { ...base, cloud: { record: true } };

    expect(() => buildChildEnv({}, recordArgs)).toThrow("CYPRESS_RECORD_KEY");
    expect(
      buildChildEnv({ CYPRESS_RECORD_KEY: "k" }, recordArgs)["CYPRESS_RECORD_KEY"],
    ).toBe("k");
  });
});
