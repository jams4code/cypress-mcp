// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import treeKill from "tree-kill";
import type { CypressRunArgs } from "../types/cypress.js";
import {
  BrowserCheckError,
  CypressNotFoundError,
  InvalidArgumentError,
  RecordKeyMissingError,
  RunCancelledError,
  TimeoutError,
} from "../utils/errors.js";
import { ReporterEventStream, type RunProgress } from "./reporter-events.js";
import { RUN_DIR_ENV, type RunWorkspace } from "./run-workspace.js";
import {
  isVersionAtLeast,
  resolveCypressInstall,
  type CypressInstall,
} from "../utils/paths.js";
import type { Logger } from "../utils/logger.js";

export interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  /** Warnings the reporter printed */
  readonly warnings: readonly string[];
}

/** What the installed Cypress CLI accepts. */
export interface CliCapabilities {
  /** `--expose` (Cypress 15.10+), which @cypress/grep 7 reads `grep` from */
  readonly expose: boolean;
}

export interface RunOptions {
  /** Aborts the run: queued runs never start, a running Cypress is killed */
  readonly signal?: AbortSignal;
  /** Called when Cypress starts the spec and after each test */
  readonly onProgress?: (progress: RunProgress) => void;
  /** The run's own folder: reports, screenshots and, when set, the wrapper config */
  readonly workspace?: RunWorkspace;
}

/**
 * One Cypress at a time per server, whatever the project: a monorepo has a
 * ProcessManager per project, and two browsers at once slow both down.
 */
const sharedQueue: { tail: Promise<void> } = { tail: Promise.resolve() };
const activeProcesses = new Set<ChildProcess>();

/** Kill every Cypress this server started. Used when the client goes away. */
export function abortAllRuns(): Promise<void> {
  const pids = [...activeProcesses]
    .map((child) => child.pid)
    .filter((pid) => pid !== undefined);
  activeProcesses.clear();
  return Promise.all(
    pids.map(
      (pid) => new Promise<void>((resolve) => treeKill(pid, "SIGTERM", () => resolve())),
    ),
  ).then(() => undefined);
}

/** Grace period between SIGTERM and SIGKILL when stopping Cypress. */
const FORCE_KILL_AFTER_MS = 5_000;
/**
 * After a killed Cypress exits, how long to wait for its output to close. A
 * helper that left the process tree can hold the pipes open for minutes.
 */
const PIPE_CLOSE_AFTER_EXIT_MS = 2_000;
const CYPRESS_INFO_TIMEOUT_MS = 60_000;

/** A browser name, optionally with a channel: chrome, chrome:beta, firefox:dev. */
const BROWSER_NAME_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z0-9-]+)?$/;

export class ProcessManager {
  private activeProcess: ChildProcess | null = null;
  private browsers: { cli: string; names: Promise<readonly string[]> } | null = null;

  constructor(
    private readonly projectRoot: string,
    private readonly logger: Logger,
    /** Absolute path of reporter/cypress-mcp-reporter.cjs; "json" for no progress */
    private readonly reporter = "json",
  ) {}

  /** Run Cypress after any run already in progress (one Cypress at a time). */
  run(args: CypressRunArgs, options: RunOptions = {}): Promise<SpawnResult> {
    const job = sharedQueue.tail.then(() => {
      // Cancelled while waiting in the queue: never start Cypress.
      if (options.signal?.aborted) {
        throw new RunCancelledError();
      }
      return this.executeRun(args, options);
    });
    // The next run waits for this one to end, whatever its outcome.
    sharedQueue.tail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  /** Kill the active Cypress process tree, if any. Resolves once the signal is sent. */
  abort(): Promise<void> {
    const pid = this.activeProcess?.pid;
    this.activeProcess = null;
    if (!pid) {
      return Promise.resolve();
    }

    this.logger.info("Aborting active Cypress process", { pid });
    return new Promise((resolve) => treeKill(pid, "SIGTERM", () => resolve()));
  }

  /**
   * Absolute path of the Cypress CLI script for this project. Cypress must be
   * installed in the project (or a parent workspace); there is deliberately no
   * npx fallback, which could download and run an arbitrary Cypress version.
   */
  async resolveBinary(): Promise<string> {
    return (await this.resolveInstall()).cli;
  }

  /** Version of the project's Cypress package, e.g. "16.3.0". */
  async cypressVersion(): Promise<string> {
    return (await this.resolveInstall()).version;
  }

  private async resolveInstall(): Promise<CypressInstall> {
    const install = resolveCypressInstall(this.projectRoot);
    if (install) {
      try {
        await fs.access(install.cli);
        return install;
      } catch {
        // Package metadata found but the script is missing: treat as not installed.
      }
    }
    throw new CypressNotFoundError(this.projectRoot);
  }

  /**
   * Check a browser name from a tool call against the browsers this Cypress
   * install can launch, and return it in canonical form. Cypress also accepts
   * a path to an executable for --browser and runs it to detect its version,
   * so anything that is not a listed name is rejected before Cypress sees it.
   */
  async resolveBrowser(requested: string): Promise<string> {
    const name = requested.trim().toLowerCase();
    if (!BROWSER_NAME_PATTERN.test(name)) {
      throw new InvalidArgumentError(
        `browser must be a browser name such as chrome, firefox, edge or electron. Paths are not accepted: ${requested}`,
      );
    }

    let available: readonly string[];
    try {
      available = await this.availableBrowsers();
    } catch (err) {
      if (err instanceof CypressNotFoundError) {
        throw err;
      }
      throw new BrowserCheckError(err instanceof Error ? err.message : String(err));
    }

    if (!available.includes(name)) {
      throw new InvalidArgumentError(
        `Browser "${requested}" is not available. Cypress can use: ${available.join(", ")}.`,
      );
    }
    return name;
  }

  /** Browser names from `cypress info`, cached per Cypress install. */
  private async availableBrowsers(): Promise<readonly string[]> {
    const install = await this.resolveInstall();
    if (this.browsers?.cli !== install.cli) {
      const names = this.runCypressInfo(install.cli).then(parseCypressInfoBrowsers);
      this.browsers = { cli: install.cli, names };
      // A failed lookup is not cached, so the next call tries again.
      names.catch(() => {
        if (this.browsers?.names === names) {
          this.browsers = null;
        }
      });
    }
    return this.browsers.names;
  }

  private runCypressInfo(cli: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "info"], {
        cwd: this.projectRoot,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));

      const timer = setTimeout(() => {
        if (child.pid) treeKill(child.pid, "SIGKILL");
        reject(new Error(`no answer after ${CYPRESS_INFO_TIMEOUT_MS}ms`));
      }, CYPRESS_INFO_TIMEOUT_MS);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        const output = Buffer.concat(chunks).toString("utf-8");
        if (exitCode === 0) {
          resolve(output);
        } else {
          reject(
            new Error(`exit code ${exitCode ?? "unknown"}: ${output.trim().slice(-500)}`),
          );
        }
      });
    });
  }

  private async executeRun(
    args: CypressRunArgs,
    options: RunOptions,
  ): Promise<SpawnResult> {
    const install = await this.resolveInstall();
    const cliArgs = buildCliArgs(
      args,
      { expose: isVersionAtLeast(install.version, 15, 10) },
      this.reporter,
      options.workspace,
    );
    const env = buildChildEnv(process.env, args, options.workspace);
    const timeout = args.timeout ?? 300_000;

    this.logger.info("Running Cypress", {
      spec: args.spec,
      browser: args.browser,
      cypress: install.version,
      record: args.cloud?.record ?? false,
      timeout,
    });

    return this.spawnProcess(install.cli, cliArgs, env, timeout, options);
  }

  private spawnProcess(
    cli: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    timeout: number,
    options: RunOptions,
  ): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolve, reject) => {
      const { signal } = options;
      if (signal?.aborted) {
        reject(new RunCancelledError());
        return;
      }

      let timedOut = false;
      let cancelled = false;
      let killing = false;
      let forceKillTimer: NodeJS.Timeout | null = null;
      let pipeCloseTimer: NodeJS.Timeout | null = null;
      let settled = false;

      // Run the CLI script with the current Node binary. No shell is involved
      // on any platform, so arguments are passed to Cypress verbatim.
      const child = spawn(process.execPath, [cli, ...args], {
        cwd: this.projectRoot,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });

      this.activeProcess = child;
      activeProcesses.add(child);
      const events = new ReporterEventStream(options.onProgress);
      const stderrChunks: Buffer[] = [];

      // Decoded as UTF-8 by the stream, so characters split across chunks survive.
      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (chunk: string) => events.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      // Kill the whole tree: the CLI starts the Cypress binary, which starts
      // the browser and its helpers. Killing only the CLI leaves them running
      // and the next run waits behind them.
      const killTree = (): void => {
        const pid = child.pid;
        if (!pid || killing) {
          return;
        }
        killing = true;
        treeKill(pid, "SIGTERM", () => {
          forceKillTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              treeKill(pid, "SIGKILL");
            }
          }, FORCE_KILL_AFTER_MS);
        });
      };

      const onAbort = (): void => {
        cancelled = true;
        this.logger.info("Run cancelled by the client, killing Cypress", {
          pid: child.pid,
        });
        killTree();
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const finish = (callback: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        if (pipeCloseTimer) {
          clearTimeout(pipeCloseTimer);
        }
        if (this.activeProcess === child) {
          this.activeProcess = null;
        }
        activeProcesses.delete(child);
        callback();
      };

      const timer = setTimeout(() => {
        if (!child.pid) {
          return;
        }
        timedOut = true;
        this.logger.warn("Cypress process timed out, killing", {
          pid: child.pid,
          timeout,
          runningTest: events.runningTest,
        });
        killTree();
      }, timeout);

      const settle = (exitCode: number | null, error?: Error): void => {
        const stdout = events.end();
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");

        if (cancelled) {
          reject(new RunCancelledError());
        } else if (timedOut) {
          reject(
            new TimeoutError(timeout, {
              runningTest: events.runningTest,
              completed: events.completed,
              stdout,
              stderr,
            }),
          );
        } else if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr, exitCode, warnings: events.warnings });
        }
      };

      child.on("close", (exitCode) => finish(() => settle(exitCode)));
      // "close" waits for every process holding stdout and stderr. When we
      // killed Cypress, a helper that escaped the tree kill (reparented, or
      // started during shutdown) would block the queue until it ends.
      child.on("exit", (exitCode) => {
        if (!killing || settled) {
          return;
        }
        pipeCloseTimer = setTimeout(() => {
          this.logger.warn(
            "Cypress exited but a helper still holds its output; closing it",
            {
              pid: child.pid,
            },
          );
          child.stdout.destroy();
          child.stderr.destroy();
          finish(() => settle(exitCode));
        }, PIPE_CLOSE_AFTER_EXIT_MS);
      });
      child.on("error", (err) => finish(() => settle(null, err)));
    });
  }
}

/**
 * Browser names `cypress run --browser` accepts on this machine, from the
 * output of `cypress info`: each detected browser by name and as
 * `name:channel`. Electron is always included: it ships inside the Cypress
 * binary, and Cypress 16 no longer lists it although it still runs it.
 * Exported for tests.
 */
export function parseCypressInfoBrowsers(output: string): string[] {
  const names = new Set<string>(["electron"]);
  let current: string | undefined;

  for (const line of output.split(/\r?\n/)) {
    const name = /^\s*-\s*Name:\s*(\S+)/.exec(line)?.[1];
    if (name) {
      current = name.toLowerCase();
      names.add(current);
      continue;
    }
    const channel = /^\s*-\s*Channel:\s*(\S+)/.exec(line)?.[1];
    if (channel && current) {
      names.add(`${current}:${channel.toLowerCase()}`);
    }
  }

  return [...names].sort();
}

/**
 * Build the `cypress run` argument list. Each value is one argv entry and no
 * shell is involved, so nothing here is ever interpreted by a shell.
 *
 * With a workspace, screenshots and videos go to the run's own folder, and
 * when the workspace has a wrapper config, that config sets the reporter (so
 * the project's reporter can run next to it) and filters titles in the
 * browser. Without one, the reporter is passed here and a title filter goes
 * to @cypress/grep. Exported for tests.
 */
export function buildCliArgs(
  args: CypressRunArgs,
  capabilities: CliCapabilities = { expose: true },
  reporter = "json",
  workspace?: RunWorkspace,
): string[] {
  const wrapped = Boolean(workspace?.wrapperConfigFile);
  const cliArgs = ["run"];
  if (args.component) {
    cliArgs.push("--component");
  }
  if (!wrapped) {
    cliArgs.push("--reporter", reporter);
  }
  cliArgs.push("--spec", args.spec);

  const configFile = workspace?.wrapperConfigFile ?? args.configFile;
  if (configFile) {
    cliArgs.push("--config-file", configFile);
  }

  if (workspace) {
    // JSON, because a path can contain the commas the a=b,c=d form splits on.
    cliArgs.push(
      "--config",
      JSON.stringify({
        screenshotsFolder: workspace.screenshotsDir,
        videosFolder: workspace.videosDir,
      }),
    );
  }

  // Only when asked for: without --browser Cypress uses the project's own
  // browser setting, then its default.
  if (args.browser) {
    cliArgs.push("--browser", args.browser);
  }

  if (args.headed) {
    cliArgs.push("--headed");
  }

  // Cypress parses a JSON object here as-is. The `a=b,c=d` form splits on
  // commas and coerces types, so it cannot carry arbitrary test names.
  const grep = wrapped ? undefined : args.grep;
  const env: Record<string, string> = { ...args.env };
  if (grep) {
    // Read by @cypress/grep up to v6 (Cypress.env) and by cy.env()
    env["grep"] = grep;
  }
  if (Object.keys(env).length > 0) {
    cliArgs.push("--env", JSON.stringify(env));
  }

  if (grep && capabilities.expose) {
    // @cypress/grep 7 reads its options from Cypress.expose()
    cliArgs.push("--expose", JSON.stringify({ grep }));
  }

  if (args.cloud?.record) {
    cliArgs.push("--record");

    const tags = args.cloud.tags ?? [];
    if (tags.some((tag) => tag.includes(",") || tag.trim() === "")) {
      throw new InvalidArgumentError(
        "Cloud tags must be non-empty and must not contain commas.",
      );
    }
    if (tags.length > 0) {
      cliArgs.push("--tag", tags.join(","));
    }
    if (args.cloud.group) {
      cliArgs.push("--group", args.cloud.group);
    }
    if (args.cloud.ciBuildId) {
      cliArgs.push("--ci-build-id", args.cloud.ciBuildId);
    }
  }

  return cliArgs;
}

/**
 * Build the child environment from the server's. Exported for tests.
 */
export function buildChildEnv(
  base: NodeJS.ProcessEnv,
  args: CypressRunArgs,
  workspace?: RunWorkspace,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  // Read by the reporter (report files) and kept out of a user's own value.
  delete env[RUN_DIR_ENV];
  if (workspace) {
    env[RUN_DIR_ENV] = workspace.dir;
  }

  // A grep left in the parent environment would silently filter every run.
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "cypress_grep") {
      delete env[key];
    }
  }

  // Cypress reads the record key from here, so it never crosses the agent.
  if (args.cloud?.record && !env["CYPRESS_RECORD_KEY"]) {
    throw new RecordKeyMissingError();
  }

  return env;
}
