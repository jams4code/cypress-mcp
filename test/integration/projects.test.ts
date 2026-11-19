// Setups beyond the one-project default, through the built server and the
// fake Cypress: a monorepo root, failure context turned off, and a project
// whose config cannot load through the wrapper. Needs `npm run build` first.
import { afterAll, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER_PATH = path.resolve("dist/index.js");
const PROJECT_FIXTURE = path.resolve("test/fixtures/agent-project");
const FAKE_CYPRESS = path.resolve("test/fixtures/fake-cypress");

const roots: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
  while (clients.length > 0) await clients.pop()!.close();
});

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-mcp-projects-"));
  roots.push(root);
  return root;
}

/** The agent-project fixture with the fake Cypress, at `dir`. */
function project(dir: string, serverConfig?: object): void {
  fs.cpSync(PROJECT_FIXTURE, dir, { recursive: true });
  fs.cpSync(FAKE_CYPRESS, path.join(dir, "node_modules", "cypress"), { recursive: true });
  if (serverConfig) {
    fs.writeFileSync(
      path.join(dir, "cypress-mcp.config.json"),
      JSON.stringify(serverConfig),
    );
  }
}

async function connect(root: string, env: Record<string, string> = {}): Promise<Client> {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      key !== "CYPRESS_RECORD_KEY" &&
      key !== "CYPRESS_MCP_CAPS"
    ) {
      childEnv[key] = value;
    }
  }
  const client = new Client({ name: "projects", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_PATH, "--cwd", root],
      env: { ...childEnv, ...env },
      stderr: "ignore",
    }),
  );
  await client.listTools();
  clients.push(client);
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; text: string; data: Record<string, unknown> }> {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 30_000,
  });
  const structured = result.structuredContent as { data: Record<string, unknown> };
  return {
    isError: result.isError === true,
    text: (result.content as { text: string }[])[0]!.text,
    data: structured.data,
  };
}

function runArgs(logFile: string): string[][] {
  if (!fs.existsSync(logFile)) return [];
  return fs
    .readFileSync(logFile, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[])
    .filter((args) => args[0] === "run");
}

describe("monorepo root", () => {
  it("finds the project from the spec path and shows paths from the root", async () => {
    const root = tempRoot();
    project(path.join(root, "apps", "shop"));
    project(path.join(root, "apps", "admin"));
    const client = await connect(root);

    const list = await call(client, "cypress_list_specs");
    expect(list.text.split("\n")[0]).toBe(
      "12 spec(s), 18 test(s) in 2 projects (apps/admin, apps/shop)",
    );
    expect(list.text).toContain("apps/shop/cypress/e2e/checkout.cy.js: 3");

    const run = await call(client, "cypress_run", {
      spec: "apps/shop/cypress/e2e/checkout.cy.js",
    });
    expect(run.text.split("\n")[0]).toMatch(
      /^FAIL apps\/shop\/cypress\/e2e\/checkout\.cy\.js: 2 failed/,
    );
    expect(run.text).toContain(
      "   apps/shop/cypress/e2e/checkout.cy.js:10:7 AssertionError",
    );
    expect(run.data["failures"]).toMatchObject([
      { location: "apps/shop/cypress/e2e/checkout.cy.js:5:37" },
      { location: "apps/shop/cypress/e2e/checkout.cy.js:10:7" },
    ]);

    const details = await call(client, "cypress_get_failure", { failure: 2 });
    expect(details.text).toContain("at apps/shop/cypress/e2e/checkout.cy.js:10:7");
    expect(details.text).toContain(">>> 10:");

    const byProject = await call(client, "cypress_run", {
      project: "apps/admin",
      spec: "cypress/e2e/pass.cy.js",
    });
    expect(byProject.text).toMatch(/^PASS apps\/admin\/cypress\/e2e\/pass\.cy\.js/);

    const ambiguous = await call(client, "cypress_run", {
      spec: "cypress/e2e/pass.cy.js",
    });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.data["code"]).toBe("PROJECT_REQUIRED");
    expect(ambiguous.text).toContain("apps/admin, apps/shop");

    const doctor = await call(client, "cypress_doctor", { quick: true });
    expect(doctor.text).toContain(
      "fail Project: The server root holds several Cypress projects",
    );
    const doctorShop = await call(client, "cypress_doctor", {
      quick: true,
      project: "apps/shop",
    });
    expect(doctorShop.text).toContain("ok   Project: apps/shop");
  });
});

describe("failure context off", () => {
  it("runs the project's config as is, with the reporter and @cypress/grep", async () => {
    const root = tempRoot();
    project(root, { failureContext: false });
    const log = path.join(root, "argv.log");
    const client = await connect(root, { FAKE_CYPRESS_LOG: log });

    const run = await call(client, "cypress_run", {
      spec: "cypress/e2e/checkout.cy.js",
      testName: "logs in",
    });
    const [args] = runArgs(log);
    expect(args).toContain("--reporter");
    expect(args![args!.indexOf("--config-file") + 1]).toBe("cypress.config.js");
    expect(JSON.parse(args![args!.indexOf("--expose") + 1]!)).toEqual({
      grep: "logs in",
    });
    expect(run.data["contextCaptured"]).toBe(false);
    expect(run.text).not.toContain("<page data");

    const repeat = await call(client, "cypress_run", {
      spec: "cypress/e2e/pass.cy.js",
      repeat: 2,
    });
    expect(repeat.isError).toBe(true);
    expect(repeat.text).toContain("repeat needs failure context");

    const doctor = await call(client, "cypress_doctor", { quick: true });
    expect(doctor.text).toContain("warn Failure context: Off: failureContext is false");
  });
});

describe("a config that does not load through the wrapper", () => {
  it("reruns without it once, says so, and skips it afterwards", async () => {
    const root = tempRoot();
    project(root);
    const log = path.join(root, "argv.log");
    const client = await connect(root, {
      FAKE_CYPRESS_LOG: log,
      FAKE_WRAPPER_FAILS: "1",
    });

    const first = await call(client, "cypress_run", { spec: "cypress/e2e/pass.cy.js" });
    expect(first.isError).toBe(false);
    expect(first.text).toMatch(/^PASS cypress\/e2e\/pass\.cy\.js: 1 passed/);
    expect(first.text).toContain(
      "note: No failure context for this project: Cypress could not load cypress.config.js through the cypress-mcp wrapper",
    );
    expect(runArgs(log)).toHaveLength(2);

    fs.rmSync(log);
    const second = await call(client, "cypress_run", { spec: "cypress/e2e/pass.cy.js" });
    expect(second.text).not.toContain("note:");
    expect(runArgs(log)).toHaveLength(1);
    expect(runArgs(log)[0]).toContain("--reporter");
  });
});
