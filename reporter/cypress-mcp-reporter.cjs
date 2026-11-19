// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
//
// Mocha reporter that cypress-mcp runs Cypress with, in place of the
// built-in `json` reporter.
//
// While the run is going it prints one marker line per test event, so the
// server can send MCP progress notifications and, when a run times out, name
// the test that was running. At the end of each spec it writes the same JSON
// report as Mocha's `json` reporter, plus the spec path, to the run folder
// named by MCP_CYPRESS_RUN_DIR (or to stdout without one).
//
// The project's own reporter (junit, mochawesome, ...) keeps working: the
// wrapper config passes it as reporterOptions.cypressMcpInner and it is
// created here on the same runner, so it gets every event and writes its
// files as usual.
//
// CommonJS with no dependencies on purpose: Cypress loads reporters with
// require() inside its own Node runtime, and older Cypress versions bundle
// Node releases that cannot require an ES module.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Keep in sync with REPORTER_MARKER in src/services/reporter-events.ts.
const MARKER = "@@cypress-mcp@@";

// Keep in sync with RUN_DIR_ENV in src/services/run-workspace.ts.
const RUN_DIR_ENV = "MCP_CYPRESS_RUN_DIR";

/** Cypress's names for the reporters it bundles. */
const BUNDLED_REPORTERS = {
  junit: "mocha-junit-reporter",
  teamcity: "mocha-teamcity-reporter",
};

const MOCHA_REPORTERS = new Set([
  "base",
  "doc",
  "dot",
  "html",
  "json",
  "json-stream",
  "landing",
  "list",
  "markdown",
  "min",
  "nyan",
  "progress",
  "spec",
  "tap",
  "xunit",
]);

function fullTitleOf(runnable) {
  return typeof runnable.fullTitle === "function"
    ? runnable.fullTitle()
    : String(runnable.title);
}

function currentRetryOf(test) {
  return typeof test.currentRetry === "function"
    ? test.currentRetry()
    : test.currentRetry;
}

// Same shape as Mocha's json reporter: errors become plain objects and
// circular references are replaced by their string form.
function clean(test) {
  let err = test.err || {};
  if (err instanceof Error) {
    const copy = {};
    for (const key of Object.getOwnPropertyNames(err)) {
      copy[key] = err[key];
    }
    err = copy;
  }

  return {
    title: test.title,
    fullTitle: fullTitleOf(test),
    file: test.file,
    duration: test.duration,
    currentRetry: currentRetryOf(test),
    err: cleanCycles(err),
  };
}

function cleanCycles(value) {
  const seen = [];
  return JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (typeof item === "object" && item !== null) {
        if (seen.includes(item)) {
          return String(item);
        }
        seen.push(item);
      }
      return item;
    }),
  );
}

function emit(event) {
  // The server finds the marker anywhere in a line, so output Cypress left
  // mid-line is kept intact.
  process.stdout.write(`${MARKER}${JSON.stringify(event)}\n`);
}

function totalTests(runner) {
  try {
    if (runner.suite && typeof runner.suite.total === "function") {
      return runner.suite.total();
    }
  } catch {
    // Not every Cypress version builds a full suite tree on the server side.
  }
  return typeof runner.total === "number" ? runner.total : undefined;
}

/**
 * The project's reporter class, resolved the way Cypress resolves it: a file
 * or package in the project first, then the reporters Cypress bundles. Those
 * live in Cypress's own module snapshot, so they are required through the
 * module that loaded this reporter.
 */
function loadInnerReporter(name, projectRoot) {
  const attempts = [];
  if (projectRoot) {
    const asFile = path.resolve(projectRoot, name);
    attempts.push(() => (fs.existsSync(asFile) ? require(asFile) : undefined));
    attempts.push(() => require(require.resolve(name, { paths: [projectRoot] })));
  }
  const parent = module.parent || require.main;
  if (parent) {
    if (BUNDLED_REPORTERS[name])
      attempts.push(() => parent.require(BUNDLED_REPORTERS[name]));
    if (MOCHA_REPORTERS.has(name)) {
      attempts.push(() => parent.require(`mocha-7.2.0/lib/reporters/${name}`));
      attempts.push(() => parent.require(`mocha/lib/reporters/${name}`));
    }
  }

  let lastError;
  for (const attempt of attempts) {
    try {
      const loaded = attempt();
      const Reporter = loaded && loaded.default ? loaded.default : loaded;
      if (typeof Reporter === "function") return Reporter;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`reporter "${name}" not found`);
}

function CypressMcpReporter(runner, options) {
  const tests = [];
  const pending = [];
  const failures = [];
  const passes = [];
  // Fallback when the runner has no stats collector.
  const counts = {
    suites: 0,
    tests: 0,
    passes: 0,
    pending: 0,
    failures: 0,
    start: new Date(),
  };
  const runDir = process.env[RUN_DIR_ENV];
  const spec =
    runner.suite && typeof runner.suite.file === "string" ? runner.suite.file : undefined;

  const inner =
    options && options.reporterOptions && options.reporterOptions.cypressMcpInner;
  if (inner && inner.name) {
    try {
      const Reporter = loadInnerReporter(inner.name, inner.projectRoot);
      this.inner = new Reporter(runner, { reporterOptions: inner.options || {} });
    } catch (err) {
      emit({
        event: "warning",
        message: `The project's reporter "${inner.name}" could not be loaded next to cypress-mcp's: ${err && err.message ? err.message : String(err)}`,
      });
    }
  }

  runner.on("start", () => {
    counts.start = new Date();
    emit({ event: "start", total: totalTests(runner), spec });
  });

  runner.on("suite", (suite) => {
    if (!suite.root) counts.suites++;
  });

  runner.on("test", (test) => {
    emit({ event: "test", title: test.title, fullTitle: fullTitleOf(test) });
  });

  runner.on("test end", (test) => {
    counts.tests++;
    tests.push(test);
  });

  runner.on("pass", (test) => {
    counts.passes++;
    passes.push(test);
    emit({
      event: "pass",
      title: test.title,
      fullTitle: fullTitleOf(test),
      duration: test.duration,
    });
  });

  runner.on("fail", (test, err) => {
    counts.failures++;
    failures.push(test);
    const error = err || test.err || {};
    emit({
      event: "fail",
      // "hook" when a before/after hook failed rather than the test itself
      type: test.type,
      title: test.title,
      fullTitle: fullTitleOf(test),
      duration: test.duration,
      error: error.message,
      stack: error.stack,
    });
  });

  runner.on("pending", (test) => {
    counts.pending++;
    pending.push(test);
    emit({ event: "pending", title: test.title, fullTitle: fullTitleOf(test) });
  });

  runner.once("end", () => {
    const end = new Date();
    const stats =
      runner.stats && typeof runner.stats === "object"
        ? runner.stats
        : { ...counts, end, duration: end.getTime() - counts.start.getTime() };

    const report = {
      ...(spec ? { spec } : {}),
      stats,
      tests: tests.map(clean),
      pending: pending.map(clean),
      failures: failures.map(clean),
      passes: passes.map(clean),
    };
    runner.testResults = report;
    if (!writeReport(runDir, report)) {
      process.stdout.write(JSON.stringify(report, null, 2));
    }
  });
}

/**
 * Mocha calls done() when the run ends, if the reporter has one. Reporters
 * that write files asynchronously (mochawesome) need it to finish.
 */
CypressMcpReporter.prototype.done = function done(failures, fn) {
  if (this.inner && typeof this.inner.done === "function") {
    this.inner.done(failures, fn);
  } else {
    fn(failures);
  }
};

/** One file per spec in <run dir>/reports, in run order. False when there is no run dir. */
function writeReport(runDir, report) {
  if (!runDir) return false;
  try {
    const dir = path.join(runDir, "reports");
    fs.mkdirSync(dir, { recursive: true });
    const index = fs.readdirSync(dir).filter((file) => file.endsWith(".json")).length;
    fs.writeFileSync(
      path.join(dir, `${String(index + 1).padStart(4, "0")}.json`),
      JSON.stringify(report),
    );
    return true;
  } catch {
    return false;
  }
}

module.exports = CypressMcpReporter;
