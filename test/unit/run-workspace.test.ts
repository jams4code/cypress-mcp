import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanupWorkspaces,
  moduleKind,
  prepareWorkspace,
  readContexts,
  readReports,
  RUNS_DIR,
  typescriptLoader,
  wrapperSource,
} from "../../src/services/run-workspace.js";
import { createLogger } from "../../src/utils/logger.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-mcp-workspace-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("moduleKind", () => {
  it("mirrors how Node and Cypress load the project's config", () => {
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    expect(moduleKind(path.join(root, "cypress.config.js"))).toEqual({
      esm: true,
      wrapperExtension: ".mjs",
      syntax: "import",
    });
    expect(moduleKind(path.join(root, "cypress.config.ts"))).toMatchObject({
      esm: true,
      wrapperExtension: ".ts",
    });
    expect(moduleKind(path.join(root, "cypress.config.cjs"))).toMatchObject({
      esm: false,
      syntax: "require",
    });

    fs.writeFileSync(path.join(root, "package.json"), "{}");
    expect(moduleKind(path.join(root, "cypress.config.js"))).toEqual({
      esm: false,
      wrapperExtension: ".cjs",
      syntax: "require",
    });
    expect(moduleKind(path.join(root, "cypress.config.ts"))).toMatchObject({
      esm: false,
      wrapperExtension: ".ts",
      syntax: "import",
    });
    expect(moduleKind(path.join(root, "cypress.config.mts"))).toMatchObject({
      esm: true,
    });
  });

  it("writes a JavaScript wrapper for TypeScript configs on Cypress 14 (ts-node)", () => {
    expect(typescriptLoader("14.5.4")).toBe("ts-node");
    expect(typescriptLoader("15.0.0")).toBe("tsx");
    expect(typescriptLoader(undefined)).toBe("tsx");

    fs.writeFileSync(path.join(root, "package.json"), "{}");
    expect(moduleKind(path.join(root, "cypress.config.ts"), "ts-node")).toEqual({
      esm: false,
      wrapperExtension: ".cjs",
      syntax: "require",
    });
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    expect(moduleKind(path.join(root, "cypress.config.ts"), "ts-node")).toEqual({
      esm: true,
      wrapperExtension: ".mjs",
      syntax: "import",
    });
  });
});

describe("wrapperSource", () => {
  it("imports the project's config and passes it to the runtime", () => {
    const esm = wrapperSource("../../cypress.config.ts", { runDir: "/r" }, "import");
    expect(esm).toContain('import userConfig from "../../cypress.config.ts";');
    expect(esm).toContain("export default runtime.wrapConfig(userConfig, {");

    const cjs = wrapperSource("../../cypress.config.js", { runDir: "/r" }, "require");
    expect(cjs).toContain('const loaded = require("../../cypress.config.js");');
    expect(cjs).toContain(
      "module.exports = runtime.wrapConfig(loaded && loaded.default ? loaded.default : loaded,",
    );
  });
});

describe("prepareWorkspace", () => {
  it("writes the wrapper, the runtime and the browser options into the run folder", async () => {
    fs.writeFileSync(path.join(root, "cypress.config.ts"), "export default {};");
    const workspace = await prepareWorkspace(root, "run_3-42", {
      configFile: "cypress.config.ts",
      wrap: true,
      titles: ["A b"],
      repeat: 2,
    });

    expect(workspace.dir).toBe(path.join(root, RUNS_DIR, "run_3-42"));
    expect(workspace.wrapperConfigFile).toBe(
      "node_modules/.cache/cypress-mcp/runs/run_3-42/cypress-mcp.config.ts",
    );
    expect(fs.existsSync(path.join(workspace.dir, "cypress-mcp-runtime.cjs"))).toBe(true);
    const firstLine = fs
      .readFileSync(path.join(workspace.dir, "support-runtime.js"), "utf-8")
      .split("\n")[0];
    expect(firstLine).toBe(
      'globalThis.__cypressMcp = {"task":"cypressMcp:failureContext","filter":{"titles":["A b"]},"repeat":2,"maxOutlineChars":12000};',
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(workspace.dir, "package.json"), "utf-8")),
    ).toEqual({
      private: true,
      type: "commonjs",
    });
  });

  it("writes no wrapper when failure context is off", async () => {
    const workspace = await prepareWorkspace(root, "run_4-42", {
      configFile: "cypress.config.js",
      wrap: false,
    });
    expect(workspace.wrapperConfigFile).toBeUndefined();
    expect(fs.readdirSync(workspace.dir)).toEqual([]);
  });

  it("reads reports in run order and skips cut-off lines", async () => {
    const workspace = await prepareWorkspace(root, "run_5-42", {
      configFile: "cypress.config.js",
      wrap: false,
    });
    fs.mkdirSync(workspace.reportsDir);
    const report = (spec: string) => JSON.stringify({ spec, stats: {}, tests: [] });
    fs.writeFileSync(path.join(workspace.reportsDir, "0002.json"), report("b"));
    fs.writeFileSync(path.join(workspace.reportsDir, "0001.json"), report("a"));
    fs.writeFileSync(path.join(workspace.reportsDir, "0003.json"), '{"cut');
    expect((await readReports(workspace)).map((r) => r.spec)).toEqual(["a", "b"]);

    fs.writeFileSync(workspace.contextFile, '{"title":"A"}\n{"title":"B"\n');
    expect((await readContexts(workspace)).map((c) => c.title)).toEqual(["A"]);
  });
});

describe("cleanupWorkspaces", () => {
  it("keeps the newest folders and anything recent", async () => {
    const runs = path.join(root, RUNS_DIR);
    const old = Date.now() / 1000 - 3600;
    for (let i = 0; i < 55; i++) {
      const dir = path.join(runs, `run_${i}-1`);
      fs.mkdirSync(dir, { recursive: true });
      fs.utimesSync(dir, old + i, old + i);
    }
    fs.mkdirSync(path.join(runs, "run_recent-1"));

    await cleanupWorkspaces(root, createLogger(false, true));
    const left = fs.readdirSync(runs);
    expect(left).toHaveLength(50);
    expect(left).toContain("run_recent-1");
    expect(left).not.toContain("run_0-1");
  });
});
