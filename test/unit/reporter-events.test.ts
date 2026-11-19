import { describe, it, expect } from "vitest";
import {
  REPORTER_MARKER,
  ReporterEventStream,
  type RunProgress,
} from "../../src/services/reporter-events.js";

const line = (event: Record<string, unknown>): string =>
  `${REPORTER_MARKER}${JSON.stringify(event)}\n`;

describe("ReporterEventStream", () => {
  it("removes event lines and keeps everything else verbatim", () => {
    const stream = new ReporterEventStream();
    stream.push("  Running:  a.cy.js\n");
    stream.push(line({ event: "start", total: 1 }));
    stream.push(line({ event: "pass", title: "t", fullTitle: "S t" }));
    stream.push('{\n  "stats": {}\n}');

    expect(stream.end()).toBe('  Running:  a.cy.js\n{\n  "stats": {}\n}');
  });

  it("reassembles event lines split across chunks", () => {
    const progress: RunProgress[] = [];
    const stream = new ReporterEventStream((p) => progress.push(p));
    const text =
      line({ event: "start", total: 2 }) + line({ event: "pass", fullTitle: "S é" });

    for (const char of text) stream.push(char);
    stream.end();

    expect(progress).toEqual([
      { completed: 0, total: 2, message: "Cypress started, 2 tests" },
      { completed: 1, total: 2, message: "passed: S é" },
    ]);
  });

  it("keeps output that Cypress printed before a marker on the same line", () => {
    const stream = new ReporterEventStream();
    stream.push(`partial ${line({ event: "test", fullTitle: "S t" })}rest\n`);

    expect(stream.end()).toBe("partial rest\n");
    expect(stream.runningTest).toBe("S t");
  });

  it("tracks the running test and the tests that finished", () => {
    const stream = new ReporterEventStream();
    stream.push(line({ event: "test", fullTitle: "S one" }));
    stream.push(
      line({
        event: "fail",
        title: "one",
        fullTitle: "S one",
        error: "boom",
        stack: "at x",
      }),
    );
    stream.push(line({ event: "test", fullTitle: "S two" }));

    expect(stream.runningTest).toBe("S two");
    expect(stream.completed).toEqual([
      {
        title: "one",
        fullTitle: "S one",
        state: "failed",
        hook: false,
        error: "boom",
        stack: "at x",
      },
    ]);
  });

  it("records failed hooks without counting them as finished tests", () => {
    const progress: RunProgress[] = [];
    const stream = new ReporterEventStream((p) => progress.push(p));
    stream.push(line({ event: "start", total: 1 }));
    stream.push(line({ event: "test", fullTitle: "S one" }));
    stream.push(
      line({
        event: "fail",
        type: "hook",
        title: '"before each" hook for "one"',
        fullTitle: 'S "before each" hook for "one"',
      }),
    );

    expect(progress.map((p) => p.completed)).toEqual([0]);
    expect(stream.completed[0]?.hook).toBe(true);
    expect(stream.runningTest).toBe("S one");
  });

  it("treats a marker followed by invalid JSON as plain output", () => {
    const stream = new ReporterEventStream();
    stream.push(`${REPORTER_MARKER}not json\n`);

    expect(stream.end()).toBe(`${REPORTER_MARKER}not json\n`);
  });
});
