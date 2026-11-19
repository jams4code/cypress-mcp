// runtime/support.js runs in the browser, bundled into the spec. Here it runs
// in a VM context with stand-ins for Mocha's globals and Cypress, to check the
// title filter, repeat and the failure payload. The page snapshot itself is
// checked against a real browser in test/e2e/smoke.mjs.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

const SOURCE = fs.readFileSync("runtime/support.js", "utf-8");

interface Registered {
  title: string;
  skipped?: boolean;
}

/** Loads the runtime with `options` and a spec registering tests through it. */
function load(
  options: object,
  spec: (globals: Record<string, (...args: unknown[]) => unknown>) => void,
) {
  const registered: Registered[] = [];
  const handlers: Record<string, ((...args: unknown[]) => unknown)[]> = {};
  const hooks: ((this: unknown) => void)[] = [];
  const tasks: { name: string; payload: Record<string, unknown> }[] = [];

  const it = Object.assign(
    (title: string) => {
      registered.push({ title });
      return { timeout: () => undefined };
    },
    {
      only: (title: string) => registered.push({ title }),
      skip: (title: string) => registered.push({ title, skipped: true }),
    },
  );
  const describeFn = Object.assign(
    (_title: string, ...rest: unknown[]) => (rest[rest.length - 1] as () => void)(),
    {
      only: (_title: string, body: () => void) => body(),
      skip: (_title: string, body: () => void) => body(),
    },
  );

  const window: Record<string, unknown> = {
    it,
    describe: describeFn,
    context: describeFn,
  };
  const context = vm.createContext({
    window,
    globalThis: undefined as unknown,
    afterEach: (fn: (this: unknown) => void) => hooks.push(fn),
    Cypress: {
      on: (event: string, handler: (...args: unknown[]) => unknown) => {
        (handlers[event] ??= []).push(handler);
      },
      spec: { relative: "cypress/e2e/a.cy.js" },
    },
    cy: {
      state: () => undefined,
      task: (name: string, payload: Record<string, unknown>) =>
        tasks.push({ name, payload }),
    },
  });
  (context as { globalThis: unknown }).globalThis = Object.assign(context, {
    __cypressMcp: options,
  });

  vm.runInContext(SOURCE, context);
  spec(window as Record<string, (...args: unknown[]) => unknown>);
  return { registered, handlers, hooks, tasks };
}

describe("runtime/support.js title filter", () => {
  const spec = (g: Record<string, (...args: unknown[]) => unknown>): void => {
    g["describe"]!("Checkout", () => {
      g["it"]!("adds one item", () => undefined);
      g["context"]!("when logged in", () => {
        g["it"]!("shows the cart", () => undefined);
      });
    });
    g["it"]!("outside any suite", () => undefined);
  };

  it("registers every test without options", () => {
    const { registered } = load({}, spec);
    expect(registered.map((r) => r.title)).toEqual([
      "adds one item",
      "shows the cart",
      "outside any suite",
    ]);
  });

  it("keeps exact full titles, nested suites included", () => {
    const { registered } = load(
      { filter: { titles: ["Checkout when logged in shows the cart"] } },
      spec,
    );
    expect(registered.map((r) => r.title)).toEqual(["shows the cart"]);
  });

  it("keeps titles that contain the text, and repeats them", () => {
    const { registered } = load({ filter: { contains: "Checkout" }, repeat: 2 }, spec);
    expect(registered.map((r) => r.title)).toEqual([
      "adds one item (repeat 1/2)",
      "adds one item (repeat 2/2)",
      "shows the cart (repeat 1/2)",
      "shows the cart (repeat 2/2)",
    ]);
  });

  it("returns a chainable stand-in for an omitted test", () => {
    load({ filter: { titles: ["nothing"] } }, (g) => {
      const result = g["it"]!("left out", () => undefined) as {
        timeout(): { retries(): unknown };
      };
      expect(() => result.timeout().retries()).not.toThrow();
    });
  });
});

describe("runtime/support.js failure payload", () => {
  it("sends the console, requests and commands of a failed test through the task", () => {
    const { handlers, hooks, tasks } = load(
      { task: "cypressMcp:failureContext" },
      () => undefined,
    );

    handlers["test:before:run"]![0]!();
    handlers["log:added"]![0]!({
      id: "1",
      instrument: "command",
      name: "visit",
      message: "/",
      state: "passed",
    });
    handlers["log:added"]![0]!({
      id: "2",
      instrument: "command",
      name: "get",
      message: "[data-cy=x]",
      state: "pending",
    });
    handlers["uncaught:exception"]![0]!(new Error("boom"));
    handlers["log:changed"]![0]!({
      id: "2",
      state: "failed",
      message: "**[data-cy=x]**",
    });

    const failed = { state: "failed", fullTitle: () => "A fails", currentRetry: () => 1 };
    hooks[0]!.call({ currentTest: failed });
    // A passing test sends nothing.
    hooks[0]!.call({ currentTest: { state: "passed", fullTitle: () => "A passes" } });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.name).toBe("cypressMcp:failureContext");
    expect(tasks[0]!.payload).toMatchObject({
      spec: "cypress/e2e/a.cy.js",
      title: "A fails",
      attempt: 1,
      failedSelector: "[data-cy=x]",
      console: [{ level: "uncaught", text: "boom" }],
      commands: [
        { name: "visit", state: "passed" },
        { name: "get", message: "[data-cy=x]", state: "failed" },
      ],
    });
  });
});
