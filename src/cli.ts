// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0

// `cypress-mcp run <spec>`: the cypress_run tool from a shell, with the same
// compact output. Agents that have a shell often prefer a command to an MCP
// server, and CI logs read the same way.
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createToolContext } from "./context.js";
import { executeCypressRun } from "./services/run-executor.js";
import { prepareRun } from "./tools/run-shared.js";
import { abortAllRuns } from "./services/process-manager.js";
import { runResult } from "./tools/run.js";
import { CypressMcpError } from "./utils/errors.js";
import { createLogger } from "./utils/logger.js";

export const CLI_USAGE = `Usage: cypress-mcp run <spec>... [options]

Runs Cypress once for the given specs and prints per failure the file:line,
the error, the screenshot and what the page showed. A spec can be a path,
path:line for the test at that line, or a glob in quotes. Passing tests are
omitted unless --verbose.

Options:
  --test <name>       run only tests whose full title contains <name>
  --repeat <n>        run the selected tests n times (1 to 50), to prove a flaky fix
  --component         component tests (cypress run --component)
  --project <dir>     monorepos: the folder with cypress.config.* (default: found from the spec)
  --verbose           list passing and pending tests too
  --browser <name>    browser from \`cypress info\` (default: the project's)
  --headed            show the browser
  --timeout <ms>      run timeout in ms (default 300000)
  --env <key=value>   Cypress env value, repeatable
  --json              print the full result as JSON
  --cwd <dir>         Cypress project root (default: the current directory)

Exit code: 0 all tests passed, 1 a test failed or the run did not complete,
2 bad arguments or setup error (spec or Cypress not found).

Without a command, cypress-mcp starts the MCP server on stdio:
  cypress-mcp [--cwd <dir>] [--caps analyze,config,legacy|all] [--verbose]`;

export const EXIT_PASSED = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly cwd: string;
}

const defaultIo: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  cwd: process.cwd(),
};

/** Runs `cypress-mcp run ...` and resolves with the exit code. */
export async function runCli(
  argv: readonly string[],
  io: CliIo = defaultIo,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        test: { type: "string" },
        repeat: { type: "string" },
        component: { type: "boolean" },
        project: { type: "string" },
        verbose: { type: "boolean" },
        browser: { type: "string" },
        headed: { type: "boolean" },
        timeout: { type: "string" },
        env: { type: "string", multiple: true },
        json: { type: "boolean" },
        cwd: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    io.err(`${err instanceof Error ? err.message : String(err)}\n\n${CLI_USAGE}`);
    return EXIT_USAGE;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    io.out(CLI_USAGE);
    return EXIT_PASSED;
  }
  if (positionals.length === 0) {
    io.err(`Expected at least one spec.\n\n${CLI_USAGE}`);
    return EXIT_USAGE;
  }

  const repeat = values.repeat === undefined ? undefined : Number(values.repeat);
  if (repeat !== undefined && (!Number.isInteger(repeat) || repeat < 1 || repeat > 50)) {
    io.err(`--repeat must be a whole number from 1 to 50: ${values.repeat}`);
    return EXIT_USAGE;
  }

  const timeout = values.timeout === undefined ? undefined : Number(values.timeout);
  if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 1_000)) {
    io.err(
      `--timeout must be a whole number of milliseconds, at least 1000: ${values.timeout}`,
    );
    return EXIT_USAGE;
  }

  const env: Record<string, string> = {};
  for (const pair of values.env ?? []) {
    const at = pair.indexOf("=");
    if (at <= 0) {
      io.err(`--env takes key=value: ${pair}`);
      return EXIT_USAGE;
    }
    env[pair.slice(0, at)] = pair.slice(at + 1);
  }

  const serverRoot = path.resolve(io.cwd, values.cwd ?? ".");
  const logger = createLogger(values.verbose === true, true);
  const ctx = createToolContext(serverRoot, logger);

  // Shell semantics first: a path relative to where the command runs, made
  // relative to the root. Otherwise (globs, path:line, paths under --cwd) as
  // given, the way the MCP tool reads them.
  const specs = positionals.map((arg) => {
    const fromShell = path.resolve(io.cwd, arg);
    if (io.cwd !== serverRoot && existsSync(fromShell)) {
      const relative = path.relative(serverRoot, fromShell);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
        return relative.split(path.sep).join("/");
      }
    }
    return arg;
  });

  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const run = await prepareRun(ctx, {
      spec: specs,
      testName: values.test,
      repeat,
      component: values.component,
      project: values.project,
      browser: values.browser,
      headed: values.headed,
      timeout,
      env: Object.keys(env).length > 0 ? env : undefined,
    });
    const outcome = await executeCypressRun(run.ctx, {
      kind: run.args.grep || run.args.titles ? "run_test" : "run_spec",
      specs: run.specs,
      prefix: run.prefix,
      args: run.args,
      signal: controller.signal,
    });
    const result = await runResult(ctx, outcome, values.verbose === true);

    if (values.json) {
      io.out(JSON.stringify(result.structuredContent, null, 2));
    } else {
      const [text] = result.content;
      io.out(text?.type === "text" ? text.text : "");
    }
    return result.structuredContent.data.status === "passed" ? EXIT_PASSED : EXIT_FAILED;
  } catch (err) {
    if (err instanceof CypressMcpError) {
      io.err(
        `Error ${err.code}: ${err.message}${err.suggestion ? `\n${err.suggestion}` : ""}`,
      );
      return err.code === "CANCELLED" ? EXIT_FAILED : EXIT_USAGE;
    }
    throw err;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await abortAllRuns();
  }
}
