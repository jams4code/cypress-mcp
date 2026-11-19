// `cypress-mcp run <spec>` against the fake Cypress project, through the
// built bin as an agent's shell runs it. Needs `npm run build` first.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BIN = path.resolve("bin/cypress-mcp.mjs");
const PROJECT_FIXTURE = path.resolve("test/fixtures/agent-project");
const FAKE_CYPRESS = path.resolve("test/fixtures/fake-cypress");

let root: string;

function cli(
  args: string[],
  cwd = root,
): { status: number | null; stdout: string; stderr: string } {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "CYPRESS_RECORD_KEY") env[key] = value;
  }
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env,
    encoding: "utf-8",
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-mcp-cli-"));
  fs.cpSync(PROJECT_FIXTURE, root, { recursive: true });
  fs.cpSync(FAKE_CYPRESS, path.join(root, "node_modules", "cypress"), {
    recursive: true,
  });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("cypress-mcp run", () => {
  it("prints the compact result and exits 1 when a test fails", () => {
    const { status, stdout, stderr } = cli(["run", "cypress/e2e/checkout.cy.js"]);

    expect(status).toBe(1);
    expect(stdout).toMatch(
      /^FAIL cypress\/e2e\/checkout\.cy\.js: 2 failed, 1 passed in /,
    );
    expect(stdout).toContain("   cypress/e2e/checkout.cy.js:10:7 AssertionError:");
    // Info logs stay off stderr: an agent's shell usually shows both streams.
    expect(stderr).toBe("");
  });

  it("exits 0 when every test passes and takes --test and --cwd", () => {
    const pass = cli(["run", "cypress/e2e/pass.cy.js", "--cwd", root], os.tmpdir());
    expect(pass.status).toBe(0);
    expect(pass.stdout).toMatch(/^PASS cypress\/e2e\/pass\.cy\.js: 1 passed/);

    const one = cli([
      "run",
      "cypress/e2e/checkout.cy.js",
      "--test",
      "shows the cart page",
    ]);
    expect(one.status).toBe(0);
    expect(one.stdout).toContain('"shows the cart page": 1 passed');
  });

  it("runs several specs, a file:line and repeats in one launch", () => {
    const several = cli(["run", "cypress/e2e/pass.cy.js", "cypress/e2e/flaky.cy.js"]);
    expect(several.status).toBe(0);
    expect(several.stdout).toMatch(/^PASS 2 specs: 2 passed, 1 flaky in /);

    const atLine = cli(["run", "cypress/e2e/checkout.cy.js:13", "--repeat", "2"]);
    expect(atLine.status).toBe(0);
    expect(atLine.stdout).toMatch(
      /^PASS cypress\/e2e\/checkout\.cy\.js "Checkout shows the cart page" x2: 2 passed/,
    );

    expect(cli(["run", "cypress/e2e/pass.cy.js", "--repeat", "99"]).status).toBe(2);
  });

  it("prints the envelope with --json", () => {
    const { status, stdout } = cli(["run", "cypress/e2e/checkout.cy.js", "--json"]);
    const envelope = JSON.parse(stdout) as { tool: string; data: { status: string } };

    expect(status).toBe(1);
    expect(envelope.tool).toBe("cypress_run");
    expect(envelope.data.status).toBe("failed");
  });

  it("exits 2 on bad arguments and setup errors", () => {
    const missing = cli(["run", "cypress/e2e/nope.cy.js"]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("Error SPEC_NOT_FOUND");

    expect(cli(["run"]).status).toBe(2);
    expect(cli(["run", "a.cy.js", "--nope"]).status).toBe(2);
    expect(cli(["run", "cypress/e2e/pass.cy.js", "--timeout", "soon"]).status).toBe(2);
  });

  it("prints usage and the version", () => {
    const help = cli(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: cypress-mcp run <spec>... [options]");

    const version = cli(["--version"]);
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8")) as {
      version: string;
    };
    expect(version.stdout.trim()).toBe(pkg.version);
  });
});
