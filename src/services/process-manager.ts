// Copyright (c) 2026 JADEV GROUP SARL
// SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import treeKill from "tree-kill";
import type { CypressRunArgs } from "../types/cypress.js";
import {
  CypressNotFoundError,
  InvalidArgumentError,
  RecordKeyMissingError,
  TimeoutError,
} from "../utils/errors.js";
import {
  isVersionAtLeast,
  resolveCypressInstall,
  type CypressInstall,
} from "../utils/paths.js";
import type { Logger } from "../utils/logger.js";

interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

/** What the installed Cypress CLI accepts. */
export interface CliCapabilities {
  /** `--expose` (Cypress 15.10+), which @cypress/grep 7 reads `grep` from */
  readonly expose: boolean;
}

export class ProcessManager {
  private runQueue: Promise<void> = Promise.resolve();
  private activeProcess: ChildProcess | null = null;

  constructor(
    private readonly projectRoot: string,
    private readonly logger: Logger,
  ) {}

  async run(args: CypressRunArgs): Promise<SpawnResult> {
    // Serial execution: queue behind any active run
    return new Promise<SpawnResult>((resolve, reject) => {
      this.runQueue = this.runQueue
        .then(() => this.executeRun(args))
        .then(resolve, reject);
    });
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

  private async executeRun(args: CypressRunArgs): Promise<SpawnResult> {
    const install = await this.resolveInstall();
    const cliArgs = buildCliArgs(args, {
      expose: isVersionAtLeast(install.version, 15, 10),
    });
    const env = buildChildEnv(process.env, args);
    const timeout = args.timeout ?? 300_000;

    this.logger.info("Running Cypress", {
      spec: args.spec,
      browser: args.browser,
      cypress: install.version,
      record: args.cloud?.record ?? false,
      timeout,
    });

    return this.spawnProcess(install.cli, cliArgs, env, timeout);
  }

  private spawnProcess(
    cli: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    timeout: number,
  ): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolve, reject) => {
      let timedOut = false;
      let forceKillTimer: NodeJS.Timeout | null = null;
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
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      const finish = (callback: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        if (this.activeProcess === child) {
          this.activeProcess = null;
        }
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
        });
        treeKill(child.pid, "SIGTERM", () => {
          // If still alive after 5s, force kill
          forceKillTimer = setTimeout(() => {
            if (child.pid && child.exitCode === null) {
              treeKill(child.pid, "SIGKILL");
            }
          }, 5000);
        });
      }, timeout);

      child.on("close", (exitCode) => {
        finish(() => {
          if (timedOut) {
            reject(new TimeoutError(timeout));
            return;
          }

          resolve({
            stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
            stderr: Buffer.concat(stderrChunks).toString("utf-8"),
            exitCode,
          });
        });
      });

      child.on("error", (err) => {
        finish(() => {
          if (timedOut) {
            reject(new TimeoutError(timeout));
            return;
          }
          reject(err);
        });
      });
    });
  }
}

/**
 * Build the `cypress run` argument list. Each value is one argv entry and no
 * shell is involved, so nothing here is ever interpreted by a shell.
 * Exported for tests.
 */
export function buildCliArgs(
  args: CypressRunArgs,
  capabilities: CliCapabilities = { expose: true },
): string[] {
  const cliArgs = ["run", "--reporter", "json", "--spec", args.spec];

  if (args.configFile) {
    cliArgs.push("--config-file", args.configFile);
  }

  if (args.browser) {
    cliArgs.push("--browser", args.browser);
  }

  if (args.headed) {
    cliArgs.push("--headed");
  }

  // Cypress parses a JSON object here as-is. The `a=b,c=d` form splits on
  // commas and coerces types, so it cannot carry arbitrary test names.
  const env: Record<string, string> = { ...args.env };
  if (args.grep) {
    // Read by @cypress/grep up to v6 (Cypress.env) and by cy.env()
    env["grep"] = args.grep;
  }
  if (Object.keys(env).length > 0) {
    cliArgs.push("--env", JSON.stringify(env));
  }

  if (args.grep && capabilities.expose) {
    // @cypress/grep 7 reads its options from Cypress.expose()
    cliArgs.push("--expose", JSON.stringify({ grep: args.grep }));
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
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };

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
