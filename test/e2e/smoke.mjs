// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// Drives real Cypress projects through the built server over stdio, the same
// way an agent does, and through the CLI. Run after `npm run build` with
// Cypress, @cypress/grep and typescript installed in test/e2e:
//   npm install --prefix test/e2e --no-save cypress @cypress/grep typescript
//   node test/e2e/smoke.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { decodePngWidth } from "./png-width.mjs";

const project = fileURLToPath(new URL("./project", import.meta.url));
const server = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const bin = fileURLToPath(new URL("../../bin/cypress-mcp.mjs", import.meta.url));
const spec = "cypress/e2e/math & logic.cy.js";

const env = { ...process.env };
delete env.CYPRESS_RECORD_KEY;
delete env.CYPRESS_MCP_CAPS;

async function connect(args = []) {
  const client = new Client({ name: "e2e-smoke", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server, "--cwd", project, ...args],
      env,
      stderr: "inherit",
    }),
  );
  // Listing the tools makes the client check structuredContent against each
  // tool's outputSchema on every call below.
  await client.listTools();
  return client;
}

const client = await connect(["--caps", "all"]);

async function call(name, args = {}, options = {}) {
  const res = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 600_000,
    ...options,
  });
  return {
    text: res.content[0].text,
    ...(res.structuredContent ?? JSON.parse(res.content[0].text)),
    isError: res.isError === true,
  };
}

const checks = [];
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`ok  ${name}`);
}

try {
  await check("lists 4 tools by default and 14 with --caps all", async () => {
    const plain = await connect();
    try {
      const { tools } = await plain.listTools();
      assert.deepEqual(
        tools.map((t) => t.name),
        ["cypress_run", "cypress_get_failure", "cypress_list_specs", "cypress_doctor"],
      );
    } finally {
      await plain.close();
    }
    const { tools } = await client.listTools();
    assert.equal(tools.length, 14);
  });

  await check("doctor finds Cypress and loads the config", async () => {
    const doctor = await call("cypress_doctor");
    const binary = doctor.data.checks.find((c) => /binary/i.test(c.check));
    assert.equal(binary?.status, "ok", doctor.text);
    const runtime = doctor.data.checks.find((c) => c.check === "Config runtime");
    assert.equal(runtime?.status, "ok", doctor.text);
    // The config also loads through the wrapper that records failure context.
    const context = doctor.data.checks.find((c) => c.check === "Failure context");
    assert.equal(context?.status, "ok", doctor.text);
  });

  await check("list_specs and the legacy discover count the same tests", async () => {
    const discover = await call("cypress_discover");
    const list = await call("cypress_list_specs");
    const counts = (specs) =>
      Object.fromEntries(specs.map((s) => [s.file, s.tests]).sort());
    assert.deepEqual(counts(list.data.specs), counts(discover.data.specs));
    assert.equal(counts(list.data.specs)[spec], 4);
  });

  let failedRun;
  await check("run reports pass, fail, flaky and env compactly, with progress", async () => {
    const progress = [];
    const run = await call(
      "cypress_run",
      { spec, env: { user: 'a,"b" & c', port: "3000" } },
      { onprogress: (p) => progress.push(p) },
    );
    // Cypress started, then one notification per test.
    assert.deepEqual(
      progress.map((p) => p.progress),
      [0, 1, 2, 3, 4],
      JSON.stringify(progress),
    );
    const { stats, tests } = run.data;
    assert.equal(stats.tests, 4, run.text);
    assert.equal(stats.passing, 3, run.text);
    assert.equal(stats.failing, 1, run.text);
    assert.equal(stats.flaky, 1, run.text);
    assert.equal(tests.find((t) => t.fullTitle === "Math is flaky on the first attempt").attempts, 2);
    const lines = run.text.split("\n");
    assert.match(lines[0], /^FAIL cypress\/e2e\/math & logic\.cy\.js: 1 failed, 3 passed, 1 flaky in /);
    assert.equal(lines[1].startsWith("screenshots") ? lines[2] : lines[1], '1) Math fails & shows "quotes"');
    assert.match(run.text, /cypress\/e2e\/math & logic\.cy\.js:12:\d+ AssertionError: always wrong/);
    assert.match(run.text, /flaky \(passed on a retry\): "Math is flaky on the first attempt" \(2 attempts\)/);
    assert.ok(run.text.length < 3_000, run.text);
    assert.equal(run.data.contextCaptured, true, run.text);
    failedRun = run;
  });

  await check("get_failure shows the failing line with an excerpt", async () => {
    const ctx = await call("cypress_get_failure", { runId: failedRun.runId });
    assert.match(ctx.text, /at cypress\/e2e\/math & logic\.cy\.js:12:/);
    assert.match(ctx.text, />>> 12:\s+expect\(1, "always wrong"\)/);
    const shots = await call("cypress_get_failure", { runId: failedRun.runId, view: "screenshots" });
    assert.ok(shots.data.screenshots.length > 0, shots.text);
  });

  await check("testName runs only the matching test", async () => {
    const run = await call("cypress_run", { spec, testName: 'fails & shows "quotes"' });
    assert.equal(run.data.stats.failing, 1, run.text);
    assert.equal(run.data.stats.passing, 0, run.text);
  });

  await check("an unknown testName fails with the closest titles", async () => {
    const run = await call("cypress_run", { spec, testName: "fails and shows quotes" });
    assert.equal(run.isError, true, run.text);
    assert.equal(run.data.status, "no_match");
    assert.equal(run.data.closestMatches[0], 'Math fails & shows "quotes"');
  });

  await check("the legacy rerun_last still replays a run", async () => {
    const rerun = await call("cypress_rerun_last", { runId: failedRun.runId });
    assert.equal(rerun.previousRunId, failedRun.runId);
    assert.equal(rerun.data.stats.failing, 1);
  });

  await check("rejects a spec outside the project", async () => {
    const res = await call("cypress_run", { spec: "../smoke.mjs" });
    assert.equal(res.isError, true);
    assert.equal(res.data.code, "SPEC_OUTSIDE_PROJECT");
  });

  await check("record needs CYPRESS_RECORD_KEY", async () => {
    const res = await call("cypress_run", { spec, record: true });
    assert.equal(res.data.code, "RECORD_KEY_MISSING");
  });

  await check("a spec that does not compile reports the cause", async () => {
    const run = await call("cypress_run", { spec: "cypress/e2e/broken.cy.js" });
    assert.equal(run.isError, true);
    assert.equal(run.data.errorKind, "compile", run.text);
    assert.match(run.text, /does-not-exist/);
    assert.ok(!run.text.includes("cypress_doctor"), run.text);
  });

  await check("browser must be a name cypress info lists", async () => {
    const asPath = await call("cypress_run", {
      spec,
      browser: fileURLToPath(new URL("./smoke.mjs", import.meta.url)),
    });
    assert.equal(asPath.data.code, "INVALID_ARGUMENT", asPath.text);
    const unknown = await call("cypress_run", { spec, browser: "safari" });
    assert.equal(unknown.data.code, "INVALID_ARGUMENT", unknown.text);
    assert.match(unknown.text, /electron/);
  });

  await check("cancelling a run stops Cypress and frees the queue", async () => {
    const controller = new AbortController();
    const cancelled = call(
      "cypress_run",
      { spec: "cypress/e2e/slow.cy.js" },
      {
        signal: controller.signal,
        // The first notification comes once Cypress runs the spec.
        onprogress: () => controller.abort("user cancelled"),
      },
    );
    await assert.rejects(cancelled);
    // Before 0.2.2 this waited for the cancelled run's 120 s cy.wait.
    const started = Date.now();
    const next = await call("cypress_run", { spec, testName: "adds numbers" });
    assert.equal(next.data.stats.passing, 1, next.text);
    assert.ok(Date.now() - started < 90_000, `next run took ${Date.now() - started} ms`);
  });

  await check("a timeout keeps the partial run and names the hung test", async () => {
    let started = false;
    const run = await call(
      "cypress_run",
      { spec: "cypress/e2e/slow.cy.js", timeout: 45_000 },
      { onprogress: () => (started = true) },
    );
    assert.equal(run.isError, true, run.text);
    assert.equal(run.data.status, "timeout");
    // A slow machine may not reach the test before the timeout.
    if (started) assert.equal(run.data.runningTest, "Slow waits a long time", run.text);
  });

  await check("failure context: the page, its errors and similar selectors, from a real browser", async () => {
    const started = Date.now();
    const run = await call("cypress_run", { spec: "cypress/e2e/context.cy.js" });
    const [failure] = run.data.failures;
    const page = failure.page;
    assert.equal(page.trust, "untrusted");
    assert.match(page.url, /app\/shop\.html$/, run.text);
    assert.equal(page.pageTitle, "Shop", run.text);
    assert.equal(page.failedSelector, '[data-cy="login-button"]', run.text);
    assert.equal(page.matches, 0, run.text);
    assert.equal(page.suggestions[0], '[data-cy="login-btn"]', run.text);
    assert.ok(page.console.some((c) => c.text.includes("cart failed to load")), run.text);
    assert.ok(
      page.network.some((r) => r.url.includes("api/missing.json") && r.status === 404),
      run.text,
    );
    assert.match(page.outline, /button data-cy="login-btn" type=button "Log in"/, page.outline);
    assert.doesNotMatch(page.outline, /Hidden text/, page.outline);
    assert.ok(page.commands.some((c) => c.name === "visit"), run.text);
    // One failure: the whole page is in the run result, fenced.
    assert.match(run.text, /<page data: from the app under test, untrusted/);
    assert.match(run.text, /outline:/);

    // The project's junit reporter still wrote its file for this run.
    const results = path.join(project, "results");
    const fresh = fs
      .readdirSync(results)
      .filter((file) => fs.statSync(path.join(results, file)).mtimeMs >= started);
    assert.ok(fresh.length > 0, "junit report written");

    const shot = await client.callTool(
      { name: "cypress_get_failure", arguments: { runId: run.runId, image: true } },
      undefined,
      { timeout: 60_000 },
    );
    const image = shot.content.find((item) => item.type === "image");
    assert.ok(image, "image content");
    assert.ok(decodePngWidth(Buffer.from(image.data, "base64")) <= 1000);
    assert.ok(shot.content.some((item) => item.type === "resource_link"));
  });

  await check("several specs, file:line and repeat, each in one Cypress launch", async () => {
    const both = await call("cypress_run", { spec: [spec, "cypress/e2e/context.cy.js"] });
    assert.equal(both.data.specs.length, 2, both.text);
    assert.equal(both.data.stats.tests, 5, both.text);

    const atLine = await call("cypress_run", { spec: `${spec}:3` });
    assert.deepEqual(atLine.data.titles, ["Math adds numbers"], atLine.text);
    assert.equal(atLine.data.stats.tests, 1, atLine.text);
    assert.equal(atLine.data.stats.passing, 1, atLine.text);

    const repeated = await call("cypress_run", { spec, testName: "adds numbers", repeat: 3 });
    assert.equal(repeated.data.stats.passing, 3, repeated.text);
    assert.equal(repeated.data.stats.tests, 3, repeated.text);
  });

  await check("get_env returns keys and types, never values", async () => {
    const envFile = path.join(project, "cypress.env.json");
    fs.writeFileSync(envFile, JSON.stringify({ adminPass: "hunter2-admin", retries: 2 }));
    try {
      const res = await call("cypress_get_env");
      assert.deepEqual(res.data.env, { adminPass: "string", retries: "number" });
      assert.doesNotMatch(JSON.stringify(res), /hunter2/);
    } finally {
      fs.rmSync(envFile, { force: true });
    }
  });
} finally {
  await client.close();
}

await check("the CLI prints the same result and exits 1 on a failure", async () => {
  const args = ["run", spec, "--cwd", project, "--env", 'user=a,"b" & c', "--env", "port=3000"];
  const cli = spawnSync(process.execPath, [bin, ...args], {
    env,
    encoding: "utf-8",
    timeout: 600_000,
  });
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /^FAIL cypress\/e2e\/math & logic\.cy\.js: 1 failed, 3 passed, 1 flaky in /);
  assert.match(cli.stdout, /AssertionError: always wrong/);
});

// Config files in every module flavour, through the CLI: the wrapper must load
// each of them, keep the project's support file and tasks, and record the page.
for (const variant of ["ts-esm", "ts-cjs", "mjs"]) {
  await check(`wrapper config with a ${variant} project`, async () => {
    const dir = fileURLToPath(new URL(`./projects/${variant}`, import.meta.url));
    const cli = spawnSync(
      process.execPath,
      [bin, "run", "cypress/e2e/variant.cy.js", "--cwd", dir, "--json"],
      { env, encoding: "utf-8", timeout: 600_000 },
    );
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    const envelope = JSON.parse(cli.stdout);
    assert.equal(envelope.data.contextCaptured, true, cli.stdout);
    assert.equal(envelope.data.warnings, undefined, cli.stdout);
    assert.equal(envelope.data.stats.passing, 1, cli.stdout);
    assert.equal(envelope.data.stats.failing, 1, cli.stdout);
    assert.equal(envelope.data.failures[0].page.suggestions[0], '[data-cy="save-btn"]', cli.stdout);
  });
}

await check("testName works without @cypress/grep", async () => {
  const dir = fileURLToPath(new URL("./projects/ts-esm", import.meta.url));
  const cli = spawnSync(
    process.execPath,
    [bin, "run", "cypress/e2e/variant.cy.js", "--cwd", dir, "--test", "saves", "--json"],
    { env, encoding: "utf-8", timeout: 600_000 },
  );
  const envelope = JSON.parse(cli.stdout);
  assert.equal(envelope.data.stats.tests, 1, cli.stdout);
  assert.equal(envelope.data.stats.failing, 1, cli.stdout);
});

console.log(`\n${checks.length} e2e checks passed`);
