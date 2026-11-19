import { describe, it, expect } from "vitest";
import {
  buildChildEnv,
  buildCliArgs,
  parseCypressInfoBrowsers,
} from "../../src/services/process-manager.js";
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

  it("leaves --browser out when no browser was asked for", () => {
    // Cypress then uses the project's browser setting instead of Electron.
    expect(buildCliArgs({ ...base, configFile: "cypress.config.ts" })).not.toContain(
      "--browser",
    );
  });

  it("passes the given reporter, json by default", () => {
    const reporter = "/opt/cypress-mcp/reporter/cypress-mcp-reporter.cjs";

    expect(valueAfter(buildCliArgs(base), "--reporter")).toBe("json");
    expect(valueAfter(buildCliArgs(base, { expose: true }, reporter), "--reporter")).toBe(
      reporter,
    );
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

describe("parseCypressInfoBrowsers", () => {
  it("reads names and channels and always allows Electron", () => {
    // Cypress 16.3 on macOS: Electron is not listed but still runs.
    const output = [
      "Displaying Cypress info...",
      "",
      "Detected 1 browser installed:",
      "",
      "1. Chrome",
      "  - Name: chrome",
      "  - Channel: stable",
      "  - Version: 157.0.8103.79",
      "  - Executable: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "",
      "Note: to run these browsers, pass <name>:<channel> to the '--browser' field",
      "",
      "Cypress Version: 16.3.0 (stable)",
    ].join("\n");

    expect(parseCypressInfoBrowsers(output)).toEqual([
      "chrome",
      "chrome:stable",
      "electron",
    ]);
  });

  it("lists every channel of a browser, with Windows line endings", () => {
    const output = [
      "1. Chrome",
      "  - Name: chrome",
      "  - Channel: stable",
      "2. Chrome Beta",
      "  - Name: chrome",
      "  - Channel: beta",
      "3. Edge",
      "  - Name: edge",
      "  - Channel: stable",
    ].join("\r\n");

    expect(parseCypressInfoBrowsers(output)).toEqual([
      "chrome",
      "chrome:beta",
      "chrome:stable",
      "edge",
      "edge:stable",
      "electron",
    ]);
  });

  it("allows only Electron when no browser is detected", () => {
    expect(parseCypressInfoBrowsers("Detected no browsers installed")).toEqual([
      "electron",
    ]);
  });
});

describe("buildCliArgs with a run workspace", () => {
  const base = { spec: "cypress/e2e/a.cy.js", grep: "logs in" };
  const workspace = {
    dir: "/p/node_modules/.cache/cypress-mcp/runs/run_1-9",
    screenshotsDir: "/p/node_modules/.cache/cypress-mcp/runs/run_1-9/screenshots",
    videosDir: "/p/node_modules/.cache/cypress-mcp/runs/run_1-9/videos",
    reportsDir: "/p/node_modules/.cache/cypress-mcp/runs/run_1-9/reports",
    contextFile: "/p/node_modules/.cache/cypress-mcp/runs/run_1-9/context.jsonl",
  };

  it("sends screenshots to the run folder and keeps the reporter and grep without a wrapper", () => {
    const args = buildCliArgs(base, { expose: true }, "/r.cjs", workspace);
    expect(JSON.parse(args[args.indexOf("--config") + 1]!)).toEqual({
      screenshotsFolder: workspace.screenshotsDir,
      videosFolder: workspace.videosDir,
    });
    expect(args).toContain("--reporter");
    expect(args).toContain("--expose");
  });

  it("lets the wrapper set the reporter and filter titles", () => {
    const wrapped = {
      ...workspace,
      wrapperConfigFile: "node_modules/.cache/x/cypress-mcp.config.cjs",
    };
    const args = buildCliArgs(
      { ...base, configFile: "cypress.config.js", component: true },
      { expose: true },
      "/r.cjs",
      wrapped,
    );
    expect(args.slice(0, 2)).toEqual(["run", "--component"]);
    expect(args).not.toContain("--reporter");
    expect(args).not.toContain("--expose");
    expect(args[args.indexOf("--config-file") + 1]).toBe(wrapped.wrapperConfigFile);
  });

  it("tells the reporter where the run folder is", () => {
    const env = buildChildEnv({ MCP_CYPRESS_RUN_DIR: "stale" }, base, workspace);
    expect(env["MCP_CYPRESS_RUN_DIR"]).toBe(workspace.dir);
    expect(
      buildChildEnv({ MCP_CYPRESS_RUN_DIR: "stale" }, base)["MCP_CYPRESS_RUN_DIR"],
    ).toBeUndefined();
  });
});
