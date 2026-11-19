import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OutputParser } from "../../src/services/output-parser.js";
import {
  ReporterEventStream,
  type RunProgress,
} from "../../src/services/reporter-events.js";
import { createLogger } from "../../src/utils/logger.js";

// The reporter runs inside Cypress, so it is plain CommonJS outside src/.
const Reporter = createRequire(import.meta.url)(
  "../../reporter/cypress-mcp-reporter.cjs",
) as new (runner: EventEmitter) => unknown;

interface FakeTest {
  title: string;
  type?: string;
  duration?: number;
  err?: Record<string, unknown>;
  parent: { title: string };
  fullTitle(): string;
  currentRetry(): number;
}

function fakeTest(title: string, extra: Partial<FakeTest> = {}): FakeTest {
  return {
    title,
    duration: 12,
    parent: { title: "Checkout" },
    fullTitle: () => `Checkout ${title}`,
    currentRetry: () => 0,
    ...extra,
  };
}

/** Run the reporter on a fake Mocha runner and capture what it prints. */
function runReporter(drive: (runner: EventEmitter) => void, stats?: object): string {
  const runner = Object.assign(new EventEmitter(), {
    stats,
    suite: { total: () => 3 },
  });
  const written: string[] = [];
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });

  try {
    new Reporter(runner);
    drive(runner);
  } finally {
    write.mockRestore();
  }
  return written.join("");
}

const parser = new OutputParser(createLogger(false));

describe("cypress-mcp-reporter.cjs", () => {
  const drive = (runner: EventEmitter): void => {
    const passed = fakeTest("shows the cart page");
    const failedErr = {
      message: "expected '2' to equal '1'",
      stack:
        "AssertionError\n    at Context.eval (webpack://shop/./cypress/e2e/checkout.cy.js:5:37)",
      actual: "'2'",
      expected: "'1'",
    };
    const failed = fakeTest("adds one item", { err: failedErr });
    const skipped = fakeTest("logs in");

    runner.emit("start");
    runner.emit("test", failed);
    failed.err = failedErr;
    runner.emit("fail", failed, failedErr);
    runner.emit("test end", failed);
    runner.emit("test", passed);
    runner.emit("pass", passed);
    runner.emit("test end", passed);
    runner.emit("pending", skipped);
    runner.emit("test end", skipped);
    runner.emit("end");
  };

  it("prints a report the output parser reads like Mocha's json reporter", () => {
    const stats = {
      suites: 1,
      tests: 3,
      passes: 1,
      pending: 1,
      failures: 1,
      duration: 40,
    };
    const stream = new ReporterEventStream();
    stream.push(runReporter(drive, stats));
    const result = parser.parse(stream.end(), "", 1);

    expect(result.stats).toMatchObject({ tests: 3, passing: 1, failing: 1, pending: 1 });
    expect(result.failures[0]).toMatchObject({
      fullTitle: "Checkout adds one item",
      error: "expected '2' to equal '1'",
      diff: "Expected: '1'\nActual: '2'",
    });
    expect(result.failures[0]?.stack).toContain("checkout.cy.js:5:37");
    expect(result.tests.map((t) => [t.fullTitle, t.state])).toEqual([
      ["Checkout adds one item", "failed"],
      ["Checkout shows the cart page", "passed"],
      ["Checkout logs in", "pending"],
    ]);
  });

  it("prints one event per test while the run goes", () => {
    const progress: RunProgress[] = [];
    const stream = new ReporterEventStream((p) => progress.push(p));
    stream.push(runReporter(drive, {}));

    expect(progress).toEqual([
      { completed: 0, total: 3, message: "Cypress started, 3 tests" },
      { completed: 1, total: 3, message: "failed: Checkout adds one item" },
      { completed: 2, total: 3, message: "passed: Checkout shows the cart page" },
      { completed: 3, total: 3, message: "pending: Checkout logs in" },
    ]);
  });

  it("counts its own stats when the runner has no stats collector", () => {
    const output = runReporter(drive);
    const stream = new ReporterEventStream();
    stream.push(output);

    expect(parser.parse(stream.end(), "", 1).stats).toMatchObject({
      tests: 3,
      passing: 1,
      failing: 1,
      pending: 1,
    });
  });

  it("survives errors with circular references", () => {
    const err: Record<string, unknown> = { message: "loop" };
    err["self"] = err;
    const output = runReporter((runner) => {
      const test = fakeTest("loops", { err });
      runner.emit("fail", test, err);
      runner.emit("test end", test);
      runner.emit("end");
    }, {});

    const stream = new ReporterEventStream();
    stream.push(output);
    expect(parser.parse(stream.end(), "", 1).failures[0]?.error).toBe("loop");
  });
});

describe("cypress-mcp-reporter.cjs with a run folder and the project's reporter", () => {
  const ReporterWithOptions = Reporter as unknown as new (
    runner: EventEmitter,
    options?: object,
  ) => { done(failures: number, fn: (failures: number) => void): void };

  it("writes each spec's report, with its path, to the run folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-mcp-reporter-"));
    const previous = process.env["MCP_CYPRESS_RUN_DIR"];
    process.env["MCP_CYPRESS_RUN_DIR"] = dir;
    try {
      const printed = runReporterOn(
        { suite: { total: () => 1, file: "cypress/e2e/a.cy.js" } },
        (runner) => {
          runner.emit("start");
          runner.emit("end");
        },
      );
      expect(printed).toContain('"spec":"cypress/e2e/a.cy.js"');
      expect(printed).not.toContain('"stats"');
      const report = JSON.parse(
        fs.readFileSync(path.join(dir, "reports", "0001.json"), "utf-8"),
      ) as { spec: string };
      expect(report.spec).toBe("cypress/e2e/a.cy.js");
    } finally {
      if (previous === undefined) delete process.env["MCP_CYPRESS_RUN_DIR"];
      else process.env["MCP_CYPRESS_RUN_DIR"] = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs the project's reporter on the same runner and waits for its done()", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-mcp-inner-"));
    fs.writeFileSync(
      path.join(dir, "inner.cjs"),
      `module.exports = function Inner(runner, options) {
        globalThis.innerSeen = { options: options.reporterOptions, events: [] };
        runner.on("pass", (t) => globalThis.innerSeen.events.push(t.title));
        this.done = (failures, fn) => { globalThis.innerSeen.done = failures; fn(failures); };
      };`,
    );
    try {
      const runner = Object.assign(new EventEmitter(), { suite: { total: () => 1 } });
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      let reporter;
      try {
        reporter = new ReporterWithOptions(runner, {
          reporterOptions: {
            cypressMcpInner: {
              name: "./inner.cjs",
              options: { mochaFile: "x.xml" },
              projectRoot: dir,
            },
          },
        });
        runner.emit("pass", fakeTest("passes"));
        runner.emit("end");
      } finally {
        write.mockRestore();
      }
      let finished = -1;
      reporter.done(0, (failures) => (finished = failures));

      const seen = (
        globalThis as { innerSeen?: { options: object; events: string[]; done: number } }
      ).innerSeen;
      expect(seen?.options).toEqual({ mochaFile: "x.xml" });
      expect(seen?.events).toEqual(["passes"]);
      expect(seen?.done).toBe(0);
      expect(finished).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns, and still reports, when the project's reporter cannot be loaded", () => {
    const printed = runReporterOn(
      { suite: { total: () => 0 } },
      (runner) => runner.emit("end"),
      {
        reporterOptions: {
          cypressMcpInner: {
            name: "no-such-reporter",
            options: {},
            projectRoot: os.tmpdir(),
          },
        },
      },
    );
    const stream = new ReporterEventStream();
    stream.push(printed);
    stream.end();
    expect(stream.warnings[0]).toContain(
      'The project\'s reporter "no-such-reporter" could not be loaded',
    );
  });

  /** Like runReporter, with runner fields and reporter options of the test's choice. */
  function runReporterOn(
    fields: object,
    drive: (runner: EventEmitter) => void,
    options?: object,
  ): string {
    const runner = Object.assign(new EventEmitter(), fields);
    const written: string[] = [];
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    try {
      new ReporterWithOptions(runner, options);
      drive(runner);
    } finally {
      write.mockRestore();
    }
    return written.join("");
  }
});
