// runtime/config.cjs runs inside Cypress's config process; here it is called
// directly with a project's config object, the way the wrapper calls it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

interface WrapOptions {
  projectRoot: string;
  runDir: string;
  reporterPath: string;
  contextFile: string;
  supportRuntime: string;
}
type Handler = (...args: unknown[]) => unknown;
type SetupNodeEvents = (
  on: (event: string, handler: Record<string, Handler>) => void,
  config: Record<string, unknown>,
) => Promise<unknown>;
interface Wrapped {
  reporter: string;
  reporterOptions: { cypressMcpInner: unknown };
  e2e?: { supportFile?: string; setupNodeEvents: SetupNodeEvents; baseUrl?: string };
  component?: { supportFile?: string; setupNodeEvents: SetupNodeEvents };
}

const runtime = createRequire(import.meta.url)("../../runtime/config.cjs") as {
  wrapConfig(config: object, options: WrapOptions): Wrapped;
  expandBraces(pattern: string): string[];
  CONTEXT_TASK: string;
};

let root: string;
let options: WrapOptions;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cypress-mcp-runtime-"));
  const runDir = path.join(
    root,
    "node_modules",
    ".cache",
    "cypress-mcp",
    "runs",
    "run_1-1",
  );
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(root, "cypress", "support"), { recursive: true });
  options = {
    projectRoot: root,
    runDir,
    reporterPath: "/pkg/reporter/cypress-mcp-reporter.cjs",
    contextFile: path.join(runDir, "context.jsonl"),
    supportRuntime: path.join(runDir, "support-runtime.js"),
  };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("wrapConfig", () => {
  it("keeps the project's config and sets the reporter, with theirs as the inner one", () => {
    const wrapped = runtime.wrapConfig(
      {
        reporter: "junit",
        reporterOptions: { mochaFile: "results/[hash].xml" },
        e2e: { baseUrl: "http://localhost:3000" },
      },
      options,
    );

    expect(wrapped.reporter).toBe(options.reporterPath);
    expect(wrapped.reporterOptions.cypressMcpInner).toEqual({
      name: "junit",
      options: { mochaFile: "results/[hash].xml" },
      projectRoot: root,
    });
    expect(wrapped.e2e?.baseUrl).toBe("http://localhost:3000");
    // The default reporter is not worth keeping.
    expect(
      runtime.wrapConfig({ reporter: "spec", e2e: {} }, options).reporterOptions
        .cypressMcpInner,
    ).toBeNull();
  });

  it("writes a support file that imports the project's one, then the runtime", () => {
    fs.writeFileSync(path.join(root, "cypress", "support", "e2e.ts"), "");
    const wrapped = runtime.wrapConfig({ e2e: {} }, options);

    const supportFile = wrapped.e2e!.supportFile!;
    expect(path.dirname(supportFile)).toBe(options.runDir);
    expect(path.extname(supportFile)).toBe(".mjs");
    expect(fs.readFileSync(supportFile, "utf-8").split("\n")).toEqual([
      'import "../../../../../cypress/support/e2e.ts";',
      'import "./support-runtime.js";',
      "",
    ]);
  });

  it("follows a configured support file, braces included, and supportFile: false", () => {
    fs.mkdirSync(path.join(root, "test", "support"), { recursive: true });
    fs.writeFileSync(path.join(root, "test", "support", "index.js"), "");

    const braces = runtime.wrapConfig(
      { e2e: { supportFile: "test/support/index.{ts,js}" } },
      options,
    );
    expect(fs.readFileSync(braces.e2e!.supportFile!, "utf-8")).toContain(
      'import "../../../../../test/support/index.js";',
    );

    const none = runtime.wrapConfig({ e2e: { supportFile: false } }, options);
    expect(fs.readFileSync(none.e2e!.supportFile!, "utf-8")).toBe(
      'import "./support-runtime.js";\n',
    );
  });

  it("wraps only the testing types the project has", () => {
    const e2eOnly = runtime.wrapConfig({ e2e: {} }, options);
    expect(e2eOnly.component).toBeUndefined();

    const both = runtime.wrapConfig({ e2e: {}, component: { devServer: {} } }, options);
    expect(path.basename(both.component!.supportFile!)).toBe("support.component.mjs");
  });

  it("registers the context task, then runs the project's setupNodeEvents", async () => {
    const calls: string[] = [];
    const wrapped = runtime.wrapConfig(
      {
        e2e: {
          setupNodeEvents(on: (event: string, handler: object) => void, config: object) {
            calls.push("user");
            on("task", { userTask: () => "user" });
            return { ...config, env: { fromUser: true } };
          },
        },
      },
      options,
    );

    const tasks: Record<string, Handler> = {};
    const result = await wrapped.e2e!.setupNodeEvents(
      (event, handler) => {
        if (event === "task") Object.assign(tasks, handler);
      },
      { projectRoot: root },
    );

    expect(calls).toEqual(["user"]);
    expect(Object.keys(tasks)).toEqual([runtime.CONTEXT_TASK, "userTask"]);
    expect(result).toEqual({ projectRoot: root, env: { fromUser: true } });

    expect(tasks[runtime.CONTEXT_TASK]!({ title: "A b" })).toBeNull();
    expect(fs.readFileSync(options.contextFile, "utf-8")).toBe('{"title":"A b"}\n');
  });

  it("keeps a reporter that setupNodeEvents sets as the inner one", async () => {
    const wrapped = runtime.wrapConfig(
      {
        e2e: {
          setupNodeEvents: (_on: unknown, config: object) => ({
            ...config,
            reporter: "cypress-multi-reporters",
            reporterOptions: { configFile: "reporters.json" },
          }),
        },
      },
      options,
    );
    const result = (await wrapped.e2e!.setupNodeEvents(() => undefined, {})) as Wrapped;

    expect(result.reporter).toBe(options.reporterPath);
    expect(result.reporterOptions.cypressMcpInner).toMatchObject({
      name: "cypress-multi-reporters",
      options: { configFile: "reporters.json" },
    });
  });
});

describe("expandBraces", () => {
  it("expands each group", () => {
    expect(runtime.expandBraces("cypress/support/e2e.{js,ts}")).toEqual([
      "cypress/support/e2e.js",
      "cypress/support/e2e.ts",
    ]);
    expect(runtime.expandBraces("a/{b,c}/d.{x,y}")).toHaveLength(4);
    expect(runtime.expandBraces("plain.js")).toEqual(["plain.js"]);
  });
});
