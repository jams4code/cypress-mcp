// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// Drives a real Cypress project through the built server over stdio, the same
// way an agent does. Run after `npm run build` with Cypress and @cypress/grep
// installed in test/e2e/project:  node test/e2e/smoke.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const project = fileURLToPath(new URL("./project", import.meta.url));
const server = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const spec = "cypress/e2e/math & logic.cy.js";

const env = { ...process.env };
delete env.CYPRESS_RECORD_KEY;

const client = new Client({ name: "e2e-smoke", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [server, "--cwd", project],
    env,
    stderr: "inherit",
  }),
);

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 600_000,
  });
  return JSON.parse(res.content[0].text);
}

const checks = [];
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`ok  ${name}`);
}

try {
  await check("lists 12 tools", async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 12);
  });

  await check("doctor finds Cypress", async () => {
    const doctor = await call("cypress_doctor");
    const binary = doctor.data.checks.find((c) => /binary/i.test(c.check));
    assert.equal(binary?.status, "ok", JSON.stringify(doctor.data.checks));
  });

  await check("run_spec reports pass, fail, flaky and env", async () => {
    const run = await call("cypress_run_spec", {
      spec,
      env: { user: 'a,"b" & c', port: "3000" },
    });
    assert.equal(run.ok, true, run.summary);
    const { stats, tests } = run.data;
    assert.equal(stats.tests, 4, JSON.stringify(stats));
    assert.equal(stats.passing, 3, JSON.stringify(tests));
    assert.equal(stats.failing, 1, JSON.stringify(tests));
    assert.equal(stats.flaky, 1, JSON.stringify(tests));
    const flaky = tests.find((t) => t.title === "is flaky on the first attempt");
    assert.equal(flaky.attempts, 2);
  });

  await check("run_test runs only the matching test", async () => {
    const run = await call("cypress_run_test", {
      spec,
      testName: 'fails & shows "quotes"',
    });
    assert.equal(run.data.stats.failing, 1, JSON.stringify(run.data.stats));
    assert.equal(run.data.stats.passing, 0, JSON.stringify(run.data.stats));
  });

  await check("failure context and rerun_last", async () => {
    const ctx = await call("cypress_get_failure_context");
    assert.match(JSON.stringify(ctx.data), /always wrong/);
    const rerun = await call("cypress_rerun_last");
    assert.ok(rerun.previousRunId, "rerun links to the previous run");
    assert.equal(rerun.data.stats.failing, 1);
  });

  await check("rejects a spec outside the project", async () => {
    const res = await call("cypress_run_spec", { spec: "../smoke.mjs" });
    assert.equal(res.data.code, "SPEC_OUTSIDE_PROJECT");
  });

  await check("record needs CYPRESS_RECORD_KEY", async () => {
    const res = await call("cypress_run_spec", { spec, record: true });
    assert.equal(res.data.code, "RECORD_KEY_MISSING");
  });
} finally {
  await client.close();
}

console.log(`\n${checks.length} e2e checks passed`);
