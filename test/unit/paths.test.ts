import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isVersionAtLeast,
  parseCwdArg,
  resolveCypressInstall,
  resolveProjectRoot,
  resolveInsideRoot,
} from "../../src/utils/paths.js";

const root = path.resolve("test/fixtures/cypress-project");

describe("resolveInsideRoot", () => {
  it("accepts paths inside the root", () => {
    expect(resolveInsideRoot(root, "cypress/e2e/sample.cy.ts")).toBe(
      path.join(root, "cypress", "e2e", "sample.cy.ts"),
    );
    expect(resolveInsideRoot(root, path.join(root, "cypress"))).toBe(
      path.join(root, "cypress"),
    );
  });

  it("accepts a folder whose name starts with two dots", () => {
    expect(resolveInsideRoot(root, "..cache/x.cy.ts")).toBe(
      path.join(root, "..cache", "x.cy.ts"),
    );
  });

  it("rejects traversal and absolute paths outside the root", () => {
    expect(resolveInsideRoot(root, "../outside.cy.ts")).toBeNull();
    expect(resolveInsideRoot(root, "cypress/../../outside.cy.ts")).toBeNull();
    expect(resolveInsideRoot(root, os.tmpdir())).toBeNull();
  });
});

describe("resolveCypressInstall", () => {
  let tmp: string;

  beforeAll(async () => {
    // realpath: on macOS the temp dir is behind a symlink (/var -> /private/var)
    // and Node's module resolution returns the real path.
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "cypress-mcp-cli-")));
    // A hoisted install: cypress lives in the parent of the project
    const pkgDir = path.join(tmp, "node_modules", "cypress");
    await fs.mkdir(path.join(pkgDir, "bin"), { recursive: true });
    await fs.writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "cypress",
        version: "16.0.0",
        bin: { cypress: "bin/cypress" },
      }),
    );
    await fs.writeFile(path.join(pkgDir, "bin", "cypress"), "");
    await fs.mkdir(path.join(tmp, "packages", "web"), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("finds a Cypress install hoisted above the project", () => {
    expect(resolveCypressInstall(path.join(tmp, "packages", "web"))).toEqual({
      cli: path.join(tmp, "node_modules", "cypress", "bin", "cypress"),
      version: "16.0.0",
    });
  });

  it("returns null when Cypress is not installed", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "cypress-mcp-empty-"));
    try {
      expect(resolveCypressInstall(empty)).toBeNull();
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});

describe("isVersionAtLeast", () => {
  it("compares major and minor", () => {
    expect(isVersionAtLeast("15.10.0", 15, 10)).toBe(true);
    expect(isVersionAtLeast("16.0.0", 15, 10)).toBe(true);
    expect(isVersionAtLeast("15.9.4", 15, 10)).toBe(false);
    expect(isVersionAtLeast("14.5.4", 15, 10)).toBe(false);
  });

  it("treats an unreadable version as old", () => {
    expect(isVersionAtLeast("next", 15, 10)).toBe(false);
  });
});

describe("parseCwdArg", () => {
  it("reads --cwd <dir> and --cwd=<dir>", () => {
    expect(parseCwdArg(["--cwd", "/work/shop", "--verbose"])).toBe("/work/shop");
    expect(parseCwdArg(["--cwd=/work/my shop"])).toBe("/work/my shop");
  });

  it("returns undefined when --cwd is absent", () => {
    expect(parseCwdArg(["--verbose"])).toBeUndefined();
  });
});

describe("resolveProjectRoot", () => {
  const start = path.resolve("start-dir");
  const claude = path.resolve("claude-project");
  const flag = path.resolve("from-flag");

  it("prefers --cwd, then CLAUDE_PROJECT_DIR, then the start directory", () => {
    expect(
      resolveProjectRoot(["--cwd", flag], { CLAUDE_PROJECT_DIR: claude }, start),
    ).toBe(flag);
    expect(resolveProjectRoot([], { CLAUDE_PROJECT_DIR: claude }, start)).toBe(claude);
    expect(resolveProjectRoot([], { CLAUDE_PROJECT_DIR: " " }, start)).toBe(start);
    expect(resolveProjectRoot([], {}, start)).toBe(start);
  });
});
